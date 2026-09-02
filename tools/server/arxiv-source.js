const path = require("path");
const zlib = require("zlib");

const sourceBundleCache = new Map();
const titleResolutionCache = new Map();

async function resolveArxivIdByTitle(title, options = {}) {
  const normalizedTitle = normalizeAcademicTitle(title);
  if (normalizedTitle.length < 12) return null;
  if (titleResolutionCache.has(normalizedTitle)) return titleResolutionCache.get(normalizedTitle);

  const timeoutMs = Number(options.timeoutMs || process.env.ARXIV_SEARCH_TIMEOUT_MS || 18000);
  const endpoint = options.endpoint || "https://export.arxiv.org/api/query";
  const url = new URL(endpoint);
  url.searchParams.set("search_query", `ti:\"${String(title).replace(/[\"\r\n]+/g, " ").trim()}\"`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "5");
  const controller = new AbortController();
  const response = await withTimeout((options.fetchImpl || fetch)(url, {
    signal: controller.signal,
    headers: { "User-Agent": "PaperReadingAgent/1.0 (local academic reading tool)" }
  }), timeoutMs, () => controller.abort());
  if (!response.ok) throw new Error(`arXiv title lookup failed (HTTP ${response.status}).`);
  const entries = parseArxivAtomEntries(await response.text());
  const match = entries.find((entry) => normalizeAcademicTitle(entry.title) === normalizedTitle) || null;
  const result = match ? { id: match.id, title: match.title } : null;
  if (result) titleResolutionCache.set(normalizedTitle, result);
  return result;
}

function parseArxivAtomEntries(xml) {
  return [...String(xml || "").matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match) => {
    const entry = match[1];
    const idUrl = decodeXml(entry.match(/<id>([\s\S]*?)<\/id>/i)?.[1] || "").trim();
    const title = decodeXml(entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
    const id = idUrl.match(/\/abs\/([^?#\s]+)/i)?.[1]?.replace(/v\d+$/i, "") || "";
    return { id, title };
  }).filter((entry) => entry.id && entry.title);
}

function normalizeAcademicTitle(value) {
  return decodeXml(String(value || ""))
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

async function fetchArxivLatexBundle(id, options = {}) {
  const cacheEnabled = options.cache !== false;
  if (cacheEnabled && sourceBundleCache.has(id)) return sourceBundleCache.get(id);

  const timeoutMs = Number(options.timeoutMs || process.env.ARXIV_TIMEOUT_MS || 45000);
  const encodedId = id.split("/").map((part) => encodeURIComponent(part)).join("/");
  const urls = getArxivSourceUrls(encodedId, options);
  const failures = [];
  let buffer = null;

  for (const url of urls) {
    try {
      console.log(`[ARXIV] Downloading ${url}; timeout=${timeoutMs}ms`);
      const result = await fetchArxivPayload(url, {
        timeoutMs,
        fetchImpl: options.fetchImpl || fetch
      });
      if (!result.response.ok) {
        failures.push(`${new URL(url).host}: HTTP ${result.response.status}`);
        continue;
      }
      buffer = result.buffer;
      console.log(`[ARXIV] Downloaded ${buffer.length} bytes from ${new URL(url).host}`);
      break;
    } catch (error) {
      const host = new URL(url).host;
      const detail = error.name === "AbortError" || error.code === "APP_TIMEOUT"
        ? `timed out after ${Math.round(timeoutMs / 1000)}s`
        : error.message;
      failures.push(`${host}: ${detail}`);
      console.warn(`[ARXIV] ${host} failed: ${detail}`);
    }
  }

  if (!buffer) {
    throw new Error(`Could not download arXiv source after ${urls.length} attempt(s). ${failures.join("; ")}. You can still upload the PDF or paste paper text.`);
  }

  const files = unpackArxivPayload(buffer);
  const texFiles = files.filter((file) => /\.tex$/i.test(file.name));
  if (!texFiles.length) throw new Error("No .tex source file found in the arXiv package.");
  const mainTex = chooseMainTex(texFiles);
  const bundle = { files, texFiles, mainTex, combinedTex: combineTexFiles(mainTex, texFiles) };
  if (cacheEnabled) sourceBundleCache.set(id, bundle);
  return bundle;
}

function getArxivSourceUrls(encodedId, options = {}) {
  const configured = String(process.env.ARXIV_SOURCE_BASE_URLS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const bases = options.baseUrls?.length
    ? options.baseUrls
    : configured.length
      ? configured
      : ["https://export.arxiv.org/e-print", "https://arxiv.org/e-print"];
  return [...new Set(bases.map((base) => `${String(base).replace(/\/$/, "")}/${encodedId}`))];
}

async function fetchArxivPayload(url, { timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  return withTimeout((async () => {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "User-Agent": "PaperReadingAgent/1.0 (local academic reading tool)" }
    });
    const buffer = response.ok ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
    return { response, buffer };
  })(), timeoutMs, () => controller.abort());
}

function unpackArxivPayload(buffer) {
  const payload = tryGunzip(buffer);
  const tarFiles = parseTar(payload);
  if (tarFiles.length) return tarFiles;
  const text = bufferToText(payload);
  if (looksLikeLatex(text)) return [{ name: "source.tex", content: text, data: payload }];
  throw new Error("Unsupported arXiv source format. Try the PDF path for this paper.");
}

function tryGunzip(buffer) {
  try { return zlib.gunzipSync(buffer); } catch { return buffer; }
}

function parseTar(buffer) {
  const files = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.slice(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const size = parseInt(readTarString(header, 124, 12).replace(/\0/g, "").trim() || "0", 8);
    const type = readTarString(header, 156, 1);
    if (!name || Number.isNaN(size) || size < 0) break;
    const fullName = [prefix, name].filter(Boolean).join("/");
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (fullName && type !== "5") {
      const data = buffer.slice(contentStart, contentEnd);
      const isText = /\.(?:tex|sty|cls|bib|bbl|txt|md)$/i.test(fullName);
      files.push({ name: fullName, content: isText ? bufferToText(data) : "", data });
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function readTarString(buffer, start, length) {
  return buffer.slice(start, start + length).toString("utf8").replace(/\0.*$/, "").trim();
}

function bufferToText(buffer) {
  return buffer.toString("utf8").replace(/\r/g, "");
}

function looksLikeLatex(text) {
  return /\\documentclass|\\begin\{document\}|\\section\{|\\begin\{equation\}/.test(text);
}

function chooseMainTex(texFiles) {
  return texFiles.map((file) => {
    let score = 0;
    if (/\\documentclass/.test(file.content)) score += 8;
    if (/\\begin\{document\}/.test(file.content)) score += 8;
    if (/\\title\{/.test(file.content)) score += 3;
    if (/\\begin\{abstract\}/.test(file.content)) score += 3;
    score += Math.min(file.content.length / 10000, 5);
    return { file, score };
  }).sort((a, b) => b.score - a.score)[0].file;
}

function combineTexFiles(mainTex, texFiles) {
  const byBaseName = new Map();
  for (const file of texFiles) {
    const normalized = file.name.replace(/\\/g, "/");
    const withoutExt = normalized.replace(/\.tex$/i, "");
    byBaseName.set(withoutExt.toLowerCase(), file.content);
    byBaseName.set(path.posix.basename(withoutExt).toLowerCase(), file.content);
  }
  const seen = new Set();
  const expand = (content, depth = 0) => {
    if (depth > 4) return content;
    return content.replace(/\\(?:input|include)\{([^}]+)\}/g, (match, rawName) => {
      const cleanName = rawName.trim().replace(/\.tex$/i, "").replace(/\\/g, "/").toLowerCase();
      if (seen.has(cleanName)) return "";
      const included = byBaseName.get(cleanName) || byBaseName.get(path.posix.basename(cleanName));
      if (!included) return match;
      seen.add(cleanName);
      return `\n${expand(included, depth + 1)}\n`;
    });
  };
  return stripLatexComments(expand(mainTex.content));
}

function stripLatexComments(text) {
  return text.split("\n").map((line) => line.replace(/(^|[^\\])%.*/, "$1").trimEnd()).join("\n");
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

function createArxivSourceTool() {
  return {
    name: "arxiv.source",
    description: "Fetching and unpacking arXiv LaTeX source",
    stage: "ingestion",
    runtime: "server",
    inputTypes: ["arxiv"],
    run: ({ arxivId }) => fetchArxivLatexBundle(arxivId),
    summarize: (bundle) => `${bundle.files.length} archive files, ${bundle.texFiles.length} TeX files; main: ${bundle.mainTex.name}.`
  };
}

module.exports = {
  createArxivSourceTool,
  fetchArxivLatexBundle,
  resolveArxivIdByTitle,
  parseArxivAtomEntries,
  getArxivSourceUrls,
  unpackArxivPayload,
  combineTexFiles
};
