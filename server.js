const http = require("http");
const fs = require("fs");
const path = require("path");
const { runPaperAgent } = require("./agent/paper-agent");
const { buildPaperContext } = require("./agent/context");
const { runSourceExtractionAgent } = require("./agent/source-agent");
const { createExtractionTools } = require("./tools/server/extraction-tools");
const { getCachedAsset } = require("./tools/server/latex-figures");
const {
  latexToPlainText: toolLatexToPlainText,
  extractLatexTitle: toolExtractLatexTitle,
  extractLatexTitleLines: toolExtractLatexTitleLines
} = require("./tools/server/latex-utils");
const { fetchArxivPdf: fetchArxivPdfTool, renderLatexTableImages: renderLatexTableImagesTool } = require("./tools/server/pdf-table-crop");
const { createLlmClient } = require("./tools/server/llm-client");
const { createEvaluationRunTool } = require("./tools/server/evaluation-run");
const { runPosterReviewAgent } = require("./agent/poster-review-agent");
const { createAssetCropVisionTool } = require("./tools/server/asset-crop-vision");
const { resolveArxivIdByTitle } = require("./tools/server/arxiv-source");

const root = __dirname;
const port = process.env.PORT || 5173;
const appVersion = "2026-08-25-end-to-end-formula-v72";
const arxivAssetCache = new Map();
const arxivPdfCache = new Map();
loadEnv(path.join(root, ".env"));
const callChatCompletionTool = createLlmClient({ getApiKey, getBaseUrl, getModel });
const callVisionCompletionTool = createLlmClient({
  getApiKey: getVisionApiKey,
  getBaseUrl: getVisionBaseUrl,
  getModel: getVisionModel
});
const assetCropVisionTool = createAssetCropVisionTool({
  callModel: callVisionCompletionTool,
  options: {
    maxTokens: Number(process.env.VISION_CROP_MAX_TOKENS || 700),
    timeoutMs: Number(process.env.VISION_CROP_TIMEOUT_MS || 60000)
  }
});
const evaluationRunTool = createEvaluationRunTool({ fixturesDir: path.join(root, "evaluation", "fixtures") });

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url.split("?")[0] === "/api/inspect-asset-crop") {
    await handleAssetCropInspection(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0] === "/api/review-poster") {
    await handlePosterReview(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0] === "/api/test-vision") {
    await handleTestVision(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0] === "/api/evaluate") {
    await handleEvaluate(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0] === "/api/analyze-agent") {
    await handleAnalyzeAgent(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0] === "/api/analyze") {
    await handleAnalyze(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0] === "/api/test-llm") {
    await handleTestLLM(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0] === "/api/arxiv-source") {
    await handleArxivSource(req, res);
    return;
  }

  if (req.method === "POST" && req.url.split("?")[0] === "/api/arxiv-resolve") {
    await handleArxivResolve(req, res);
    return;
  }

  if (req.method === "GET" && req.url.split("?")[0] === "/api/arxiv-asset") {
    handleArxivAsset(req, res);
    return;
  }

  if (req.method === "GET" && req.url.split("?")[0] === "/api/arxiv-pdf") {
    await handleArxivPdf(req, res);
    return;
  }

  const cleanUrl = decodeURIComponent(req.url.split("?")[0]);
  const safePath = cleanUrl === "/" ? "/index.html" : cleanUrl;
  const filePath = path.normalize(path.join(root, safePath));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

function loadEnv(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    const canOverwrite = options.overwrite === true && (!options.keys || options.keys.has(key));
    if (key && (process.env[key] === undefined || canOverwrite)) {
      process.env[key] = value;
    }
  }
}

function refreshVisionEnv() {
  loadEnv(path.join(root, ".env"), {
    overwrite: true,
    keys: new Set(["VISION_API_KEY", "DASHSCOPE_API_KEY", "VISION_BASE_URL", "VISION_MODEL", "VISION_MAX_TOKENS", "VISION_TIMEOUT_MS"])
  });
}

function readJson(req, maxBytes = 2_500_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });
    req.on("error", reject);
  });
}

async function handlePosterReview(req, res) {
  try {
    refreshVisionEnv();
    if (!getVisionApiKey()) {
      sendJson(res, 400, { error: "Visual model is not configured. Add DASHSCOPE_API_KEY or VISION_API_KEY to .env." });
      return;
    }
    const { imageDataUrl, metrics, posterContent, paperContext, stage, iteration, previousReview } = await readJson(req, 8_000_000);
    const result = await runPosterReviewAgent({
      imageDataUrl,
      metrics: metrics && typeof metrics === "object" ? metrics : {},
      posterContent: posterContent && typeof posterContent === "object" ? posterContent : {},
      paperContext: paperContext && typeof paperContext === "object" ? paperContext : {},
      stage: ["assets", "content", "layout", "final"].includes(stage) ? stage : "final",
      iteration: Math.max(1, Math.min(2, Number(iteration) || 1)),
      previousReview: previousReview && typeof previousReview === "object" ? previousReview : null,
      callModel: callVisionCompletionTool,
      callTextModel: getApiKey() ? callChatCompletionTool : null,
      onEvent: (event) => console.log(`[VISION] ${event.message || event.stage}`),
      options: {
        maxTokens: Number(process.env.VISION_MAX_TOKENS || 2200),
        timeoutMs: Number(process.env.VISION_TIMEOUT_MS || 90000),
        contentMaxTokens: Number(process.env.POSTER_REFINE_MAX_TOKENS || 1800),
        contentTimeoutMs: Number(process.env.POSTER_REFINE_TIMEOUT_MS || 60000)
      }
    });
    sendJson(res, 200, { ...result, model: getVisionModel(), version: appVersion });
  } catch (error) {
    console.error(`[API] /api/review-poster failed: ${error.message}`);
    sendJson(res, 500, {
      error: error.message || "Visual poster review failed.",
      model: getVisionModel(),
      version: appVersion
    });
  }
}

async function handleAssetCropInspection(req, res) {
  try {
    refreshVisionEnv();
    if (!getVisionApiKey()) {
      sendJson(res, 400, { code: "VISION_NOT_CONFIGURED", error: "Visual model is not configured." });
      return;
    }
    const { imageDataUrl, assetKind, caption, candidateBox } = await readJson(req, 6_000_000);
    const result = await assetCropVisionTool.run({
      imageDataUrl,
      assetKind: ["table", "formula", "figure"].includes(assetKind) ? assetKind : "table",
      caption: String(caption || "").slice(0, 500),
      candidateBox: candidateBox && typeof candidateBox === "object" ? candidateBox : {}
    });
    sendJson(res, 200, { inspection: result.inspection, model: getVisionModel(), version: appVersion });
  } catch (error) {
    console.error(`[API] /api/inspect-asset-crop failed: ${error.message}`);
    sendJson(res, 500, { error: error.message || "Visual asset crop inspection failed.", version: appVersion });
  }
}

async function handleTestVision(req, res) {
  try {
    refreshVisionEnv();
    if (!getVisionApiKey()) {
      sendJson(res, 400, { error: "Visual model is not configured. Add DASHSCOPE_API_KEY or VISION_API_KEY to .env." });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      baseUrl: getVisionBaseUrl(),
      model: getVisionModel(),
      version: appVersion
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Visual model configuration test failed." });
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function handleEvaluate(req, res) {
  try {
    const report = await evaluationRunTool.run({});
    sendJson(res, 200, { ...report, tool: { name: evaluationRunTool.name, summary: evaluationRunTool.summarize(report) }, version: appVersion });
  } catch (error) {
    console.error(`[API] /api/evaluate failed: ${error.message}`);
    sendJson(res, 500, { error: error.message || "Evaluation failed.", version: appVersion });
  }
}

async function handleAnalyzeAgent(req, res) {
  let streamStarted = false;
  try {
    const { text, sourceProfile, toolTrace, memory } = await readJson(req);
    if (!text || typeof text !== "string") {
      sendJson(res, 400, { error: "Missing paper text." });
      return;
    }
    if (!getApiKey()) {
      sendJson(res, 400, { error: "API key is not configured. Create a .env file with DEEPSEEK_API_KEY or OPENAI_API_KEY." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no"
    });
    streamStarted = true;
    const emit = (payload) => {
      if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify({ type: "stage", ...payload })}\n`);
    };

    console.log(`[AGENT] Starting paper analysis; raw chars=${text.length}; version=${appVersion}`);
    const result = await runPaperAgent({
      text,
      sourceProfile: sourceProfile && typeof sourceProfile === "object" ? sourceProfile : {},
      priorToolTrace: Array.isArray(toolTrace) ? toolTrace : [],
      memory: memory && typeof memory === "object" ? memory : null,
      callModel: (request) => callChatCompletionTool({ ...request, responseFormat: { type: "json_object" } }),
      onEvent: emit,
      options: {
        maxContextChars: Number(process.env.AGENT_CONTEXT_CHARS || 26000),
        taskContextChars: Number(process.env.AGENT_TASK_CONTEXT_CHARS || 6500),
        maxTaskRounds: Number(process.env.AGENT_MAX_TASK_ROUNDS || 6),
        taskEvidenceChars: Number(process.env.AGENT_TASK_EVIDENCE_CHARS || 6500),
        taskEvidenceChunks: Number(process.env.AGENT_TASK_EVIDENCE_CHUNKS || 5),
        analysisMaxTokens: Number(process.env.AGENT_ANALYSIS_TOKENS || 3200),
        verificationMaxTokens: Number(process.env.AGENT_VERIFY_TOKENS || 1400),
        analysisTimeoutMs: Number(process.env.AGENT_ANALYSIS_TIMEOUT_MS || 70000),
        verificationTimeoutMs: Number(process.env.AGENT_VERIFY_TIMEOUT_MS || 50000),
        inputCostPerMillion: Number(process.env.LLM_INPUT_COST_PER_MILLION || 0),
        outputCostPerMillion: Number(process.env.LLM_OUTPUT_COST_PER_MILLION || 0),
        verify: String(process.env.AGENT_VERIFY || "true").toLowerCase() !== "false"
      }
    });
    res.write(`${JSON.stringify({ type: "result", ...result, version: appVersion })}\n`);
    res.end();
  } catch (error) {
    console.error(`[API] /api/analyze-agent failed: ${error.message}`);
    if (!streamStarted) {
      sendJson(res, 500, { error: error.message || "Agent analysis failed." });
      return;
    }
    if (!res.destroyed && !res.writableEnded) {
      res.write(`${JSON.stringify({ type: "error", error: error.message || "Agent analysis failed." })}\n`);
      res.end();
    }
  }
}

async function handleAnalyze(req, res) {
  try {
    const { text } = await readJson(req);
    if (!text || typeof text !== "string") {
      sendJson(res, 400, { error: "Missing paper text." });
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      sendJson(res, 400, { error: "API key is not configured. Create a .env file with DEEPSEEK_API_KEY or OPENAI_API_KEY." });
      return;
    }

    const analysis = await callLLM(text);
    sendJson(res, 200, { analysis });
  } catch (error) {
    console.error(`[API] /api/analyze failed: ${error.message}`);
    sendJson(res, 500, { error: error.message || "Analysis failed." });
  }
}

async function handleTestLLM(req, res) {
  try {
    if (!getApiKey()) {
      sendJson(res, 400, { error: "API key is not configured. Check DEEPSEEK_API_KEY in .env." });
      return;
    }

    const result = await callChatCompletionTool({
      messages: [
        { role: "system", content: "You are a connection test. Reply briefly." },
        { role: "user", content: "Reply with exactly: OK" }
      ],
      maxTokens: 32,
      responseFormat: null,
      timeoutMs: Number(process.env.LLM_TEST_TIMEOUT_MS || 20000)
    });

    sendJson(res, 200, {
      ok: true,
      baseUrl: getBaseUrl(),
      model: getModel(),
      version: appVersion,
      reply: result.content
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "LLM test failed.",
      baseUrl: getBaseUrl(),
      model: getModel(),
      version: appVersion
    });
  }
}

async function handleArxivSource(req, res) {
  try {
    const { idOrUrl } = await readJson(req);
    const id = parseArxivId(idOrUrl);
    if (!id) {
      sendJson(res, 400, { error: "Please enter a valid arXiv ID or URL." });
      return;
    }

    console.log(`[ARXIV] Fetching source for ${id}`);
    const source = await fetchArxivSource(id);
    sendJson(res, 200, { id, ...source, version: appVersion });
  } catch (error) {
    console.error(`[API] /api/arxiv-source failed: ${error.message}`);
    sendJson(res, 500, { error: error.message || "arXiv source extraction failed." });
  }
}

async function handleArxivResolve(req, res) {
  try {
    const { title } = await readJson(req);
    if (!title || typeof title !== "string") {
      sendJson(res, 400, { error: "A complete paper title is required." });
      return;
    }
    const match = await resolveArxivIdByTitle(title);
    sendJson(res, 200, { match, version: appVersion });
  } catch (error) {
    console.error(`[API] /api/arxiv-resolve failed: ${error.message}`);
    sendJson(res, 500, { error: error.message || "arXiv title lookup failed." });
  }
}

function handleArxivAsset(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const id = parseArxivId(url.searchParams.get("id"));
    const assetPath = url.searchParams.get("path");
    const asset = getCachedAsset(arxivAssetCache, id, assetPath);
    if (!asset) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Figure asset not found. Reload the arXiv source first.");
      return;
    }

    res.writeHead(200, {
      "Content-Type": asset.mime,
      "Content-Length": asset.data.length,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(asset.data);
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Could not load figure asset." });
  }
}

async function handleArxivPdf(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const id = parseArxivId(url.searchParams.get("id"));
    if (!id) {
      sendJson(res, 400, { error: "Invalid arXiv ID." });
      return;
    }

    const data = await fetchArxivPdfTool(id, arxivPdfCache);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": data.length,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(data);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Could not load arXiv PDF." });
  }
}

async function callLLM(text) {
  const contextBundle = buildPaperContext(text, {
    maxChars: Number(process.env.AGENT_CONTEXT_CHARS || 26000)
  });
  const preparedText = contextBundle.context;
  console.log(`[API] /api/analyze received; raw chars=${text.length}; GSSC chars=${preparedText.length}; version=${appVersion}`);
  const result = await callChatCompletionTool({
    messages: [
      {
        role: "system",
        content: [
          "You are PaperReadingAgent, a rigorous academic paper reading assistant.",
          "Your job is not to summarize casually. You must reconstruct the paper's argument chain.",
          "Extract evidence from the provided text, judge whether the method supports the problem, and judge whether experiments validate the claims.",
          "Write compact poster-ready content: concrete, scannable, and concise.",
          "Return only valid JSON. Do not include Markdown fences.",
          "If the paper text is noisy because it came from a PDF, ignore headers, footers, references, page numbers, and repeated fragments.",
          "Use Chinese when the paper text or user-facing context is Chinese; otherwise use English."
        ].join(" ")
      },
      {
        role: "user",
        content: `${analysisSchemaPrompt()}\n\nGSSC paper context:\n${preparedText}`
      }
    ],
    maxTokens: Number(process.env.LLM_MAX_TOKENS || 3000),
    responseFormat: { type: "json_object" },
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 60000),
    textChars: preparedText.length
  });

  try {
    return JSON.parse(result.content);
  } catch {
    throw new Error(`LLM did not return valid JSON. First 200 chars: ${result.content.slice(0, 200)}`);
  }
}

function parseArxivId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const clean = text
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf|e-print)\//i, "")
    .replace(/\.pdf$/i, "")
    .split(/[?#]/)[0]
    .trim();
  const modern = clean.match(/^\d{4}\.\d{4,5}(?:v\d+)?$/i);
  if (modern) return modern[0];
  const legacy = clean.match(/^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?$/i);
  if (legacy) return legacy[0];
  return "";
}

async function fetchArxivSource(id) {
  const toolTrace = [];
  const tools = createExtractionTools({
    trace: toolTrace,
    deps: { assetCache: arxivAssetCache }
  });

  const extraction = await runSourceExtractionAgent({
    sourceProfile: { sourceType: "arxiv", arxivId: id },
    input: { arxivId: id },
    tools
  });
  const { bundle, formulas, figures } = extraction;
  let { tables } = extraction;
  const { files, texFiles, mainTex, combinedTex } = bundle;
  if (String(process.env.ENABLE_LATEX_TABLE_RENDER || "true").toLowerCase() !== "false") {
    await renderLatexTableImagesTool(id, combinedTex, tables, files, arxivAssetCache);
  }
  const plainText = toolLatexToPlainText(combinedTex);
  const titleLines = toolExtractLatexTitleLines(combinedTex);
  const title = toolExtractLatexTitle(combinedTex);
  const paperText = buildArxivPaperText({
    id,
    title,
    mainFile: mainTex.name,
    formulas,
    figures,
    tables,
    plainText
  });

  return {
    mainFile: mainTex.name,
    fileCount: files.length,
    texFileCount: texFiles.length,
    formulaCount: formulas.length,
    figureCount: figures.length,
    tableCount: tables.length,
    tableImageCount: tables.filter((table) => table.image?.url).length,
    title,
    titleLines,
    paperText,
    formulas,
    figures,
    tables,
    tools: toolTrace,
    toolPlan: extraction.toolPlan
  };
}

function buildArxivPaperText({ id, title, mainFile, formulas, figures, tables, plainText }) {
  const formulaText = formulas.length
    ? formulas.map((formula, index) => `Formula ${index + 1}:\n$$\n${formula}\n$$`).join("\n\n")
    : "No display formula found in LaTeX source.";
  const figureText = figures.length
    ? figures.map((figure, index) => `Figure ${index + 1}: [${figure.caption}] Source: ${figure.source}`).join("\n")
    : "No figure environment found in LaTeX source.";
  const tableText = tables.length
    ? tables.map((table, index) => `Table ${index + 1}: [${table.caption}] Source: ${table.source}`).join("\n")
    : "No table environment found in LaTeX source.";

  return [
    `# ${title || `arXiv:${id}`}`,
    `Source: arXiv:${id}`,
    `Main source file: ${mainFile}`,
    "",
    "## Reliable Formulas Extracted From LaTeX",
    formulaText,
    "",
    "## Figures Extracted From LaTeX",
    figureText,
    "",
    "## Tables Extracted From LaTeX",
    tableText,
    "",
    "## Paper Text Extracted From LaTeX",
    plainText
  ].join("\n");
}

function preparePaperText(text, maxChars) {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return true;
      if (/^page\s+\d+$/i.test(line)) return false;
      if (/^\d+$/.test(line)) return false;
      if (/^(references|bibliography)\b/i.test(line)) return false;
      return true;
    })
    .join("\n");

  return cleaned.slice(0, maxChars);
}

function getApiKey() {
  const key = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || isPlaceholderKey(key)) return "";
  return key;
}

function isPlaceholderKey(key) {
  const normalized = String(key).trim().toLowerCase();
  return (
    normalized.includes("your_") ||
    normalized.includes("api_key") ||
    normalized.endsWith("here") ||
    normalized.includes("paste") ||
    normalized.includes("placeholder")
  );
}

function getBaseUrl() {
  if (process.env.OPENAI_BASE_URL) {
    return process.env.OPENAI_BASE_URL.replace(/\/$/, "");
  }

  if (process.env.DEEPSEEK_API_KEY) {
    return "https://api.deepseek.com";
  }

  return "https://api.openai.com/v1";
}

function getModel() {
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  if (process.env.DEEPSEEK_API_KEY || getBaseUrl().includes("deepseek")) return "deepseek-chat";
  return "gpt-4o-mini";
}

function getVisionApiKey() {
  const key = process.env.VISION_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!key || isPlaceholderKey(key)) return "";
  return key;
}

function getVisionBaseUrl() {
  return String(process.env.VISION_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
}

function getVisionModel() {
  return process.env.VISION_MODEL || "qwen-vl-max";
}

function analysisSchemaPrompt() {
  return `Analyze the paper briefly before producing JSON:
1. Identify the paper's core argument chain: problem -> motivation -> method -> evidence -> contribution.
2. Extract concrete details: datasets, baselines, metrics, formulas, figures/tables, and key experimental findings when present.
3. Critically evaluate: whether the proposed method actually addresses the stated problem; whether experiments validate the claims; what is missing or weak.
4. Rewrite the result as poster-ready content, not long paragraphs.

Rules:
- Do not invent datasets, metrics, formulas, or figures that are not present in the text.
- Do not reconstruct formulas from noisy PDF text. Use formulas only when exact LaTeX is explicitly present in the input text.
- If evidence is missing, say "not found in extracted text" instead of pretending.
- Each main field must be useful on a poster.
- Prefer 1 concise sentence per field. Avoid long paragraphs.
- "logicReview" must be a critical assessment, not another summary.
- "figures" should include paper figure/table placeholders if mentioned, or suggest useful reconstructed diagrams if original figures are unavailable.
- Return JSON with exactly these keys:
{
  "title": "paper title",
  "summary": "1-2 sentence high-level summary focused on the paper's core idea",
  "problem": "specific research problem addressed by the paper",
  "motivation": "why the problem matters and what gap motivates the work",
  "method": "core method or framework, including pipeline steps when possible",
  "theory": "important theory, assumptions, objective functions, or formula explanation",
  "experiments": "experimental setup: datasets, baselines, metrics, ablations if found",
  "results": "main findings with concrete evidence or 'not found in extracted text'",
  "contributions": "main contributions as poster-ready bullet-like prose",
  "innovation": "what is novel compared with prior work",
  "logicReview": "critical review: does method support the problem and do experiments validate claims?",
  "methodSupportsProblem": "specific judgment on whether the method solves the stated problem",
  "experimentsValidateClaims": "specific judgment on whether experiments verify the claims",
  "formulas": [],
  "figures": [{"name": "up to 3 figure/table placeholder names", "source": "where it appears or what should be inserted"}]
}`;
}

if (require.main === module) {
  server.listen(port, () => {
    console.log(`PaperDragon is running at http://localhost:${port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Close the old server or start with another port, for example:`);
      console.error(`$env:PORT=5174; node server.js`);
      process.exit(1);
    }

    console.error(error);
    process.exit(1);
  });
}

module.exports = server;
