const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { normalizeArchivePath } = require("./latex-utils");

async function fetchArxivPdf(id, pdfCache) {
  if (pdfCache.has(id)) return pdfCache.get(id);
  const encodedId = id.split("/").map((part) => encodeURIComponent(part)).join("/");
  const timeoutMs = Number(process.env.ARXIV_PDF_TIMEOUT_MS || 45000);
  const configuredEndpoints = String(process.env.ARXIV_PDF_ENDPOINTS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const endpoints = configuredEndpoints.length
    ? configuredEndpoints
    : ["https://arxiv.org/pdf", "https://export.arxiv.org/pdf"];
  const failures = [];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const url = `${endpoint}/${encodedId}.pdf`;
    try {
      console.log(`[ARXIV PDF] Downloading ${url}; timeout=${timeoutMs}ms`);
      const response = await withTimeout(fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "PaperReadingAgent/1.0 (local academic reading tool)" }
      }), timeoutMs, () => controller.abort());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length > 80_000_000) throw new Error("PDF is too large for table extraction");
      if (!data.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("response was not a PDF");
      pdfCache.set(id, data);
      while (pdfCache.size > 3) pdfCache.delete(pdfCache.keys().next().value);
      return data;
    } catch (error) {
      const reason = String(error.message || error);
      failures.push(`${new URL(endpoint).host}: ${reason}`);
      console.warn(`[ARXIV PDF] ${url} failed: ${reason}`);
    }
  }

  throw new Error(`Could not fetch the arXiv PDF from any endpoint (${failures.join("; ")}). Upload the PDF to use local table cropping.`);
}

async function renderLatexTableImages(id, combinedTex, tables, files, assetCache) {
  const documentMarker = combinedTex.indexOf("\\begin{document}");
  if (documentMarker === -1 || !tables.length) return;
  const cache = assetCache.get(id);
  if (!cache) return;
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "paper-agent-table-"));
  const preamble = sanitizeLatexPreamble(combinedTex.slice(0, documentMarker));
  try {
    await copyLatexSupportFiles(files, tempDir);
    for (let index = 0; index < Math.min(tables.length, 8); index += 1) {
      const table = tables[index];
      const baseName = `paper-table-${index + 1}`;
      const texPath = path.join(tempDir, `${baseName}.tex`);
      const pdfPath = path.join(tempDir, `${baseName}.pdf`);
      const croppedPath = path.join(tempDir, `${baseName}-cropped.pdf`);
      const pngPrefix = path.join(tempDir, `${baseName}-rendered`);
      const pngPath = `${pngPrefix}.png`;
      const source = `${preamble}\n\\begin{document}\n\\pagestyle{empty}\n${extractRenderableTableLatex(table.latex)}\n\\end{document}\n`;
      try {
        await fs.promises.writeFile(texPath, source, "utf8");
        await runExternalTool(process.env.PDFLATEX_PATH || "pdflatex", [
          "-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", `-output-directory=${tempDir}`, texPath
        ], tempDir, 30000);
        await runExternalTool(process.env.PDFCROP_PATH || "pdfcrop", [pdfPath, croppedPath], tempDir, 20000);
        await runExternalTool(process.env.PDFTOPPM_PATH || "pdftoppm", ["-png", "-r", "220", "-singlefile", croppedPath, pngPrefix], tempDir, 20000);
        const data = await fs.promises.readFile(pngPath);
        const assetPath = `_generated/${id.replace(/\//g, "-")}/table-${index + 1}.png`;
        cache.set(assetPath.toLowerCase(), { name: assetPath, mime: "image/png", data });
        table.image = { path: assetPath, type: "image/png", url: `/api/arxiv-asset?id=${encodeURIComponent(id)}&path=${encodeURIComponent(assetPath)}` };
      } catch (error) {
        console.warn(`[TABLE] ${table.name} image rendering skipped: ${error.message}`);
      }
    }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function extractRenderableTableLatex(value) {
  const source = String(value || "");
  const environment = source.match(/\\begin\{(tabular\*?|tabularx|array)\}[\s\S]*?\\end\{\1\}/);
  if (environment) {
    const size = source.match(/\\(?:tiny|scriptsize|footnotesize|small|normalsize|large)\b/)?.[0] || "";
    return `\\centering\n${size}\n${environment[0]}`;
  }
  return source
    .replace(/\\caption(?:\[[^\]]*\])?\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .replace(/\\label\{[^{}]*\}/g, "");
}

function sanitizeLatexPreamble(value) {
  return String(value || "")
    .replace(/\\(?:immediate\s*)?\\write18\b[^\n]*/gi, "")
    .replace(/\\(?:openin|openout|read|write)\b[^\n]*/gi, "")
    .replace(/\\includeonly\{[^}]*\}/g, "");
}

async function copyLatexSupportFiles(files, targetDir) {
  for (const file of files) {
    const name = normalizeArchivePath(file.name);
    if (!/\.(?:sty|cls|clo|cfg|def|fd)$/i.test(name) || !Buffer.isBuffer(file.data)) continue;
    const destination = path.join(targetDir, ...name.split("/"));
    if (!destination.startsWith(targetDir)) continue;
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    await fs.promises.writeFile(destination, file.data);
  }
}

function runExternalTool(command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 2_000_000,
      env: { ...process.env, MIKTEX_ENABLE_INSTALLER: "0" }
    }, (error, stdout, stderr) => {
      if (!error) return resolve({ stdout, stderr });
      const detail = String(stderr || stdout || error.message).replace(/\s+/g, " ").trim().slice(0, 220);
      reject(new Error(detail || `${command} failed`));
    });
  });
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout?.();
      const error = new Error("Operation timed out.");
      error.code = "APP_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function createPdfTableCropTool() {
  return {
    name: "pdf.table-crop",
    description: "Preparing original-PDF table crops",
    stage: "extraction",
    runtime: "server",
    inputTypes: ["arxiv"],
    run: ({ tables, arxivId }) => tables.map((table, index) => ({
      ...table,
      pdfCrop: { url: `/api/arxiv-pdf?id=${encodeURIComponent(arxivId)}`, tableNumber: index + 1 }
    })),
    summarize: (items) => `${items.length} original-PDF crop references prepared.`
  };
}

module.exports = { createPdfTableCropTool, fetchArxivPdf, renderLatexTableImages, sanitizeLatexPreamble, extractRenderableTableLatex };
