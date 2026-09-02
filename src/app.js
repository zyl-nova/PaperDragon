const input = document.querySelector("#paperInput");
const pdfInput = document.querySelector("#pdfInput");
const arxivInput = document.querySelector("#arxivInput");
const loadArxivBtn = document.querySelector("#loadArxivBtn");
const pdfStatus = document.querySelector("#pdfStatus");
const analyzeBtn = document.querySelector("#analyzeBtn");
const loadSampleBtn = document.querySelector("#loadSampleBtn");
const clearBtn = document.querySelector("#clearBtn");
const testApiBtn = document.querySelector("#testApiBtn");
const evaluateBtn = document.querySelector("#evaluateBtn");
const visualReviewBtn = document.querySelector("#visualReviewBtn");
const exportBtn = document.querySelector("#exportBtn");
const poster = document.querySelector("#poster");
const posterPaperLink = document.querySelector("#posterPaperLink");
const posterPreviewFrame = document.querySelector("#posterPreviewFrame");
const agentFlow = document.querySelector("#agentFlow");
const agentTrace = document.querySelector("#agentTrace");
const agentMonitorRoot = document.querySelector("#agentMonitor");
const evaluationStatus = document.querySelector("#evaluationStatus");
const evaluationBadge = document.querySelector("#evaluationBadge");
const evaluationMetrics = document.querySelector("#evaluationMetrics");
const evaluationCases = document.querySelector("#evaluationCases");
const visualReviewStatus = document.querySelector("#visualReviewStatus");
const visualReviewBadge = document.querySelector("#visualReviewBadge");
const visualReviewScores = document.querySelector("#visualReviewScores");
const visualReviewSummary = document.querySelector("#visualReviewSummary");
const visualReviewIssues = document.querySelector("#visualReviewIssues");
const memoryStatus = document.querySelector("#memoryStatus");
const memoryOutlineContent = document.querySelector("#memoryOutlineContent");
const annotationInput = document.querySelector("#annotationInput");
const annotationList = document.querySelector("#annotationList");
const addAnnotationBtn = document.querySelector("#addAnnotationBtn");
const questionInput = document.querySelector("#questionInput");
const questionList = document.querySelector("#questionList");
const addQuestionBtn = document.querySelector("#addQuestionBtn");
const clientVersion = "2026-09-01-evidence-layout-v87";
let reliableArxivFigures = [];
let reliableArxivTables = [];
let reliableArxivFormulas = [];
let reliableArxivPaperText = "";
let reliablePdfFormulaImages = [];
let reliablePdfAssetPageMap = { figures: {}, tables: {} };
let serverPreprocessingTrace = [];
let currentSourceProfile = { sourceType: "text" };
let currentMemory = null;
let currentAnalysis = null;
let memoryRefreshTimer = null;
let automaticPaperPipelineRunning = false;
let currentUploadedPdfUrl = "";
let posterPreviewVersion = 0;
let posterPreviewCleanup = null;
let sourceRevision = 0;
let activeAnalysisController = null;
let activeVisionController = null;
let exactFormulaLookupCompleted = false;
let posterGenerationPromise = null;
let posterGenerationRevision = -1;
let posterRecoveryPromise = null;
let posterRecoveryRevision = -1;

window.addEventListener("message", (event) => {
  if (event.source !== posterPreviewFrame?.contentWindow) return;
  if (event.data?.type === "paper-evidence-viewer") {
    document.body.classList.toggle("poster-evidence-active", Boolean(event.data.open));
    return;
  }
  if (event.data?.type === "paper-evidence-open-paper") {
    const page = Math.max(0, Number(event.data.page) || 0);
    const sourceUrl = currentUploadedPdfUrl || currentAnalysis?.paperUrl || "";
    if (!sourceUrl) {
      setStatus("The original paper is not available for this text-only poster.", "error");
      return;
    }
    const pageUrl = page && (/^blob:/i.test(sourceUrl) || /\.pdf(?:[?#]|$)/i.test(sourceUrl))
      ? `${sourceUrl.replace(/#.*$/, "")}#page=${page}`
      : sourceUrl;
    window.open(pageUrl, "_blank", "noopener");
  }
});
const { extractFormulas, extractFigures } = window.PaperToolAlgorithms;
const { compactPosterPoints, preparePosterForExport, stripPosterEvidenceCues } = window.PosterExportTools;
const { refinePosterLayout } = window.PosterLayoutPlanner;
const posterVisionReview = window.PosterVisionReview;
const posterAssetPlacement = window.PosterAssetPlacement;
const paperApi = window.PaperApi;
const paperSourceIdentity = window.PaperSourceIdentity;
const browserTools = window.createPaperBrowserTools({ waitForPdfJs, setStatus });
const paperMemory = window.PaperMemory.createPaperMemoryStore(window.localStorage);
const agentMonitor = window.AgentObservability.createAgentMonitor(agentMonitorRoot);
const paperPet = window.PaperPet.create({
  root: document.querySelector("#paperPet"),
  onPdfDrop: runAutomaticPaperPipeline
});

const targets = {
  title: document.querySelector("#posterTitle"),
  summary: document.querySelector("#posterSummary"),
  problem: document.querySelector("#problemText"),
  motivation: document.querySelector("#motivationText"),
  method: document.querySelector("#methodText"),
  formula: document.querySelector("#formulaList"),
  figures: document.querySelector("#figureList"),
  result: document.querySelector("#resultText"),
  contribution: document.querySelector("#contributionText")
};

const zh = {
  abstract: "\u6458\u8981",
  problem: "\u95ee\u9898",
  challenge: "\u6311\u6218",
  gap: "\u7f3a\u53e3",
  lack: "\u4e0d\u8db3",
  motivation: "\u52a8\u673a",
  meaning: "\u610f\u4e49",
  background: "\u80cc\u666f",
  value: "\u4ef7\u503c",
  method: "\u65b9\u6cd5",
  idea: "\u601d\u8def",
  framework: "\u6846\u67b6",
  model: "\u6a21\u578b",
  algorithm: "\u7b97\u6cd5",
  result: "\u7ed3\u679c",
  experiment: "\u5b9e\u9a8c",
  verify: "\u9a8c\u8bc1",
  performance: "\u6027\u80fd",
  contribution: "\u8d21\u732e",
  innovation: "\u521b\u65b0",
  propose: "\u63d0\u51fa",
  image: "\u56fe\u7247",
  figureCn: "\u63d2\u56fe",
  graph: "\u56fe"
};

const samplePaper = `# Chain-of-Thought Prompting Elicits Reasoning in Large Language Models

${zh.abstract}: This paper studies how chain-of-thought prompting enables large language models to generate intermediate reasoning steps and improve arithmetic, commonsense, and symbolic reasoning.

${zh.problem}: Standard prompting asks the model to output the answer directly, which often fails on multi-step reasoning tasks.
${zh.motivation}: Explicit reasoning chains may help the model decompose complex questions into smaller steps.
${zh.method}: The authors add human-written reasoning examples into few-shot prompts and guide the model to produce step-by-step reasoning.
Theory: The reasoning chain can be viewed as an observable expansion of an implicit computation process.
Formula: $p(y|x)=\\sum_z p(y|z,x)p(z|x)$
${zh.experiment}: The paper evaluates standard prompting and chain-of-thought prompting on GSM8K, MultiArith, and CommonsenseQA.
${zh.result}: When the model is large enough, chain-of-thought prompting significantly improves accuracy on complex reasoning tasks.
${zh.contribution}: The paper proposes a simple and effective prompting paradigm and shows that intermediate reasoning steps can improve LLM reasoning.
${zh.innovation}: The method does not update model parameters; it elicits reasoning ability through prompt design.

${zh.image}: [Figure 1: Chain-of-thought prompting workflow]
${zh.image}: [Figure 2: Accuracy changes across model scales]`;

const keywordMap = {
  problem: [zh.problem, zh.challenge, zh.gap, zh.lack, "gap", "problem", "challenge", "limitation"],
  motivation: [zh.motivation, zh.meaning, zh.background, zh.value, "motivation", "importance", "background"],
  method: [zh.method, zh.idea, zh.framework, zh.model, zh.algorithm, "method", "approach", "framework", "model", "algorithm"],
  result: [zh.result, zh.experiment, zh.verify, zh.performance, "result", "experiment", "evaluation", "performance"],
  contribution: [zh.contribution, zh.innovation, zh.propose, "contribution", "innovation", "novel", "propose"]
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function splitSentences(text) {
  return text
    .replace(/\r/g, "")
    .replace(/(\d)\.(\d)/g, "$1\uE000$2")
    .replace(/\b(e)\.\s*(g)\./gi, "$1\uE001$2\uE001")
    .replace(/\b(i)\.\s*(e)\./gi, "$1\uE001$2\uE001")
    .replace(/\b(et)\s+(al)\./gi, "$1 $2\uE001")
    .split(/(?<=[\u3002\uff01\uff1f.!?])\s+|\n+/)
    .map((item) => item.replace(/[\uE000\uE001]/g, ".").trim())
    .filter(Boolean);
}

function getTitle(text) {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#\s+/.test(line));
  if (heading) return heading.replace(/^#\s+/, "");
  const titleLine = lines.find((line) => line.length > 8 && line.length < 120 && !line.includes(zh.abstract));
  return titleLine || "Untitled Paper Poster";
}

function isReliableSourceTitle(value) {
  const title = String(value || "").trim();
  return Boolean(title
    && title.length >= 5
    && !/^(?:untitled|arxiv:.*(?:source)?|main source file|page\s+\d+)/i.test(title));
}

function createSourceIdentity(sourceProfile, text) {
  if (!paperSourceIdentity) throw new Error("Paper identity checker failed to load. Refresh the page before continuing.");
  const identity = paperSourceIdentity.create(sourceProfile, text);
  const recovered = identity.consistent
    ? identity
    : paperSourceIdentity.reconcile?.(sourceProfile, text) || identity;
  return paperSourceIdentity.assertConsistent(
    recovered,
    "The title or link does not belong to the extracted paper."
  );
}

function bindProfileIdentity(sourceProfile, identity) {
  return {
    ...sourceProfile,
    title: identity.title,
    titleLines: identity.titleLines,
    doi: identity.doi,
    paperUrl: identity.paperUrl,
    sourceIdentityKey: identity.key,
    sourceContentHash: identity.contentHash,
    identityRepaired: Boolean(identity.repaired),
    identityRepairedFields: Array.isArray(identity.repairedFields) ? identity.repairedFields : []
  };
}

function commitSourceProfile(sourceProfile, text) {
  const identity = createSourceIdentity(sourceProfile, text);
  currentSourceProfile = bindProfileIdentity(sourceProfile, identity);
  return identity;
}

function bindAnalysisToSource(analysis, sourceProfile, text, strict = true) {
  const identity = createSourceIdentity(sourceProfile, text);
  analysis._sourceIdentity = { ...identity, strict };
  analysis.title = identity.title || analysis.title || "Untitled Paper Poster";
  analysis.titleLines = identity.titleLines;
  analysis.doi = identity.doi;
  analysis.paperUrl = identity.paperUrl;
  return analysis;
}

function assertCurrentAnalysisIdentity() {
  if (!currentAnalysis?._sourceIdentity?.strict) return true;
  const identityText = paperSourceIdentity.canonicalText(reliableArxivPaperText, input.value);
  const currentIdentity = createSourceIdentity(currentSourceProfile, identityText);
  if (!paperSourceIdentity.matches(currentAnalysis._sourceIdentity, currentIdentity)) {
    const error = new Error("This poster belongs to a previous paper. Regenerating the current paper automatically.");
    error.code = "STALE_POSTER";
    throw error;
  }
  return true;
}

function isStalePosterError(error) {
  return error?.code === "STALE_POSTER" || /poster belongs to a previous paper/i.test(error?.message || "");
}

function clearRenderedPosterForRecovery() {
  activeVisionController?.abort();
  activeVisionController = null;
  currentAnalysis = null;
  posterPreviewCleanup?.();
  posterPreviewCleanup = null;
  posterPreviewVersion += 1;
  if (posterPreviewFrame) posterPreviewFrame.srcdoc = "<!doctype html><html><body></body></html>";
  if (posterPaperLink) {
    posterPaperLink.hidden = true;
    posterPaperLink.removeAttribute("href");
    posterPaperLink.textContent = "";
  }
  renderPosterTitle("Regenerating current paper");
  targets.summary.textContent = "The previous poster was discarded. Rebuilding from the currently loaded paper...";
  for (const target of [targets.problem, targets.motivation, targets.method, targets.formula, targets.figures, targets.result, targets.contribution]) {
    target.replaceChildren();
  }
  resetVisualReview();
}

async function ensureCurrentPoster(action = "continuing") {
  if (currentAnalysis) {
    try {
      assertCurrentAnalysisIdentity();
      return true;
    } catch (error) {
      console.warn("Discarding stale poster before recovery:", error);
    }
  }

  if (!input.value.trim()) {
    setStatus("The current paper is still loading. Wait for extraction to finish, then try again.", "loading");
    return false;
  }

  if (posterRecoveryPromise && posterRecoveryRevision === sourceRevision) return posterRecoveryPromise;
  const recoveryRevision = sourceRevision;
  const recovery = (async () => {
    clearRenderedPosterForRecovery();
    setStatus(`The previous poster was discarded. Automatically regenerating the current paper before ${action}...`, "loading");
    try {
      await generatePoster();
    } catch (error) {
      console.error("Automatic poster recovery failed:", error);
      setStatus(`${error.message || "Automatic regeneration failed."} The current paper remains loaded; Generate Poster can be retried.`, "error");
      return false;
    }
    if (recoveryRevision !== sourceRevision) return false;
    if (!currentAnalysis) {
      setStatus("The current paper could not be regenerated yet. Its extracted content is preserved; retry Generate Poster.", "error");
      return false;
    }
    try {
      assertCurrentAnalysisIdentity();
      return true;
    } catch (error) {
      clearRenderedPosterForRecovery();
      setStatus("Regeneration finished with mismatched paper identity, so the result was discarded. Reload the current PDF once.", "error");
      return false;
    }
  })();
  posterRecoveryPromise = recovery;
  posterRecoveryRevision = recoveryRevision;
  try {
    return await recovery;
  } finally {
    if (posterRecoveryPromise === recovery) {
      posterRecoveryPromise = null;
      posterRecoveryRevision = -1;
    }
  }
}

function beginNewPaperSource(label = "paper") {
  const revision = ++sourceRevision;
  activeAnalysisController?.abort();
  activeVisionController?.abort();
  activeAnalysisController = null;
  activeVisionController = null;
  clearTimeout(memoryRefreshTimer);
  clearUploadedPdfUrl();
  browserTools.clearTrace();
  serverPreprocessingTrace = [];
  reliableArxivFormulas = [];
  reliableArxivPaperText = "";
  reliableArxivFigures = [];
  reliableArxivTables = [];
  reliablePdfFormulaImages = [];
  reliablePdfAssetPageMap = { figures: {}, tables: {} };
  exactFormulaLookupCompleted = false;
  currentAnalysis = null;
  currentMemory = null;
  currentSourceProfile = { sourceType: "pending", sourceLabel: label };
  input.value = "";
  posterPreviewCleanup?.();
  posterPreviewCleanup = null;
  posterPreviewVersion += 1;
  if (posterPreviewFrame) posterPreviewFrame.srcdoc = "<!doctype html><html><body></body></html>";
  if (posterPaperLink) {
    posterPaperLink.hidden = true;
    posterPaperLink.removeAttribute("href");
    posterPaperLink.textContent = "";
  }
  renderPosterTitle(`Reading ${label}`);
  targets.summary.textContent = "Extracting the new paper source...";
  for (const target of [targets.problem, targets.motivation, targets.method, targets.formula, targets.figures, targets.result, targets.contribution]) {
    target.replaceChildren();
  }
  resetVisualReview();
  resetAgentFlow();
  renderNotebook();
  return revision;
}

function pickByKeywords(sentences, keys, fallback) {
  const matches = sentences.filter((sentence) =>
    keys.some((key) => sentence.toLowerCase().includes(key.toLowerCase()))
  );
  return matches.slice(0, 2).join(" ") || fallback;
}

function toMathJaxDisplay(formula) {
  const commonMacros = {
    dmodel: "d_{\\mathrm{model}}",
    dkey: "d_k",
    dvalue: "d_v",
    dff: "d_{\\mathrm{ff}}"
  };
  let text = String(formula || "").trim();
  text = text
    .replace(/\\bm\{([^{}]+)\}/g, "\\mathbf{$1}")
    .replace(/\\bm([A-Za-z])/g, "\\mathbf{$1}");
  for (const [name, replacement] of Object.entries(commonMacros)) {
    text = text.replace(new RegExp(`\\\\${name}(?![A-Za-z@])`, "g"), `{${replacement}}`);
  }
  if (!/^\\begin\{/.test(text) && window.PaperInlineMath?.toMathJaxInline) {
    text = window.PaperInlineMath.toMathJaxInline(text);
  }
  const env = text.match(/^\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)\}([\s\S]*?)\\end\{\1\}$/);
  if (!env) return text;

  const name = env[1].replace("*", "");
  const body = env[2].trim();
  if (name === "equation") return body;
  if (name === "align" || name === "eqnarray") return `\\begin{aligned}\n${body}\n\\end{aligned}`;
  if (name === "gather") return `\\begin{gathered}\n${body}\n\\end{gathered}`;
  if (name === "multline") return `\\begin{aligned}\n${body}\n\\end{aligned}`;
  return body;
}

function makeList(items) {
  const cleanItems = items.filter(Boolean);
  if (!cleanItems.length) return "--";
  return `<ul>${cleanItems.map((item) => `<li>${renderInlineMathText(item)}</li>`).join("")}</ul>`;
}

function renderInlineMathText(value) {
  return window.PaperInlineMath?.renderInlineMath
    ? window.PaperInlineMath.renderInlineMath(value)
    : escapeHtml(value);
}

function renderStandaloneFormula(formula, useLocalRenderer = false) {
  if (useLocalRenderer && window.PaperInlineMath?.toReadableMathHtml) {
    return `<div class="formula-readable-display">${window.PaperInlineMath.toReadableMathHtml(formula)}</div>`;
  }
  return `\\[${escapeHtml(toMathJaxDisplay(formula))}\\]`;
}

function localAnalyzePaper(text) {
  const limitedText = text.slice(0, 12000);
  const sentences = splitSentences(limitedText);
  const formulas = extractFormulas(limitedText);
  const figures = extractFigures(limitedText);
  const title = getTitle(limitedText);
  const summary = pickByKeywords(sentences, [zh.abstract, "abstract"], sentences.slice(0, 2).join(" "));

  const analysis = {
    title,
    summary: summary || "No abstract detected. Add the abstract or introduction section for a better poster.",
    problem: pickByKeywords(sentences, keywordMap.problem, "No clear research problem detected. Add the problem statement from the introduction."),
    motivation: pickByKeywords(sentences, keywordMap.motivation, "No motivation detected. Add research background, value, or significance."),
    method: pickByKeywords(sentences, keywordMap.method, "No method description detected. Add model structure, algorithm flow, or core formula."),
    theory: "",
    experiments: pickByKeywords(sentences, keywordMap.result, ""),
    results: pickByKeywords(sentences, keywordMap.result, "No experimental result detected. Add datasets, metrics, baselines, and conclusions."),
    contributions: pickByKeywords(sentences, keywordMap.contribution, "No contribution or innovation detected. Add the paper's main claims."),
    innovation: "",
    logicReview: "Local fallback analysis used keyword extraction. Configure an LLM API for deeper critique.",
    methodSupportsProblem: "Needs LLM review.",
    experimentsValidateClaims: "Needs LLM review.",
    formulas,
    figures,
    tables: [],
    source: "local"
  };

  return withQualityChecks(analysis);
}

function withQualityChecks(analysis) {
  const checks = [
    { name: "Research problem", ok: !startsWithMissing(analysis.problem) },
    { name: "Motivation", ok: !startsWithMissing(analysis.motivation) },
    { name: "Method", ok: !startsWithMissing(analysis.method) },
    { name: "Experiment result", ok: !startsWithMissing(analysis.results) },
    { name: "Contribution", ok: !startsWithMissing(analysis.contributions) },
    {
      name: "Formula or theoretical mechanism",
      ok: (Array.isArray(analysis.formulas) && analysis.formulas.length > 0) || Boolean(analysis.theory && !startsWithMissing(analysis.theory))
    },
    { name: "Figure or table evidence", ok: (Array.isArray(analysis.figures) && analysis.figures.length > 0) || (Array.isArray(analysis.tables) && analysis.tables.length > 0) },
    { name: "Critical logic review", ok: Boolean(analysis.logicReview && !analysis.logicReview.includes("fallback")) }
  ];

  analysis.score = Math.round((checks.filter((item) => item.ok).length / checks.length) * 100);
  analysis.checks = checks;
  return analysis;
}

function startsWithMissing(value) {
  return !value || /^No |^Needs /.test(value);
}

function normalizeLLMAnalysis(data, sourceText, toolAssets = {}, sourceProfile = currentSourceProfile) {
  const cleanTitle = window.PosterExportTools?.cleanPosterTitle || ((value) => String(value || "").replace(/\s+(?:abstract|introduction|keywords?)\s*$/i, "").trim());
  const textTitle = cleanTitle(getTitle(sourceText.slice(0, 1200)));
  const sourceTitle = cleanTitle(sourceProfile.title || "");
  const sourceIdentity = createSourceIdentity(sourceProfile, sourceText);
  const reliableSourceHead = sourceText.slice(0, 16000);
  const sourceFormulas = dedupeStrings([
    ...(Array.isArray(toolAssets.formulas) ? toolAssets.formulas : []),
    ...extractFormulas(reliableSourceHead)
  ]).slice(0, 12);
  const sourceFormulaImages = Array.isArray(toolAssets.formulaImages)
    ? toolAssets.formulaImages
    : reliablePdfFormulaImages;
  const sourceFigures = Array.isArray(toolAssets.figures) ? toolAssets.figures : extractFigures(reliableSourceHead);
  const repairedTheory = window.PaperInlineMath?.repairMissingInlineMath
    ? window.PaperInlineMath.repairMissingInlineMath(safePosterText(data.theory, "", 500), [...sourceFormulas, reliableSourceHead])
    : safePosterText(data.theory, "", 500);
  const supportingTheoryFormula = window.PaperInlineMath?.findComplexityFormula
    ? window.PaperInlineMath.findComplexityFormula([...sourceFormulas, reliableSourceHead], repairedTheory)
    : "";
  const title = window.PosterExportTools?.resolvePosterTitle
    ? window.PosterExportTools.resolvePosterTitle(sourceTitle, textTitle, safeText(data.title, "", 240))
    : cleanTitle(isReliableSourceTitle(sourceTitle) ? sourceTitle : isReliableSourceTitle(textTitle) ? textTitle : safeText(data.title, textTitle, 240));
  const groundedAssets = window.PosterAssetSelector?.attachPdfPageReferences?.(
    normalizeFigures(reliableArxivFigures, 16),
    normalizeTables(reliableArxivTables, 8),
    reliablePdfAssetPageMap
  ) || {
    figures: normalizeFigures(reliableArxivFigures, 16),
    tables: normalizeTables(reliableArxivTables, 8)
  };
  const methodText = safePosterText(data.method, "No method returned by LLM.", 700);
  const repairedMethod = window.PaperContentIntegrity?.repairPhaseNarrative
    ? window.PaperContentIntegrity.repairPhaseNarrative(methodText, sourceText)
    : methodText;
  const analysis = {
    title,
    doi: sourceIdentity.doi,
    paperUrl: sourceIdentity.paperUrl,
    titleLines: sourceIdentity.titleLines,
    summary: safePosterText(data.summary, "No summary returned by LLM.", 600),
    problem: safePosterText(data.problem, "No clear research problem returned by LLM.", 500),
    motivation: safePosterText(data.motivation, "No motivation returned by LLM.", 1200),
    method: repairedMethod,
    theory: repairedTheory,
    experiments: safePosterText(data.experiments, "", 600),
    results: safePosterText(data.results, "No experimental result returned by LLM.", 600),
    contributions: safePosterText(data.contributions || data.contribution, "No contribution returned by LLM.", 600),
    innovation: safePosterText(data.innovation, "", 500),
    logicReview: safePosterText(data.logicReview || data.logic_review, "", 700),
    methodSupportsProblem: safePosterText(data.methodSupportsProblem || data.method_supports_problem, "", 500),
    experimentsValidateClaims: safePosterText(data.experimentsValidateClaims || data.experiments_validate_claims, "", 500),
    assetRecommendations: normalizeAssetRecommendations(data.assetRecommendations),
    formulas: sourceFormulas,
    sourceFormulas: [...sourceFormulas],
    supportingTheoryFormula,
    // Keep exact LaTeX and PDF crops available until semantic asset selection.
    // A parsed formula can later be rejected as background/complexity-only evidence,
    // in which case the original PDF crop is still a reliable fallback.
    formulaImages: sourceFormulaImages.slice(0, 6),
    figures: dedupeFigures([
      ...groundedAssets.figures,
      ...sourceFigures,
      ...normalizeFigures(data.figures, 5)
    ]).slice(0, 16),
    tables: groundedAssets.tables,
    source: data.source || "llm"
  };
  return bindAnalysisToSource(withQualityChecks(analysis), sourceProfile, sourceText, true);
}

function safeText(value, fallback = "", maxLength = 500) {
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (Array.isArray(value)) {
    text = value.map((item) => safeText(item, "", 180)).filter(Boolean).join("; ");
  } else if (value && typeof value === "object") {
    text = Object.values(value).map((item) => safeText(item, "", 180)).filter(Boolean).join("; ");
  }

  text = (text || fallback || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function safePosterText(value, fallback = "", maxLength = 500) {
  const text = safeText(value, fallback, Math.max(maxLength * 4, 2400));
  if (text.length <= maxLength) return text;
  const points = compactPosterPoints(text, 4, maxLength);
  return points.join(" ") || text.slice(0, maxLength).trim();
}

function normalizeList(value, limit, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => safeText(item, "", maxLength)).filter(Boolean);
}

function normalizeAssetRecommendations(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).map((item) => ({
    type: safeText(item?.type, "", 20).toLowerCase(),
    reference: safeText(item?.reference, "", 80),
    section: ["method", "theory", "results"].includes(String(item?.section || "").toLowerCase())
      ? String(item.section).toLowerCase()
      : "",
    purpose: safePosterText(item?.purpose, "Key paper evidence", 180),
    insight: safePosterText(item?.insight, "", 320)
  })).filter((item) => ["formula", "figure", "table"].includes(item.type) && item.reference);
}

function normalizeFigures(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item, index) => {
    if (typeof item === "string") {
      return { name: safeText(item, `Figure ${index + 1}`, 160), source: "Original paper figure placeholder" };
    }
    return {
      name: safeText(item?.name, `Figure ${index + 1}`, 160),
      source: safeText(item?.source, "Original paper figure placeholder", 240),
      caption: safePosterText(item?.caption, "", 500),
      assets: Array.isArray(item?.assets)
        ? item.assets.slice(0, 6).map((asset) => ({
            url: normalizeAssetUrl(asset?.url),
            type: safeText(asset?.type, "", 80),
            path: safeText(asset?.path, "", 240)
          })).filter((asset) => asset.url)
        : []
    };
  });
}

function normalizeAssetUrl(value) {
  const url = String(value || "").trim();
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(url)) return url;
  return safeText(url, "", 500);
}

function normalizePaperUrl(value) {
  const url = String(value || "").trim();
  return /^https:\/\/(?:doi\.org|arxiv\.org)\//i.test(url) ? url : "";
}

function normalizeTables(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((table, index) => ({
    name: safeText(table?.name, `Table ${index + 1}`, 120),
    caption: safePosterText(table?.caption, "", 500),
    source: safeText(table?.source, "Original paper artwork", 300),
    image: table?.image?.url ? {
      url: normalizeAssetUrl(table.image.url),
      type: safeText(table.image.type, "image/png", 80),
      path: safeText(table.image.path, "", 240)
    } : null,
    pdfCrop: table?.pdfCrop?.url ? {
      url: safeText(table.pdfCrop.url, "", 500),
      fallbackUrl: safeText(table.pdfCrop.fallbackUrl, "", 500),
      tableNumber: Number(table.pdfCrop.tableNumber || String(table?.name || "").match(/Table\s*(\d+)/i)?.[1] || index + 1)
    } : null,
    rows: Array.isArray(table?.rows)
      ? table.rows.slice(0, 20).map((row) => Array.isArray(row) ? row.slice(0, 24).map((cell) => safeText(cell, "", 160)) : [])
      : []
  }));
}

function clearUploadedPdfUrl() {
  if (currentUploadedPdfUrl) URL.revokeObjectURL(currentUploadedPdfUrl);
  currentUploadedPdfUrl = "";
}

function useUploadedPdf(file) {
  clearUploadedPdfUrl();
  currentUploadedPdfUrl = URL.createObjectURL(file);
}

function attachUploadedPdfCrops(tables) {
  if (!currentUploadedPdfUrl) return tables;
  return tables.map((table, index) => ({
    ...table,
    pdfCrop: {
      url: table.pdfCrop?.url || currentUploadedPdfUrl,
      fallbackUrl: table.pdfCrop?.url ? currentUploadedPdfUrl : "",
      tableNumber: Number(table.pdfCrop?.tableNumber || String(table?.name || "").match(/Table\s*(\d+)/i)?.[1] || index + 1)
    }
  }));
}

function mergeFigureArtwork(primaryFigures, fallbackFigures, options = {}) {
  return window.PosterAssetSelector?.mergeNumberedFigureArtwork?.(primaryFigures, fallbackFigures, options)
    || primaryFigures;
}

function dedupeFigures(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const name = typeof item === "string" ? item : item?.name;
    const source = typeof item === "string" ? "" : item?.source;
    const key = `${name || ""}|${source || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function dedupeStrings(items) {
  const seen = new Set();
  return items.filter((item) => {
    const value = String(item || "").replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function analyzeWithLLM(text, preparation) {
  activeAnalysisController?.abort();
  const controller = new AbortController();
  activeAnalysisController = controller;
  const timeoutMs = 600000;

  try {
    const request = async () => {
      setStatus(`Starting paper-reading Agent. Client ${clientVersion}.`, "loading");
      const response = await fetch("/api/analyze-agent", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sourceProfile: preparation.sourceProfile,
          toolTrace: preparation.toolTrace,
          memory: paperMemory.toAgentContext(currentMemory)
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "LLM analysis failed.");
      }
      if (!response.body) throw new Error("Agent event stream is unavailable in this browser.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result = null;

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "stage") {
            setAgentStage(event.stage, event.message, event);
            setStatus(`Agent: ${event.message}`, "loading");
          } else if (event.type === "error") {
            throw new Error(event.error || "Agent analysis failed.");
          } else if (event.type === "result") {
            result = event;
          }
        }
        if (done) break;
      }

      if (buffer.trim()) {
        const event = JSON.parse(buffer);
        if (event.type === "error") throw new Error(event.error || "Agent analysis failed.");
        if (event.type === "result") result = event;
      }
      if (!result?.analysis) throw new Error("Agent finished without an analysis result.");

      setStatus("Agent result received, normalizing poster data.", "loading");
      await nextFrame();
      const normalized = normalizeLLMAnalysis(result.analysis, text, preparation.assets, preparation.sourceProfile);
      normalized._agent = result.agent || null;
      const verdict = normalized._agent?.verification?.verdict;
      if (verdict && verdict !== "skipped") {
        normalized.checks.push({ name: "Agent verification", ok: verdict === "pass" });
        normalized.score = Math.round((normalized.checks.filter((item) => item.ok).length / normalized.checks.length) * 100);
      }
      await nextFrame();
      return normalized;
    };

    return await withTimeout(
      request(),
      timeoutMs,
      () => controller.abort()
    );
  } catch (error) {
    if (error.name === "AbortError" || error.code === "APP_TIMEOUT") {
      throw new Error("Paper-reading Agent timed out after 10 minutes. Try a shorter paper or disable verification temporarily.");
    }
    throw error;
  } finally {
    if (activeAnalysisController === controller) activeAnalysisController = null;
  }
}

async function prepareAgentInput(text) {
  await ensureExactArxivFormulaAssets();
  const analysisText = reliableArxivPaperText || text;
  const sourceType = currentSourceProfile.sourceType || "text";
  let formulas = reliableArxivFormulas;
  let figures = reliableArxivFigures;
  const formulaImages = reliablePdfFormulaImages.slice(0, 6);

  const selectedTools = browserTools.plan({ ...currentSourceProfile, sourceType }, { stage: "preprocessing" });
  for (const tool of selectedTools) {
    const output = await browserTools.execute(tool.name, { text: analysisText.slice(0, 16000) });
    if (tool.name === "text.formulas") formulas = formulas.length ? formulas : output;
    if (tool.name === "text.figures") figures = dedupeFigures([...figures, ...normalizeFigures(output, 8)]).slice(0, 12);
  }

  const preparedProfile = {
    ...currentSourceProfile,
    sourceType,
    textChars: analysisText.length,
    formulaCount: formulas.length + formulaImages.length,
    textFormulaCount: formulas.length,
    formulaImageCount: formulaImages.length,
    figureCount: figures.length,
    tableCount: reliableArxivTables.length,
    originalFigureCount: figures.filter((figure) => Array.isArray(figure?.assets) && figure.assets.length > 0).length,
    originalTableCount: reliableArxivTables.filter((table) => table?.image?.url || table?.pdfCrop?.url).length
  };
  const sourceIdentity = createSourceIdentity(preparedProfile, analysisText);
  const sourceProfile = bindProfileIdentity(preparedProfile, sourceIdentity);
  currentSourceProfile = { ...currentSourceProfile, ...sourceProfile };
  return {
    assets: { formulas, formulaImages, figures },
    sourceProfile,
    sourceIdentity,
    text: analysisText,
    toolTrace: [...serverPreprocessingTrace, ...browserTools.getTrace()]
  };
}

async function ensureExactArxivFormulaAssets() {
  let arxivId = currentSourceProfile.arxivId || currentSourceProfile.detectedArxivId;
  if (!arxivId && !exactFormulaLookupCompleted && currentSourceProfile.title && paperApi.resolveArxivByTitle) {
    setStatus("No arXiv ID was embedded in the PDF. Matching its complete title before formula extraction...", "loading");
    try {
      const match = await withTimeout(paperApi.resolveArxivByTitle(currentSourceProfile.title), 25000);
      if (match?.id) {
        arxivId = match.id;
        currentSourceProfile = {
          ...currentSourceProfile,
          detectedArxivId: match.id,
          paperUrl: `https://arxiv.org/abs/${match.id}`
        };
      }
    } catch (error) {
      console.warn("Strict arXiv title lookup failed; PDF formula crops remain available:", error);
    }
  }
  if (!arxivId || exactFormulaLookupCompleted || reliableArxivFormulas.length) return;
  setStatus(`Exact formulas are missing. Retrying arXiv:${arxivId} before poster planning...`, "loading");
  try {
    const payload = await withTimeout(paperApi.loadArxivSource(arxivId), 120000);
    if (paperSourceIdentity.enrichmentMatches
      && !paperSourceIdentity.enrichmentMatches(currentSourceProfile, payload, payload.paperText)) {
      throw new Error("The matched arXiv source belongs to a different paper; keeping the uploaded PDF evidence.");
    }
    reliableArxivFormulas = Array.isArray(payload.formulas) ? payload.formulas : [];
    reliableArxivPaperText = String(payload.paperText || "");
    if (!reliableArxivFigures.length) reliableArxivFigures = normalizeFigures(payload.figures, 12);
    if (!reliableArxivTables.length) reliableArxivTables = normalizeTables(payload.tables, 8);
    serverPreprocessingTrace = [
      ...serverPreprocessingTrace,
      ...(Array.isArray(payload.tools) ? payload.tools : [])
    ];
    commitSourceProfile({
      ...currentSourceProfile,
      sourceType: "arxiv",
      arxivId: payload.id || arxivId,
      detectedArxivId: payload.id || arxivId,
      title: payload.title || currentSourceProfile.title || "",
      titleLines: Array.isArray(payload.titleLines) ? payload.titleLines : (currentSourceProfile.titleLines || []),
      doi: payload.doi || currentSourceProfile.doi || "",
      paperUrl: payload.paperUrl || `https://arxiv.org/abs/${payload.id || arxivId}`
    }, reliableArxivPaperText || input.value);
    exactFormulaLookupCompleted = true;
  } catch (error) {
    console.warn("Exact arXiv formula retry failed; PDF formula crops remain available:", error);
  }
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      if (onTimeout) onTimeout();
      const error = new Error("Operation timed out.");
      error.code = "APP_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const agentStageOrder = ["planning", "context", "analysis", "verification", "reporting"];

function resetAgentFlow() {
  for (const item of agentFlow?.querySelectorAll("[data-agent-stage]") || []) {
    item.classList.remove("active", "completed", "failed");
  }
  if (agentTrace) agentTrace.textContent = "Agent is preparing the paper-reading workflow.";
  agentMonitor.clear();
  paperPet.reset();
}

function setAgentStage(stage, message, event = {}) {
  agentMonitor.handle(event);
  paperPet.setStage(stage, message);
  const currentIndex = agentStageOrder.indexOf(stage);
  for (const item of agentFlow?.querySelectorAll("[data-agent-stage]") || []) {
    const index = agentStageOrder.indexOf(item.dataset.agentStage);
    item.classList.toggle("completed", currentIndex !== -1 && index < currentIndex);
    item.classList.toggle("active", index === currentIndex);
    item.classList.remove("failed");
  }
  if (!agentTrace) return;
  const context = event.contextStats
    ? ` GSSC: ${event.contextStats.structuredTasks || 0} task packets, ${event.contextStats.selectedChunks}/${event.contextStats.gatheredChunks} chunks, ${event.contextStats.contextChars} verification chars.`
    : "";
  agentTrace.textContent = `${message || stage}.${context}`.replace("..", ".");
}

function completeAgentFlow(agent) {
  agentMonitor.complete(agent);
  paperPet.complete();
  for (const item of agentFlow?.querySelectorAll("[data-agent-stage]") || []) {
    item.classList.remove("active", "failed");
    item.classList.add("completed");
  }
  if (agentTrace && agent) {
    const seconds = Math.round(Number(agent.metrics?.durationMs || 0) / 1000);
    const verdict = agent.verification?.verdict || "complete";
    agentTrace.textContent = `Agent complete: ${agent.metrics?.modelCalls || 0} model calls, ${seconds}s, verification ${verdict}.`;
  }
}

function failAgentFlow(message) {
  agentMonitor.fail(message);
  paperPet.fail(message);
  const active = agentFlow?.querySelector("[data-agent-stage].active");
  if (active) active.classList.add("failed");
  if (agentTrace) agentTrace.textContent = message;
}

async function testApiConnection() {
  testApiBtn.disabled = true;
  testApiBtn.textContent = "Testing...";
  setStatus("Testing LLM API connection...", "loading");

  try {
    const response = await fetch("/api/test-llm", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "API test failed.");
    }

    setStatus(`API OK: ${payload.model} via ${payload.baseUrl}. Version: ${payload.version}. Reply: ${payload.reply}`, "success");
  } catch (error) {
    setStatus(`API test failed: ${error.message}`, "error");
  } finally {
    testApiBtn.disabled = false;
    testApiBtn.textContent = "Test API";
  }
}

async function handleArxivLoad() {
  const idOrUrl = arxivInput.value.trim();
  if (!idOrUrl) {
    setStatus("Enter an arXiv ID or URL first.", "error");
    arxivInput.focus();
    return;
  }

  const revision = beginNewPaperSource("arXiv paper");
  loadArxivBtn.disabled = true;
  loadArxivBtn.textContent = "Loading...";
  resetAgentFlow();
  if (agentTrace) agentTrace.textContent = "Loading a new paper source. Agent analysis has not started.";
  setStatus("Fetching arXiv LaTeX source...", "loading");

  try {
    const payload = await paperApi.loadArxivSource(idOrUrl);
    if (revision !== sourceRevision) return;

    reliableArxivFormulas = Array.isArray(payload.formulas) ? payload.formulas : [];
    reliableArxivPaperText = String(payload.paperText || "");
    exactFormulaLookupCompleted = true;
    reliableArxivFigures = normalizeFigures(payload.figures, 12);
    reliableArxivTables = normalizeTables(payload.tables, 8);
    serverPreprocessingTrace = Array.isArray(payload.tools) ? payload.tools : [];
    commitSourceProfile({
      sourceType: "arxiv", arxivId: payload.id, hasLatex: true, hasOriginalPdf: true,
      title: payload.title || "", titleLines: Array.isArray(payload.titleLines) ? payload.titleLines : [],
      doi: payload.doi || "", paperUrl: payload.paperUrl || `https://arxiv.org/abs/${payload.id}`
    }, payload.paperText);
    input.value = payload.paperText;
    loadCurrentPaperMemory();
    setStatus(
      `Loaded arXiv:${payload.id}. Extracted ${payload.formulaCount} formulas, ${payload.figureCount} figures (${reliableArxivFigures.filter((figure) => figure.assets.length).length} with original artwork), and prepared ${payload.tableCount} tables for original-PDF cropping. Click Generate Poster.`,
      "success"
    );
  } catch (error) {
    setStatus(`${error.message} You can still upload the PDF or paste paper text.`, "error");
  } finally {
    loadArxivBtn.disabled = false;
    loadArxivBtn.textContent = "Load arXiv Source";
  }
}


async function generatePosterOnce() {
  const text = input.value.trim();
  if (!text) {
    setStatus("Upload a PDF or paste paper text before generating the poster.", "error");
    input.focus();
    return false;
  }

  analyzeBtn.disabled = true;
  const revision = sourceRevision;
  analyzeBtn.textContent = "Analyzing...";
  resetVisualReview();
  resetAgentFlow();
  agentMonitor.reset();
  setStatus(`Starting paper-reading Agent. Client ${clientVersion}.`, "loading");
  let preparation = null;
  let analysisText = text;

  try {
    preparation = await prepareAgentInput(text);
    analysisText = preparation.text || text;
    if (revision !== sourceRevision) return;
    currentMemory = paperMemory.open({ text: analysisText, sourceProfile: preparation.sourceProfile });
    renderNotebook();
    setStatus(`Agent selected tools for ${preparation.sourceProfile.sourceType} input.`, "loading");
    const analysis = await analyzeWithLLM(analysisText, preparation);
    if (revision !== sourceRevision) return;
    setAgentStage("reporting", "Rendering verified formulas, figures, tables, and poster layout");
    setStatus("Agent: rendering verified poster assets.", "loading");
    await nextFrame();
    await renderAnalysis(analysis, { sourceIdentity: preparation.sourceIdentity, revision });
    if (revision !== sourceRevision) return;
    const visionProduction = await runProductionVisionChecks(revision);
    if (revision !== sourceRevision) return;
    currentMemory = paperMemory.capture(currentMemory, {
      text: analysisText,
      sourceProfile: preparation.sourceProfile,
      analysis
    });
    renderNotebook();
    completeAgentFlow(analysis._agent);
    const visionSummary = visionProduction.status === "completed"
      ? ` Staged visual production checks completed; ${visionProduction.revisedSections} content section(s) refined.`
      : visionProduction.status === "skipped"
        ? " Visual production checks were skipped because no vision model is configured."
        : " Poster generated; visual production checks were only partially completed."
    setStatus(`Agent analysis complete. Completeness score: ${analysis.score}.${visionSummary}`, "success");
    if (window.DesktopPetShell) await window.DesktopPetShell.showWorkspace();
    return true;
  } catch (error) {
    if (revision !== sourceRevision) return;
    const fallbackDraft = localAnalyzePaper(analysisText);
    const fallbackFormulas = dedupeStrings([
      ...(Array.isArray(preparation?.assets?.formulas) ? preparation.assets.formulas : []),
      ...(Array.isArray(fallbackDraft.formulas) ? fallbackDraft.formulas : [])
    ]);
    fallbackDraft.formulas = fallbackFormulas;
    fallbackDraft.sourceFormulas = [...fallbackFormulas];
    fallbackDraft.formulaImages = Array.isArray(preparation?.assets?.formulaImages)
      ? preparation.assets.formulaImages
      : [];
    fallbackDraft.figures = dedupeFigures([
      ...(Array.isArray(preparation?.assets?.figures) ? preparation.assets.figures : []),
      ...(Array.isArray(fallbackDraft.figures) ? fallbackDraft.figures : [])
    ]);
    const fallback = bindAnalysisToSource(fallbackDraft, preparation?.sourceProfile || currentSourceProfile, analysisText, true);
    failAgentFlow(`Agent stopped: ${error.message}`);
    setStatus("Agent failed; rendering deterministic local fallback.", "loading");
    await renderAnalysis(fallback, { sourceIdentity: fallback._sourceIdentity, revision });
    currentMemory = paperMemory.capture(currentMemory || paperMemory.open({ text: analysisText, sourceProfile: preparation?.sourceProfile || currentSourceProfile }), {
      text: analysisText,
      sourceProfile: preparation?.sourceProfile || currentSourceProfile,
      analysis: fallback
    });
    renderNotebook();
    setStatus(`${error.message} Local fallback poster generated.`, "error");
    return true;
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Generate Poster";
  }
}

async function generatePoster() {
  if (posterGenerationPromise && posterGenerationRevision === sourceRevision) return posterGenerationPromise;
  const generationRevision = sourceRevision;
  const generation = generatePosterOnce();
  posterGenerationPromise = generation;
  posterGenerationRevision = generationRevision;
  try {
    return await generation;
  } finally {
    if (posterGenerationPromise === generation) {
      posterGenerationPromise = null;
      posterGenerationRevision = -1;
    }
  }
}

async function runAutomaticPaperPipeline(file) {
  if (automaticPaperPipelineRunning) {
    setStatus("I am already reading a paper. Please wait for this poster to finish.", "loading");
    return false;
  }

  automaticPaperPipelineRunning = true;
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Reading PDF...";
  try {
    const loaded = await processPdfFile(file, { continueToAnalysis: true });
    if (!loaded) return false;
    setStatus("PDF evidence is ready. Automatically starting Agent analysis...", "loading");
    await nextFrame();
    analyzeBtn.disabled = false;
    await generatePoster();
    return true;
  } finally {
    automaticPaperPipelineRunning = false;
    if (analyzeBtn.textContent === "Reading PDF...") {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = "Generate Poster";
    }
  }
}

function loadCurrentPaperMemory() {
  const text = input.value.trim();
  currentMemory = text ? paperMemory.open({ text, sourceProfile: currentSourceProfile }) : null;
  renderNotebook();
}

function renderNotebook() {
  if (!currentMemory) {
    memoryStatus.textContent = "No paper memory loaded.";
    memoryOutlineContent.textContent = "Generate a poster to create section summaries and evidence links.";
    annotationList.textContent = "No annotations yet.";
    questionList.textContent = "No unresolved questions yet.";
    return;
  }

  const title = currentMemory.metadata.title || currentMemory.metadata.fileName || currentMemory.metadata.arxivId || "Current paper";
  const openQuestions = currentMemory.questions.filter((item) => item.status === "open").length;
  memoryStatus.textContent = `${title}: ${currentMemory.annotations.length} annotations, ${openQuestions} open questions, ${currentMemory.evidence.length} evidence links.`;

  const sections = Object.entries(currentMemory.sections).filter(([, value]) => value.summary);
  memoryOutlineContent.innerHTML = sections.length
    ? sections.map(([name, value]) => `<div class="memory-section"><strong>${escapeHtml(name)}</strong><p>${escapeHtml(value.summary)}</p>${value.evidenceLocations.length ? `<small>Evidence: ${value.evidenceLocations.map(escapeHtml).join(", ")}</small>` : ""}</div>`).join("")
    : "Generate a poster to create section summaries and evidence links.";

  annotationList.innerHTML = currentMemory.annotations.length
    ? currentMemory.annotations.map((item) => `<div class="notebook-item"><span>${escapeHtml(item.text)}</span><button type="button" data-memory-action="delete-note" data-memory-id="${escapeHtml(item.id)}">Delete</button></div>`).join("")
    : "No annotations yet.";

  questionList.innerHTML = currentMemory.questions.length
    ? currentMemory.questions.map((item) => `<div class="notebook-item ${item.status === "resolved" ? "resolved" : ""}"><span>${escapeHtml(item.text)}${item.source === "agent" ? " <small>Agent</small>" : ""}</span><div class="notebook-item-actions"><button type="button" data-memory-action="toggle-question" data-memory-id="${escapeHtml(item.id)}">${item.status === "resolved" ? "Reopen" : "Resolve"}</button><button type="button" data-memory-action="delete-question" data-memory-id="${escapeHtml(item.id)}">Delete</button></div></div>`).join("")
    : "No unresolved questions yet.";
}

function ensureMemoryForNotes() {
  const text = input.value.trim();
  if (!text) {
    setStatus("Load a paper before adding reading notes.", "error");
    return false;
  }
  if (!currentMemory) currentMemory = paperMemory.open({ text, sourceProfile: currentSourceProfile });
  return true;
}

async function renderAnalysis(analysis, context = {}) {
  if (Number.isInteger(context.revision) && context.revision !== sourceRevision) return false;
  const identity = context.sourceIdentity || analysis._sourceIdentity || createSourceIdentity({
    ...currentSourceProfile,
    title: currentSourceProfile.title || analysis.title,
    doi: currentSourceProfile.doi || analysis.doi,
    paperUrl: currentSourceProfile.paperUrl || analysis.paperUrl
  }, input.value);
  if (analysis._sourceIdentity?.strict && !paperSourceIdentity.matches(analysis._sourceIdentity, identity)) {
    throw new Error("A stale analysis tried to render over a different paper. The poster was not updated.");
  }
  analysis._sourceIdentity = { ...identity, strict: Boolean(analysis._sourceIdentity?.strict || context.sourceIdentity) };
  analysis.title = identity.title || analysis.title;
  analysis.titleLines = identity.titleLines;
  analysis.doi = identity.doi;
  analysis.paperUrl = identity.paperUrl;
  currentAnalysis = analysis;
  applyPosterAssetSelection(analysis);
  applyPosterComposition(analysis);
  renderPosterTitle(analysis.title, analysis.titleLines);
  targets.summary.textContent = analysis.summary;
  if (posterPaperLink) {
    posterPaperLink.hidden = !analysis.paperUrl;
    posterPaperLink.href = analysis.paperUrl || "";
    posterPaperLink.textContent = analysis.doi ? `DOI: ${analysis.doi}` : analysis.paperUrl;
  }
  targets.problem.innerHTML = renderInlineMathText(analysis.problem);
  targets.motivation.innerHTML = renderInlineMathText(analysis.motivation);
  const narrative = window.PosterNarrative;
  targets.method.innerHTML = makeList([narrative?.composeMethod(analysis) || analysis.method]);
  targets.result.innerHTML = renderInlineMathText(narrative?.composeResults(analysis)
    || [analysis.results, analysis.experimentsValidateClaims, analysis.experiments].filter(Boolean).join(" "));
  targets.contribution.innerHTML = renderInlineMathText(narrative?.composeContributions(analysis)
    || [analysis.contributions, analysis.innovation, analysis.logicReview].filter(Boolean).join(" "));

  const theoryInlineFormulas = window.PaperInlineMath?.extractInlineMath
    ? window.PaperInlineMath.extractInlineMath(analysis.theory)
    : [];
  const formulaImages = Array.isArray(analysis.formulaImages) ? analysis.formulaImages.slice(0, 2) : [];
  const posterFormulas = analysis.formulas.length
    ? analysis.formulas
    : formulaImages.length
      ? []
      : theoryInlineFormulas.slice(0, 1);
  const formulaSelectionSummary = analysis.formulas.length
    ? renderSelectionSummary("formula", analysis.assetSelection?.formulas)
    : "";
  const theoryLead = analysis.theory ? `<p class="poster-section-lead">${renderInlineMathText(analysis.theory)}</p>` : "";
  const renderedFormulaInsights = new Set();
  const formulaEvidence = posterFormulas.length
    ? formulaSelectionSummary + posterFormulas
        .map((formula, index) => `
          <div class="formula${isWideFormula(formula) ? " formula-wide" : ""}">
            <span>${analysis.formulas.length ? "Selected formula" : "Key formula from the analysis"} ${index + 1}</span>
            <div class="formula-render">${renderStandaloneFormula(formula, !analysis.formulas.length)}</div>
            ${renderFormulaInterpretation(analysis.assetAnnotations?.formulas?.[index], analysis.theory, renderedFormulaInsights)}
            <details class="formula-source">
              <summary>LaTeX source</summary>
              <code>${escapeHtml(formula)}</code>
            </details>
          </div>
        `)
        .join("")
    : formulaImages.length
      ? formulaImages.map((formula, index) => `
          <div class="formula formula-image-card">
            <span>Formula ${index + 1} from the original PDF</span>
            <div class="formula-image"><img src="${normalizeAssetUrl(formula.image?.url)}" alt="${escapeHtml(formula.name || `Formula ${index + 1}`)}" /></div>
            <small>${escapeHtml(formula.source || "Uploaded PDF")}</small>
          </div>
        `).join("")
      : "";
  targets.formula.innerHTML = theoryLead + formulaEvidence
    || "No reliable formula detected. For accuracy, the Agent will not reconstruct LaTeX from a broken PDF text layer.";
  configureFormulaImageCards();

  renderPlacedVisualAssets(analysis);

  await Promise.all([renderFormulaMath(), renderFigureAssets()]);
  await browserTools.execute("poster.interactions", {
    root: poster,
    analysis,
    sourceText: reliableArxivPaperText || input.value
  });
  stripPosterEvidenceCues(poster);
  await syncWorkspacePosterPreview();
  return true;
}

function renderPosterTitle(value, sourceLines = []) {
  const title = window.PosterExportTools?.cleanPosterTitle
    ? window.PosterExportTools.cleanPosterTitle(value || "Untitled Paper Poster")
    : String(value || "Untitled Paper Poster").replace(/\s+/g, " ").trim();
  const preservedLines = normalizeSourceTitleLines(sourceLines, title);
  const lines = preservedLines.length
    ? preservedLines
    : window.PosterExportTools?.splitPosterTitle
      ? window.PosterExportTools.splitPosterTitle(title)
      : [title];
  targets.title.replaceChildren();
  lines.forEach((line, index) => {
    const span = document.createElement("span");
    span.className = "poster-title-line";
    span.textContent = line;
    targets.title.append(span);
    if (index < lines.length - 1) targets.title.append(document.createElement("br"));
  });
  targets.title.classList.toggle("poster-title-two-line", lines.length === 2);
  targets.title.classList.toggle("poster-title-multi-line", lines.length > 1);
  targets.title.classList.toggle("poster-title-extra-long", title.length > 90 || Math.max(...lines.map((line) => line.length)) > 60);
  targets.title.setAttribute("aria-label", title);
}

function normalizeSourceTitleLines(lines, title) {
  const cleaned = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const key = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return cleaned.length > 1 && key(cleaned.join(" ")) === key(title) ? cleaned : [];
}

function renderPlacedVisualAssets(analysis) {
  poster.querySelectorAll(".poster-inline-assets").forEach((node) => node.remove());
  poster.querySelectorAll(".key-idea-map").forEach((node) => node.remove());
  poster.querySelectorAll(".method-flow-map").forEach((node) => node.remove());
  const visualCard = targets.figures.closest('[data-poster-section="visuals"]');
  if (poster.dataset.paperType === "guideline") {
    const figures = analysis.figures || [];
    const tables = analysis.tables || [];
    targets.figures.innerHTML = renderFiguresAndTables(figures, tables);
    if (visualCard) visualCard.hidden = !(figures.length || tables.length);
    return;
  }
  const placement = posterAssetPlacement.partitionPosterAssets({
    figures: analysis.figures || [],
    tables: analysis.tables || []
  });

  const methodCard = targets.method.closest('[data-poster-section="method"]');
  if (placement.methodFigures.length && methodCard) {
    methodCard.append(createInlineAssetGroup("method", placement.methodFigures, []));
  } else if (methodCard) {
    const flow = window.PaperKeyIdeaVisual?.buildMethodFlow({ method: analysis.method });
    if (flow) methodCard.append(createMethodFlow(flow));
  }

  const theoryCard = targets.formula.closest('[data-poster-section="theory"]');
  if (theoryCard) delete theoryCard.dataset.generatedKeyIdea;
  const shouldBuildGeneratedTheoryMap = window.PaperKeyIdeaVisual?.shouldBuildKeyIdeaMap({
    formulas: analysis.formulas || [],
    formulaImages: analysis.formulaImages || [],
    theoryFigures: placement.theoryFigures
  }) ?? false;
  if (placement.theoryFigures.length && theoryCard) {
    theoryCard.append(createInlineAssetGroup("theory", placement.theoryFigures, []));
  } else if (theoryCard && shouldBuildGeneratedTheoryMap) {
    const flow = window.PaperKeyIdeaVisual?.buildMechanismFlow({
      theory: analysis.theory,
      method: analysis.method
    });
    if (flow) {
      theoryCard.dataset.generatedKeyIdea = "true";
      theoryCard.append(createMethodFlow(flow));
    }
  }

  const resultsCard = targets.result.closest('[data-poster-section="results"]');
  if ((placement.resultFigures.length || placement.resultTables.length) && resultsCard) {
    resultsCard.append(createInlineAssetGroup("results", placement.resultFigures, placement.resultTables));
  }

  targets.figures.replaceChildren();
  if (visualCard) visualCard.hidden = true;
}

function createMethodFlow(flow) {
  const wrapper = document.createElement("div");
  wrapper.className = "method-flow-map";
  wrapper.setAttribute("aria-label", "Method workflow");
  flow.steps.forEach((text, index) => {
    const step = document.createElement("div");
    step.className = "method-flow-step";
    const number = document.createElement("span");
    number.className = "method-flow-index";
    number.textContent = String(index + 1);
    const label = document.createElement("span");
    label.className = "method-flow-label";
    label.textContent = text;
    step.append(number, label);
    wrapper.append(step);
  });
  return wrapper;
}

function createKeyIdeaMap(map) {
  const wrapper = document.createElement("div");
  wrapper.className = "key-idea-map";
  const center = document.createElement("div");
  center.className = "key-idea-center";
  center.textContent = map.center;
  const branches = document.createElement("div");
  branches.className = "key-idea-branches";
  for (const text of map.branches) {
    const branch = document.createElement("div");
    branch.className = "key-idea-branch";
    branch.textContent = text;
    branches.append(branch);
  }
  wrapper.append(center, branches);
  return wrapper;
}

function createInlineAssetGroup(placement, figures, tables) {
  const wrapper = document.createElement("div");
  wrapper.className = `poster-inline-assets ${placement}-assets${tables.length ? " poster-export-table" : ""}`;
  wrapper.dataset.assetPlacement = placement;
  wrapper.innerHTML = renderFiguresAndTables(figures, tables);
  return wrapper;
}

function applyPosterAssetSelection(analysis) {
  if (analysis._assetSelectionApplied || !window.PosterAssetSelector) return;
  const visualPlan = analysis._agent?.skills?.visualPlan || {};
  const requestedPaperType = visualPlan.paperType || analysis._agent?.skills?.classification?.paperType || "method";
  const paperType = resolvePosterPaperType(requestedPaperType, analysis);
  let selected = window.PosterAssetSelector.selectPosterAssets(analysis, {
    paperType,
    policy: visualPlan.selectionPolicy
  });
  selected = window.PosterAssetSelector.recoverCoreMechanismFormula?.(analysis, selected, {
    paperType
  }) || selected;
  analysis.formulas = selected.formulas;
  analysis.formulaImages = selected.formulaImages;
  analysis.figures = selected.figures;
  analysis.tables = selected.tables;
  analysis.assetAnnotations = selected.annotations;
  analysis.assetSelection = selected.stats;
  analysis.formulaDecision = selected.stats.formulaDecision;
  poster.dataset.formulaSourceCount = String(
    Number(analysis.sourceFormulas?.length || 0) + Number(analysis.formulaImages?.length || 0)
  );
  poster.dataset.formulaSelectedCount = String(selected.formulas.length + selected.formulaImages.length);
  poster.dataset.clientVersion = clientVersion;
  const formulaRequirementMet = !analysis.formulaDecision?.required
    || Boolean(analysis.formulas.length || analysis.formulaImages.length);
  analysis.checks = (analysis.checks || []).filter((check) => check.name !== "Mechanism formula selection");
  analysis.checks.push({ name: "Mechanism formula selection", ok: formulaRequirementMet });
  analysis.score = Math.round((analysis.checks.filter((check) => check.ok).length / Math.max(1, analysis.checks.length)) * 100);
  analysis._assetSelectionApplied = true;
}

function applyPosterComposition(analysis) {
  const composition = analysis._agent?.skills?.posterComposition || {};
  const plannedPaperType = composition.paperType || analysis._agent?.skills?.classification?.paperType || "method";
  const paperType = resolvePosterPaperType(plannedPaperType, analysis);
  poster.classList.add("poster-focused");
  poster.dataset.paperType = paperType;
  poster.dataset.density = composition.density || "balanced";
  const priorities = new Map((composition.sections || []).map((section) => [section.id, section]));
  const sectionAliases = {
    motivation: "problem",
    visuals: "results"
  };
  for (const card of poster.querySelectorAll("[data-poster-section]")) {
    const id = card.dataset.posterSection;
    const planned = priorities.get(id) || priorities.get(sectionAliases[id]);
    card.dataset.priority = planned?.priority || "standard";
    card.style.order = String(planned?.order || 99);
  }
  const headings = posterHeadings(paperType, analysis);
  for (const [section, title] of Object.entries(headings)) {
    const heading = poster.querySelector(`[data-poster-section="${section}"] h3`);
    if (heading) heading.textContent = title;
  }
}

function resolvePosterPaperType(plannedPaperType, analysis = {}) {
  const methodText = `${analysis.title || ""} ${analysis.summary || ""} ${analysis.method || ""}`;
  const methodSignals = methodText.match(/\b(?:method|model|architecture|framework|pipeline|generator|discriminator|encoder|decoder|module|training|inference|algorithm|network)\b/gi) || [];
  const formalTheorySignals = methodText.match(/\b(?:theorem|lemma|proof|proposition|corollary|formal guarantee)\b/gi) || [];
  if (plannedPaperType === "theory") {
    return methodSignals.length >= 2 && formalTheorySignals.length === 0 ? "method" : plannedPaperType;
  }
  if (plannedPaperType === "empirical") {
    const frameworkSignal = /\b(?:is|introduces?|proposes?|presents?|develops?|designs?)\b.{0,120}\b(?:multi-agent |agentic |unified )?(?:prompting )?(?:framework|pipeline|architecture|method|model|system|algorithm)\b/i.test(methodText)
      || /\b(?:framework|pipeline|architecture)\b.{0,120}\b(?:consists? of|comprises?|stages?|agents?|modules?|workflow)\b/i.test(methodText);
    const studySignal = /\b(?:empirical study|research questions?|manual(?:ly)? annotat|annotation protocol|taxonomy study|controlled study)\b/i.test(methodText);
    if (frameworkSignal && !studySignal) return "method";
  }
  if (plannedPaperType === "survey") {
    const explicitSurvey = /\b(?:survey|systematic review|meta-analysis)\b|\b(?:we|this (?:paper|work)) (?:review|survey)\b/i.test(methodText);
    const proposedMethod = /\b(?:introduces?|proposes?|presents?|develops?|designs?)\b.{0,160}\b(?:multi-agent |agentic |unified )?(?:framework|pipeline|architecture|method|model|system|algorithm|solution)\b/i.test(methodText)
      || /\b(?:framework|pipeline|architecture)\b.{0,140}\b(?:consists? of|comprises?|agents?|modules?|workflow|iteration)\b/i.test(methodText);
    if (proposedMethod && !explicitSurvey) return "method";
  }
  return plannedPaperType;
}

function posterHeadings(paperType, analysis = {}) {
  const hasCoreFormula = Boolean(analysis.formulas?.length || analysis.formulaImages?.length);
  const common = {
    problem: "Research Problem",
    motivation: "Motivation",
    method: "Method Overview",
    theory: hasCoreFormula ? "Key Idea / Formula" : "Key Mechanism",
    visuals: "Selected Visual Evidence",
    results: "Main Experimental Results",
    contribution: "Contributions"
  };
  if (paperType === "theory") {
    const methodText = String(analysis.method || "");
    const explainsMethod = /\b(?:method|model|architecture|framework|pipeline|generator|discriminator|encoder|decoder|module|training|inference|algorithm)\b/i.test(methodText);
    return { ...common, method: explainsMethod ? "Method Overview" : "Definitions and Assumptions", theory: "Central Theory", visuals: "Proof Map / Examples", results: "Implications and Validation" };
  }
  if (paperType === "empirical") {
    const studyText = `${analysis.method || ""} ${analysis.theory || ""} ${analysis.results || ""}`;
    const taxonomyStudy = /\b(?:taxonomy|categor(?:y|ies|ization)|annotation|root causes?)\b/i.test(studyText);
    const mitigationStudy = /\b(?:mitigation|intervention|before[- ]and[- ]after|retrieval augmented)\b/i.test(studyText);
    return {
      ...common,
      method: taxonomyStudy ? "Study Design & Taxonomy" : "Study Design",
      theory: taxonomyStudy ? "Mechanism & Root Causes" : "Variables and Measures",
      visuals: "Key Findings",
      results: mitigationStudy ? "Mitigation Results" : "Results and Validity"
    };
  }
  if (paperType === "survey") return { ...common, method: "Scope and Taxonomy", theory: "Comparison Framework", visuals: "Taxonomy and Comparisons", results: "Gaps and Trends" };
  if (paperType === "system") return { ...common, method: "System Architecture", theory: "Design Principle", visuals: "Architecture and Scaling", results: "Performance Results" };
  if (paperType === "dataset") return { ...common, method: "Collection and Annotation", theory: "Task and Evaluation Protocol", visuals: "Dataset and Benchmark Evidence", results: "Benchmark Results" };
  if (paperType === "guideline") return { ...common, problem: "Purpose & Scope", method: "Submission Requirements", theory: "Formatting Rules", visuals: "Reference Examples", results: "Compliance Checklist", contribution: "Key Takeaways" };
  return common;
}

function configureFormulaImageCards() {
  for (const image of targets.formula.querySelectorAll(".formula-image img")) {
    const update = () => {
      const ratio = Number(image.naturalWidth || 0) / Math.max(1, Number(image.naturalHeight || 0));
      image.closest(".formula-image-card")?.classList.toggle("formula-wide", ratio >= 5.2);
    };
    if (image.complete) update();
    else image.addEventListener("load", update, { once: true });
  }
}

function isWideFormula(value) {
  const formula = String(value || "").replace(/\s+/g, " ").trim();
  return formula.length >= 82 || /\\begin\{(?:align|gather|multline|eqnarray)\*?\}/.test(formula) || /\\\\/.test(formula);
}

function renderSelectionSummary(label, stats) {
  if (!stats || stats.available <= stats.selected) return "";
  return `<div class="asset-selection-summary">Selected ${Number(stats.selected)} key ${escapeHtml(label)}${Number(stats.selected) === 1 ? "" : "s"} from ${Number(stats.available)} extracted candidates.</div>`;
}

function renderVisualSelectionSummary(stats) {
  if (!stats) return "";
  const parts = [
    stats.figures?.available ? `${stats.figures.selected}/${stats.figures.available} figures` : "",
    stats.tables?.available ? `${stats.tables.selected}/${stats.tables.available} tables` : ""
  ].filter(Boolean);
  return parts.length ? `<div class="asset-selection-summary">Poster selection: ${parts.map(escapeHtml).join("; ")}.</div>` : "";
}

function renderAssetInterpretation(annotation) {
  if (!annotation?.insight) return "";
  return `<div class="asset-interpretation">
    <strong>${escapeHtml(annotation.purpose || "Why it matters")}</strong>
    <p>${escapeHtml(annotation.insight)}</p>
  </div>`;
}

function renderFormulaInterpretation(annotation, theory, seen) {
  if (!annotation?.insight) return "";
  const normalize = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const insight = normalize(annotation.insight);
  const lead = normalize(theory);
  const comparisonLength = Math.min(120, lead.length, insight.length);
  const repeatsLead = comparisonLength >= 60
    && insight.slice(0, comparisonLength) === lead.slice(0, comparisonLength);
  const key = insight.slice(0, 180);
  if (repeatsLead || seen?.has(key)) return "";
  seen?.add(key);
  return renderAssetInterpretation({
    ...annotation,
    insight: safePosterText(annotation.insight, "", 220)
  });
}

function renderAgentAudit(agent) {
  if (!agent) return "";
  const verification = agent.verification || {};
  const metrics = agent.metrics || {};
  const evidence = agent.evidence && typeof agent.evidence === "object" ? agent.evidence : {};
  const toolPlan = Array.isArray(agent.toolPlan?.selected) ? agent.toolPlan.selected : [];
  const toolTrace = Array.isArray(agent.tools) ? agent.tools : [];
  const readingPlan = Array.isArray(agent.plan) ? agent.plan : [];
  const skillPlan = Array.isArray(agent.skills?.plan?.selected) ? agent.skills.plan.selected : [];
  const skillTrace = Array.isArray(agent.skills?.trace) ? agent.skills.trace : [];
  const paperType = String(agent.skills?.classification?.paperType || "unclassified");
  const preflight = verification.preflight && typeof verification.preflight === "object" ? verification.preflight : null;
  const verdictLabels = {
    pass: "Passed",
    revise: "Revised",
    unavailable: "Unavailable",
    skipped: "Skipped"
  };
  const evidenceRows = Object.entries(evidence)
    .flatMap(([group, items]) => (Array.isArray(items) ? items : []).map((item) => `
      <li><strong>${escapeHtml(group)}</strong> ${escapeHtml(item.quote || "")}<small>${escapeHtml(item.location || "paper context")}</small></li>
    `))
    .join("");
  const seconds = Math.max(0, Math.round(Number(metrics.durationMs || 0) / 1000));
  const coverage = Number.isFinite(Number(metrics.evidenceCoverage)) ? `${metrics.evidenceCoverage}%` : "n/a";
  const tokenLabel = metrics.tokenEstimate ? `${Number(metrics.totalTokens || 0)} est.` : `${Number(metrics.totalTokens || 0)}`;
  const costLabel = metrics.estimatedCostUsd == null ? "n/a" : `$${Number(metrics.estimatedCostUsd).toFixed(4)}`;
  const toolRows = toolTrace.map((tool) => `
    <li class="tool-call ${escapeHtml(tool.status || "completed")}">
      <span><strong>${escapeHtml(tool.name || "tool")}</strong><small>${escapeHtml(tool.summary || "Completed.")}</small></span>
      <b>${escapeHtml(tool.status || "completed")} | ${Math.max(0, Number(tool.durationMs || 0))}ms${tool.metrics?.totalTokens ? ` | ${Number(tool.metrics.totalTokens)} tok` : ""}</b>
    </li>
  `).join("");
  const planRows = toolPlan.map((tool) => `
    <li><strong>${escapeHtml(tool.name || "tool")}</strong><span>${escapeHtml(tool.reason || tool.description || "Selected by input profile.")}</span></li>
  `).join("");
  const skillRows = skillPlan.map((skill) => {
    const record = skillTrace.find((item) => item.name === skill.name) || {};
    return `<li class="tool-call ${escapeHtml(record.status || "completed")}">
      <span><strong>${escapeHtml(skill.name || "skill")}</strong><small>${escapeHtml(record.summary || skill.reason || "Selected by the Skill Planner.")}</small></span>
      <b>${escapeHtml(record.status || "selected")} | ${Math.max(0, Number(record.durationMs || 0))}ms</b>
    </li>`;
  }).join("");
  const taskRows = readingPlan.map((task) => `
    <li class="reading-task ${escapeHtml(task.status || "pending")}">
      <strong>${escapeHtml(task.label || task.id || "Reading task")}</strong>
      <span>${escapeHtml(task.status || "pending")} | ${Math.max(0, Number(task.durationMs || 0))}ms | ${Math.max(0, Number(task.evidenceCount || 0))} evidence | ${Math.max(0, Number(task.attempts || 0))} reasoning round(s)</span>
      ${(Array.isArray(task.reactSteps) ? task.reactSteps : []).map((step) => `
        <span class="react-step">Round ${Number(step.round || 0)}: ${escapeHtml(step.action || "tool")} -> ${escapeHtml(step.observation || "no observation")} -> ${escapeHtml(step.conclusion || "no conclusion")}</span>
      `).join("")}
      ${task.error ? `<span>${escapeHtml(task.error)}</span>` : ""}
    </li>
  `).join("");
  const reflectionRows = [
    ...(Array.isArray(preflight?.checks) ? preflight.checks.map((check) => ({ ...check, source: "deterministic" })) : []),
    ...(Array.isArray(verification.checks) ? verification.checks.map((check) => ({ ...check, source: "model" })) : [])
  ].map((check) => `
    <li class="tool-call ${check.ok ? "completed" : "failed"}">
      <span><strong>${escapeHtml(check.name || check.id || "Reflection check")}</strong><small>${escapeHtml(check.detail || "No detail returned.")}</small></span>
      <b>${escapeHtml(check.source)} | ${check.ok ? "pass" : escapeHtml(check.severity || "review")}</b>
    </li>
  `).join("");
  const appliedCorrectionCount = Object.keys(verification.appliedCorrections || {}).length;
  const rejectedCorrectionRows = Object.entries(verification.rejectedCorrections || {}).map(([field, reason]) => `
    <li class="tool-call failed"><span><strong>${escapeHtml(field)}</strong><small>${escapeHtml(reason)}</small></span><b>rejected</b></li>
  `).join("");

  return `<details class="agent-audit" aria-label="Agent audit trail">
    <summary class="agent-audit-head">
      <strong>Agent audit</strong>
      <span class="verification-badge ${escapeHtml(verification.verdict || "skipped")}">${escapeHtml(verdictLabels[verification.verdict] || "Complete")}</span>
    </summary>
    <div class="agent-audit-body">
    <div class="agent-metrics">
      <span>Evidence coverage <b>${escapeHtml(coverage)}</b></span>
      <span>Paper type <b>${escapeHtml(paperType)}</b></span>
      <span>Skills applied <b>${skillTrace.filter((item) => item.status === "completed").length}/${skillPlan.length}</b></span>
      <span>Evidence excerpts <b>${Number(metrics.evidenceItems || 0)}</b></span>
      <span>Model calls <b>${Number(metrics.modelCalls || 0)}</b></span>
      <span>Tokens <b>${escapeHtml(tokenLabel)}</b></span>
      <span>Retries <b>${Number(metrics.retries || 0)}</b></span>
      <span>Memory recalled <b>${Number(agent.memory?.recalledItems || 0)}</b></span>
      <span>Tasks grounded <b>${Number(metrics.completedReadingTasks || 0)}/${Number(metrics.readingTasks || readingPlan.length)}</b></span>
      <span>Audit score <b>${preflight ? `${Number(preflight.score || 0)}%` : "n/a"}</b></span>
      <span>Corrections applied <b>${appliedCorrectionCount}</b></span>
      <span>Tools selected <b>${toolPlan.length || toolTrace.length}</b></span>
      <span>Elapsed <b>${seconds}s</b></span>
      <span>Estimated cost <b>${escapeHtml(costLabel)}</b></span>
    </div>
    ${verification.summary ? `<p>${escapeHtml(verification.summary)}</p>` : ""}
    ${skillRows ? `<details class="agent-tools"><summary>View selected Skills (${skillPlan.length})</summary><ul>${skillRows}</ul></details>` : ""}
    ${taskRows ? `<details class="agent-plan"><summary>View reading task execution (${readingPlan.length})</summary><ol>${taskRows}</ol></details>` : ""}
    ${reflectionRows ? `<details class="agent-tools"><summary>View Reflection checks</summary><ul>${reflectionRows}</ul></details>` : ""}
    ${rejectedCorrectionRows ? `<details class="agent-tools"><summary>View rejected corrections</summary><ul>${rejectedCorrectionRows}</ul></details>` : ""}
    ${planRows ? `<details class="agent-plan"><summary>View selected tool plan (${toolPlan.length})</summary><ol>${planRows}</ol></details>` : ""}
    ${toolRows ? `<details class="agent-tools"><summary>View tool calls (${toolTrace.length})</summary><ul>${toolRows}</ul></details>` : ""}
    ${evidenceRows ? `<details class="agent-evidence"><summary>View supporting excerpts</summary><ul>${evidenceRows}</ul></details>` : ""}
    </div>
  </details>`;
}

function renderFiguresAndTables(figures, tables) {
  const renderableFigures = figures.filter((figure) => Array.isArray(figure?.assets) && figure.assets.some((asset) => asset?.url));
  const renderableTables = tables.filter((table) => table?.image?.url || table?.pdfCrop?.url);
  const figureHtml = renderableFigures.slice(0, 6).map((figure, index) => {
    const normalized = typeof figure === "string"
      ? { name: figure, source: "Original paper figure placeholder", caption: "", assets: [] }
      : figure;
    const assets = Array.isArray(normalized.assets) ? normalized.assets : [];
    const media = assets.length
      ? `<div class="figure-media ${assets.length > 1 ? "multi" : ""}">${assets.map((asset) => `
          <img data-asset-url="${escapeHtml(asset.url)}" data-asset-type="${escapeHtml(asset.type)}" alt="${escapeHtml(normalized.name || `Figure ${index + 1}`)}" />
        `).join("")}</div>`
      : `<div class="figure-unavailable">Original artwork was not available in a browser-supported format.</div>`;
    return `<figure class="paper-figure">
      ${media}
      <figcaption>
        <strong>${escapeHtml(normalized.name || `Figure ${index + 1}`)}</strong>
        ${normalized.caption ? `<span title="${escapeHtml(normalized.caption)}">${escapeHtml(compactAssetCaption(normalized.caption))}</span>` : ""}
        <small>Source: ${escapeHtml(normalized.source || "LaTeX source")}</small>
        ${renderAssetInterpretation(normalized._posterAnalysis)}
      </figcaption>
    </figure>`;
  }).join("");

  const tableHtml = renderableTables.slice(0, 4).map((table, index) => {
    const inheritedValueNote = /unlisted values? (?:are|is) identical|same as (?:the )?base/i.test(table.caption || "")
      ? `<span class="table-value-note">Blank cells are intentional: unlisted values use the base configuration.</span>`
      : "";
    const hasTableArtwork = Boolean(table.image?.url || table.pdfCrop?.url);
    const body = hasTableArtwork
      ? `<div class="table-image-scroll">
          <img ${table.image?.url
            ? `data-asset-url="${escapeHtml(table.image.url)}" data-asset-type="${escapeHtml(table.image.type)}"`
            : ""}
            ${table.pdfCrop?.url
              ? `data-table-pdf-url="${escapeHtml(table.pdfCrop.url)}" data-table-number="${Number(table.pdfCrop.tableNumber || index + 1)}"`
              : ""}
            ${table.pdfCrop?.fallbackUrl
              ? `data-table-pdf-fallback-url="${escapeHtml(table.pdfCrop.fallbackUrl)}"`
              : ""}
            alt="${escapeHtml(table.name || `Table ${index + 1}`)}" />
        </div>`
      : `<div class="figure-unavailable">Original table artwork was not available.</div>`;
    return `<figure class="paper-figure paper-table-figure">
      <figcaption class="table-caption">
        <strong>${escapeHtml(table.name || `Table ${index + 1}`)}</strong>
        ${table.caption ? `<span title="${escapeHtml(table.caption)}">${escapeHtml(compactAssetCaption(table.caption))}</span>` : ""}
        <small>Source: ${escapeHtml(table.source || "Original paper artwork")}</small>
        ${inheritedValueNote}
        ${renderAssetInterpretation(table._posterAnalysis)}
      </figcaption>
      ${body}
    </figure>`;
  }).join("");

  if (!figureHtml && !tableHtml) return "No reliable figure or table detected.";
  return `<div class="paper-visuals">${figureHtml}${tableHtml}</div>`;
}

function compactAssetCaption(value, maxLength = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const first = String(sentences[0] || "").trim();
  if (first.length >= 48 && first.length <= maxLength) return first;
  const boundary = text.lastIndexOf(" ", maxLength - 1);
  return `${text.slice(0, boundary > maxLength * 0.65 ? boundary : maxLength).replace(/[,:;\s]+$/, "")}…`;
}

async function renderFigureAssets() {
  const images = [...poster.querySelectorAll("img[data-asset-url], img[data-table-pdf-url]")];
  await Promise.all(images.map(async (image) => {
    const assetUrl = image.dataset.assetUrl;
    const tablePdfUrl = image.dataset.tablePdfUrl;
    const tablePdfFallbackUrl = image.dataset.tablePdfFallbackUrl;
    const type = image.dataset.assetType;
    try {
      let rendered = "";
      let primaryError = null;
      if (assetUrl) {
        try {
          rendered = type === "application/pdf"
            ? await renderPdfAsset(assetUrl)
            : await fetchAssetDataUrl(assetUrl);
        } catch (error) {
          primaryError = error;
        }
      }
      for (const url of [tablePdfUrl, tablePdfFallbackUrl].filter(Boolean)) {
        if (rendered) break;
        try {
          rendered = await browserTools.execute("pdf.table-crop", {
            url,
            tableNumber: Number(image.dataset.tableNumber || 1)
          });
        } catch (error) {
          primaryError ||= error;
        }
      }
      if (!rendered) throw primaryError || new Error("No table artwork source was available");
      image.src = rendered;
      image.removeAttribute("data-asset-url");
      image.removeAttribute("data-asset-type");
      image.removeAttribute("data-table-pdf-url");
      image.removeAttribute("data-table-pdf-fallback-url");
      image.removeAttribute("data-table-number");
      await waitForRenderedImage(image);
      classifyRenderedFigure(image);
    } catch (error) {
      const media = image.closest(".figure-media, .table-image-scroll");
      const tableFigure = image.closest(".paper-table-figure");
      if (tableFigure) {
        tableFigure.remove();
        console.warn("Rejected unverified table artwork:", error.message);
      } else if (media) {
        media.innerHTML = `<div class="figure-unavailable">Could not render original artwork: ${escapeHtml(error.message)}</div>`;
      }
    }
  }));
}

async function waitForRenderedImage(image) {
  if (!image.complete || !image.naturalWidth) {
    await new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  }
  if (image.decode && image.naturalWidth) {
    await image.decode().catch(() => {});
  }
}

function classifyRenderedFigure(image) {
  const figure = image.closest(".paper-figure");
  if (!figure) return;
  const images = [...figure.querySelectorAll(".figure-media img, .table-image-scroll img")]
    .filter((candidate) => candidate.naturalWidth > 0 && candidate.naturalHeight > 0);
  if (!images.length) return;
  const aspects = images.map((candidate) => candidate.naturalWidth / candidate.naturalHeight);
  const narrowestAspect = Math.min(...aspects);
  const widestAspect = Math.max(...aspects);
  figure.dataset.mediaLayout = images.length > 1 ? "multi" : "single";
  figure.dataset.mediaShape = narrowestAspect < 1.15
    ? "portrait"
    : widestAspect >= 3.6
      ? "ultrawide"
      : "landscape";
  figure.style.setProperty("--figure-media-aspect", String(narrowestAspect));
}

async function fetchAssetDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`asset request failed (${response.status})`);
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("could not read image data"));
    reader.readAsDataURL(blob);
  });
}

async function renderPdfAsset(url) {
  const pdfjsLib = await waitForPdfJs();
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PDF figure request failed (${response.status})`);
  const pdf = await pdfjsLib.getDocument({ data: await response.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1.5, 1400 / Math.max(base.width, 1)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas.toDataURL("image/png");
}

async function renderFormulaMath() {
  if (!window.MathJax?.typesetPromise || !targets.formula || !targets.figures) return;

  try {
    const mathTargets = [
      targets.formula,
      targets.problem,
      targets.motivation,
      targets.method.closest('[data-poster-section="method"]'),
      targets.result.closest('[data-poster-section="results"]'),
      targets.contribution
    ].filter(Boolean);
    if (window.MathJax.typesetClear) {
      window.MathJax.typesetClear(mathTargets);
    }
    await withTimeout(window.MathJax.typesetPromise(mathTargets), 8000);
  } catch (error) {
    console.warn("Formula rendering failed:", error);
  }
}

function setStatus(message, state = "idle") {
  pdfStatus.textContent = message;
  pdfStatus.dataset.state = state;
  paperPet.announce(message, state);
}

async function waitForPdfJs() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("PDF parser failed to load. Check the network and refresh the page.");
}

async function handlePdfUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return false;
  return processPdfFile(file);
}

async function processPdfFile(file, { continueToAnalysis = false } = {}) {
  if (file.type && file.type !== "application/pdf") {
    setStatus("Please choose a PDF file.", "error");
    return false;
  }

  const revision = beginNewPaperSource(file.name || "PDF");
  if (agentTrace) agentTrace.textContent = "Extracting a new PDF. Agent analysis has not started.";

  try {
    useUploadedPdf(file);
    setStatus(`Reading ${file.name}...`, "loading");
    const result = await browserTools.execute("pdf.parse", { file });
    if (revision !== sourceRevision) return false;
    reliableArxivFigures = normalizeFigures(result.figures, 12);
    reliableArxivTables = attachUploadedPdfCrops(normalizeTables(result.tables, 8));
    reliableArxivFormulas = Array.isArray(result.formulas) ? result.formulas : [];
    reliableArxivPaperText = "";
    reliablePdfFormulaImages = Array.isArray(result.formulaImages) ? result.formulaImages : [];
    reliablePdfAssetPageMap = result.assetPageMap || { figures: {}, tables: {} };
    commitSourceProfile({
      sourceType: "pdf", fileName: file.name, pageCount: result.pageCount, hasOriginalPdf: true,
      detectedArxivId: result.arxivId || "", title: result.title || "",
      titleLines: Array.isArray(result.titleLines) ? result.titleLines : [],
      doi: result.doi || "", paperUrl: result.paperUrl || ""
    }, result.text);
    input.value = result.text;

    if (result.arxivId) {
      setStatus(`Detected arXiv:${result.arxivId}. Loading exact LaTeX formulas and original figures...`, "loading");
      try {
        const payload = await withTimeout(paperApi.loadArxivSource(result.arxivId), 120000);
        if (revision !== sourceRevision) return false;
        if (paperSourceIdentity.enrichmentMatches
          && !paperSourceIdentity.enrichmentMatches(currentSourceProfile, payload, payload.paperText)) {
          throw new Error("The detected arXiv source belongs to a different paper; using PDF-native evidence instead.");
        }
        reliableArxivFormulas = Array.isArray(payload.formulas) ? payload.formulas : [];
        reliableArxivPaperText = String(payload.paperText || "");
        exactFormulaLookupCompleted = true;
        reliableArxivFigures = normalizeFigures(payload.figures, 12);
        reliableArxivTables = attachUploadedPdfCrops(normalizeTables(payload.tables, 8));
        reliablePdfFormulaImages = [];
        serverPreprocessingTrace = Array.isArray(payload.tools) ? payload.tools : [];
        commitSourceProfile({
          sourceType: "arxiv", arxivId: payload.id, uploadedFileName: file.name,
          pageCount: result.pageCount, hasLatex: true, hasOriginalPdf: true,
          title: payload.title || result.title || "",
          titleLines: Array.isArray(payload.titleLines) ? payload.titleLines : (result.titleLines || []),
          doi: payload.doi || result.doi || "",
          paperUrl: payload.paperUrl || result.paperUrl || `https://arxiv.org/abs/${payload.id}`
        }, payload.paperText);
        input.value = payload.paperText;
        const needsPdfFigureBackfill = result.pdfAssetsDeferred
          && (window.PosterAssetSelector?.needsFigureBackfill?.(result.text, reliableArxivFigures)
            ?? reliableArxivFigures.some((figure) => !figure.assets.length));
        if (needsPdfFigureBackfill) {
          setStatus("LaTeX figures are incomplete. Precisely cropping missing figures from the uploaded PDF...", "loading");
          const fallback = await browserTools.execute("pdf.parse", { file, forcePdfAssets: true });
          if (revision !== sourceRevision) return false;
          reliableArxivFigures = mergeFigureArtwork(
            reliableArxivFigures,
            normalizeFigures(fallback.figures, 12),
            { includeMissing: true }
          );
        }
      } catch (sourceError) {
        console.warn("arXiv enrichment failed; using PDF-native crops:", sourceError);
        if (result.pdfAssetsDeferred) {
          const fallback = await browserTools.execute("pdf.parse", { file, forcePdfAssets: true });
          if (revision !== sourceRevision) return false;
          reliableArxivFigures = normalizeFigures(fallback.figures, 12);
          reliableArxivTables = attachUploadedPdfCrops(normalizeTables(fallback.tables, 8));
          reliablePdfFormulaImages = Array.isArray(fallback.formulaImages) ? fallback.formulaImages : [];
        }
      }
    }
    loadCurrentPaperMemory();
    const sourceNote = currentSourceProfile.sourceType === "arxiv" && reliableArxivFormulas.length
      ? `Exact arXiv source loaded with ${reliableArxivFormulas.length} formulas and ${reliableArxivFigures.length} figures.`
      : `PDF-native fallback kept ${reliableArxivFigures.length} figure crops, ${reliableArxivTables.length} table crops, ${reliableArxivFormulas.length} clean inline formulas, and ${reliablePdfFormulaImages.length} formula crops.`;
    setStatus(
      continueToAnalysis
        ? `Extracted ${result.pageCount} pages from ${file.name}. ${sourceNote} Continuing automatically to Agent analysis.`
        : `Extracted ${result.pageCount} pages from ${file.name}. ${sourceNote} Click Generate Poster.`,
      continueToAnalysis ? "loading" : "success"
    );
    return true;
  } catch (error) {
    setStatus(error.message || "PDF parsing failed. Try another paper or paste text manually.", "error");
    return false;
  } finally {
    pdfInput.value = "";
  }
}

function collectDocumentStyles() {
  return [...document.styleSheets]
    .map((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
      } catch {
        return "";
      }
    })
    .join("\n");
}

function collectMathJaxCacheMarkup() {
  const hasSvgMath = Boolean(poster.querySelector('mjx-container[jax="SVG"]'));
  const mathJaxDefs = document.querySelector("#MJX-SVG-global-cache");
  const mathJaxCacheSvg = mathJaxDefs?.closest("svg");
  if (hasSvgMath && !mathJaxDefs) {
    throw new Error("Formula font data is not ready. Wait for formula rendering to finish, then try again.");
  }
  return mathJaxCacheSvg
    ? mathJaxCacheSvg.outerHTML
    : mathJaxDefs
      ? `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${mathJaxDefs.outerHTML}</svg>`
      : "";
}

async function waitForPosterAssets(root) {
  const images = [...root.querySelectorAll("img")];
  await Promise.all(images.map((image) => image.complete
    ? Promise.resolve()
    : new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      })));
  const assetDocument = root.nodeType === Node.DOCUMENT_NODE ? root : root.ownerDocument;
  if (assetDocument?.fonts?.ready) await assetDocument.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function buildFinalPosterNode() {
  assertCurrentAnalysisIdentity();
  const exportPosterNode = poster.cloneNode(true);
  exportPosterNode.dataset.uploadedPdfAvailable = currentUploadedPdfUrl ? "true" : "false";
  preparePosterForExport(exportPosterNode);
  await browserTools.execute("poster.interactions", {
    root: exportPosterNode,
    analysis: currentAnalysis || {},
    sourceText: reliableArxivPaperText || input.value
  });
  stripPosterEvidenceCues(exportPosterNode);
  const hadStandaloneClass = document.body.classList.contains("standalone-poster");
  exportPosterNode.classList.add("poster-calibration");
  document.body.classList.add("standalone-poster");
  document.body.append(exportPosterNode);
  try {
    await waitForPosterAssets(exportPosterNode);
    refinePosterLayout(exportPosterNode, {
      iterations: 5,
      reviewHints: posterVisionReview.readReviewHints(exportPosterNode)
    });
  } finally {
    exportPosterNode.remove();
    exportPosterNode.classList.remove("poster-calibration");
    if (!hadStandaloneClass) document.body.classList.remove("standalone-poster");
  }
  return exportPosterNode;
}

function buildStandalonePosterHtml(exportPosterNode, title, { includeUploadedPdfBridge = false } = {}) {
  const styles = collectDocumentStyles();
  const mathJaxCacheMarkup = collectMathJaxCacheMarkup();
  const evidenceViewerScript = window.PosterEvidenceViewer?.standaloneScript?.() || "";
  const layoutGuardScript = window.PosterLayoutPlanner?.standaloneGuardScript?.() || "";
  const identity = currentAnalysis?._sourceIdentity;
  const visibleTitle = exportPosterNode.querySelector("#posterTitle")?.getAttribute("aria-label")
    || exportPosterNode.querySelector("#posterTitle")?.textContent || "";
  const exportTitle = window.PosterExportTools?.cleanPosterTitle(
    identity?.title || visibleTitle || title || "Paper poster"
  ) || "Paper poster";
  if (identity?.strict) {
    const paperLink = exportPosterNode.querySelector("#posterPaperLink")?.getAttribute("href") || "";
    if (!paperSourceIdentity.titlesAgree(exportTitle, identity.title)
      || !paperSourceIdentity.titlesAgree(visibleTitle, identity.title)
      || paperLink !== identity.paperUrl) {
      throw new Error("Export stopped because the poster title or paper link does not match the analyzed PDF.");
    }
  }
  const identityMeta = identity?.strict
    ? `<meta name="paper-source-key" content="${escapeHtml(identity.key)}" />\n  <meta name="paper-source-title" content="${escapeHtml(identity.title)}" />${identity.paperUrl ? `\n  <link rel="canonical" href="${escapeHtml(identity.paperUrl)}" />` : ""}`
    : "";

  if (!includeUploadedPdfBridge) exportPosterNode.removeAttribute("data-uploaded-pdf-available");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${identityMeta}
  <title>${escapeHtml(exportTitle)}</title>
  <style>${styles}</style>
</head>
<body class="standalone-poster">
  ${mathJaxCacheMarkup}
  ${exportPosterNode.outerHTML}
  ${layoutGuardScript ? `<script>${layoutGuardScript}<\/script>` : ""}
  ${evidenceViewerScript ? `<script>${evidenceViewerScript}<\/script>` : ""}
</body>
</html>`;
}

async function syncWorkspacePosterPreview() {
  if (!posterPreviewFrame) return;
  if (posterGenerationPromise && posterGenerationRevision === sourceRevision) {
    try {
      assertCurrentAnalysisIdentity();
    } catch (error) {
      console.warn("Skipped a stale preview while the paper source was changing:", error);
      return false;
    }
  } else if (!await ensureCurrentPoster("previewing")) {
    return false;
  }
  const version = ++posterPreviewVersion;
  try {
    const title = currentAnalysis?.title || targets.title.getAttribute("aria-label") || targets.title.textContent.trim() || "Paper poster";
    const finalPosterNode = await buildFinalPosterNode();
    const html = buildStandalonePosterHtml(finalPosterNode, title, { includeUploadedPdfBridge: true });
    posterPreviewFrame.onload = async () => {
      if (version !== posterPreviewVersion) return;
      const previewDocument = posterPreviewFrame.contentDocument;
      if (!previewDocument) return;
      await waitForPosterAssets(previewDocument);
      if (version !== posterPreviewVersion) return;

      posterPreviewCleanup?.();
      const previewPoster = previewDocument.querySelector(".poster-export");
      if (!previewPoster) return;
      previewDocument.addEventListener("wheel", (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("paper-agent-zoom-request", {
          detail: { direction: event.deltaY < 0 ? 1 : -1 }
        }));
      }, { passive: false, capture: true });
      previewDocument.addEventListener("keydown", (event) => {
        if (!event.ctrlKey) return;
        const direction = ["+", "=", "Add"].includes(event.key)
          ? 1
          : ["-", "Subtract"].includes(event.key)
            ? -1
            : 0;
        if (!direction && event.key !== "0") return;
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("paper-agent-zoom-request", {
          detail: { direction, reset: event.key === "0" }
        }));
      }, true);
      previewDocument.documentElement.style.overflow = "hidden";
      Object.assign(previewDocument.body.style, {
        minWidth: "0",
        margin: "0",
        overflow: "hidden"
      });

      const fitPreview = () => {
        if (version !== posterPreviewVersion || !posterPreviewFrame.contentDocument) return;
        const bodyStyle = previewDocument.defaultView.getComputedStyle(previewDocument.body);
        const paddingBottom = Number.parseFloat(bodyStyle.paddingBottom) || 0;
        const requiredHeight = Math.ceil(previewPoster.offsetTop + previewPoster.offsetHeight + paddingBottom);
        previewDocument.body.style.height = `${requiredHeight}px`;
        posterPreviewFrame.style.height = `${requiredHeight}px`;
      };
      const posterResizeObserver = new ResizeObserver(fitPreview);
      posterResizeObserver.observe(previewPoster);
      const frameResizeObserver = new ResizeObserver(fitPreview);
      frameResizeObserver.observe(posterPreviewFrame);
      const mutationObserver = new MutationObserver(fitPreview);
      mutationObserver.observe(previewPoster, { childList: true, subtree: true, characterData: true });
      const timers = [0, 80, 240, 600, 1200, 2400].map((delay) => setTimeout(fitPreview, delay));
      posterPreviewCleanup = () => {
        posterResizeObserver.disconnect();
        frameResizeObserver.disconnect();
        mutationObserver.disconnect();
        timers.forEach(clearTimeout);
      };
      fitPreview();
    };
    posterPreviewFrame.srcdoc = html;
    return true;
  } catch (error) {
    console.warn("Workspace poster preview failed:", error);
    setStatus(error.message || "The current poster preview could not be prepared.", "error");
    return false;
  }
}

async function exportPoster() {
  exportBtn.disabled = true;
  const originalLabel = exportBtn.textContent;
  exportBtn.textContent = "Preparing...";
  try {
    if (!await ensureCurrentPoster("exporting")) return;
    const title = currentAnalysis.title || targets.title.getAttribute("aria-label") || targets.title.textContent.trim() || "paper-poster";
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    const html = buildStandalonePosterHtml(await buildFinalPosterNode(), title);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle || "paper-poster"}.html`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Poster HTML exported with embedded images and formula fonts.", "success");
  } catch (error) {
    setStatus(error.message || "Poster export could not be prepared.", "error");
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = originalLabel;
  }
}

async function runEvaluationBenchmark() {
  evaluateBtn.disabled = true;
  evaluateBtn.textContent = "Evaluating...";
  evaluationStatus.textContent = "Running fixed offline benchmark...";
  evaluationBadge.textContent = "Running";
  evaluationBadge.dataset.state = "running";
  try {
    const response = await fetch("/api/evaluate", { method: "POST" });
    const report = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(report.error || "Evaluation request failed.");
    renderEvaluationReport(report);
  } catch (error) {
    evaluationStatus.textContent = error.message || "Evaluation failed.";
    evaluationBadge.textContent = "Failed";
    evaluationBadge.dataset.state = "failed";
  } finally {
    evaluateBtn.disabled = false;
    evaluateBtn.textContent = "Run Evaluation";
  }
}

function renderEvaluationReport(report) {
  const summary = report.summary || {};
  const passed = Number(summary.passed || 0);
  const cases = Number(summary.cases || 0);
  const allPassed = cases > 0 && passed === cases;
  evaluationStatus.textContent = `${passed}/${cases} fixed cases passed. ${report.runtime?.mode === "offline-reference" ? "No LLM API was called." : ""}`;
  evaluationBadge.textContent = allPassed ? "Passed" : "Needs work";
  evaluationBadge.dataset.state = allPassed ? "passed" : "failed";
  const metrics = [
    ["Overall", summary.overallScore],
    ["Coverage", summary.contentCoverage],
    ["Formula F1", summary.formulaF1],
    ["Figures", summary.figureRecall],
    ["Tables", summary.tableRecall],
    ["Evidence", summary.evidenceConsistency],
    ["Hallucination", summary.hallucinationRate]
  ];
  evaluationMetrics.innerHTML = metrics.map(([label, value]) => `
    <span><small>${label}</small><b>${formatEvaluationPercent(value)}</b></span>
  `).join("");
  evaluationCases.innerHTML = `
    <table>
      <thead><tr><th>Case</th><th>Status</th><th>Score</th><th>Evidence</th><th>Hallucination</th></tr></thead>
      <tbody>${(report.cases || []).map((item) => `
        <tr>
          <td>${escapeHtml(item.title || item.id || "Unnamed case")}</td>
          <td><span class="evaluation-result ${item.passed ? "passed" : "failed"}">${item.passed ? "Pass" : "Fail"}</span></td>
          <td>${formatEvaluationPercent(item.overallScore)}</td>
          <td>${formatEvaluationPercent(item.metrics?.evidence?.score)}</td>
          <td>${formatEvaluationPercent(Number(item.metrics?.hallucination?.rate || 0) * 100)}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

function formatEvaluationPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

async function runProductionVisionChecks(expectedRevision = sourceRevision) {
  activeVisionController?.abort();
  const controller = new AbortController();
  activeVisionController = controller;
  const stages = [
    { id: "assets", label: "素材质检", rounds: 1, passScore: 85 },
    { id: "content", label: "内容质检", rounds: 1, passScore: 85 },
    { id: "layout", label: "布局质检", rounds: 2, passScore: 88 }
  ];
  let previousReview = null;
  let revisedSections = 0;
  let completedStages = 0;

  visualReviewBtn.disabled = true;
  visualReviewBadge.textContent = "制作中";
  visualReviewBadge.dataset.state = "running";
  try {
    for (const stage of stages) {
      for (let iteration = 1; iteration <= stage.rounds; iteration += 1) {
        if (expectedRevision !== sourceRevision) return { status: "stale" };
        visualReviewStatus.textContent = `${stage.label}${stage.rounds > 1 ? ` ${iteration}/${stage.rounds}` : ""}：正在检查并修补海报...`;
        setStatus(`Agent: ${stage.label}，视觉模型正在检查当前版本。`, "loading");
        const snapshot = await posterVisionReview.createPosterReviewSnapshot(poster, {
          preparePosterForExport,
          refinePosterLayout
        });
        const response = await fetch("/api/review-poster", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageDataUrl: snapshot.imageDataUrl,
            metrics: snapshot.metrics,
            posterContent: collectPosterReviewContent(),
            paperContext: collectPosterPaperContext(),
            stage: stage.id,
            iteration,
            previousReview
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (expectedRevision !== sourceRevision) return { status: "stale" };
        if (!response.ok) {
          if (response.status === 400 && /not configured/i.test(payload.error || "")) {
            visualReviewStatus.textContent = "未配置视觉模型，已跳过制作过程质检；海报主体仍正常生成。";
            visualReviewBadge.textContent = "未配置";
            visualReviewBadge.dataset.state = "failed";
            return { status: "skipped", reason: payload.error };
          }
          throw new Error(payload.error || `${stage.label}失败。`);
        }

        previousReview = payload.review;
        if (stage.id !== "content") posterVisionReview.applyVisualReview(poster, payload.review);
        const appliedRevisions = stage.id === "content"
          ? applyPosterContentRevisions(payload.contentRefinement?.revisions)
          : [];
        revisedSections += appliedRevisions.length;
        if (appliedRevisions.includes("theory") || appliedRevisions.includes("method")) await renderFormulaMath();
        await syncWorkspacePosterPreview();
        renderVisualReview(payload.review, payload.model, iteration, payload.contentRefinement, appliedRevisions);

        const hasHighIssue = payload.review.issues?.some((issue) => issue.severity === "high");
        if (payload.review.verdict === "pass" && payload.review.overallScore >= stage.passScore && !hasHighIssue) break;
      }
      completedStages += 1;
    }

    visualReviewStatus.textContent = `制作过程质检完成：素材、内容与布局均已检查；修订 ${revisedSections} 个内容板块。`;
    visualReviewBadge.textContent = `${previousReview?.overallScore || 0}/100`;
    visualReviewBadge.dataset.state = previousReview?.verdict === "pass" ? "passed" : "failed";
    return { status: "completed", review: previousReview, revisedSections };
  } catch (error) {
    if (controller.signal.aborted || expectedRevision !== sourceRevision) return { status: "stale" };
    visualReviewStatus.textContent = `已完成 ${completedStages}/${stages.length} 个视觉质检阶段；${error.message}`;
    visualReviewBadge.textContent = "部分完成";
    visualReviewBadge.dataset.state = "failed";
    return { status: "partial", error };
  } finally {
    if (activeVisionController === controller) activeVisionController = null;
    if (expectedRevision === sourceRevision) {
      visualReviewBtn.disabled = false;
      visualReviewBtn.textContent = "Review & Improve";
    }
  }
}

async function runVisualPosterReview() {
  if (!currentAnalysis || !targets.title.textContent.trim() || targets.title.textContent.includes("Waiting for")) {
    setStatus("Generate a poster before running visual review.", "error");
    return;
  }

  visualReviewBtn.disabled = true;
  visualReviewBtn.textContent = "Reviewing...";
  visualReviewBadge.textContent = "Running";
  visualReviewBadge.dataset.state = "running";
  const expectedRevision = sourceRevision;
  activeVisionController?.abort();
  const controller = new AbortController();
  activeVisionController = controller;
  let previousReview = null;
  let revisedSections = 0;
  try {
    for (let iteration = 1; iteration <= 2; iteration += 1) {
      visualReviewStatus.textContent = `Iteration ${iteration}/2: rendering the final poster for visual inspection...`;
      setStatus(`Visual Reviewer: preparing full poster image (${iteration}/2).`, "loading");
      const snapshot = await posterVisionReview.createPosterReviewSnapshot(poster, {
        preparePosterForExport,
        refinePosterLayout
      });
      const posterContent = collectPosterReviewContent();
      const paperContext = collectPosterPaperContext();
      visualReviewStatus.textContent = `Iteration ${iteration}/2: ${iteration === 1 ? "reviewing composition" : "checking the repaired composition"}...`;
      const response = await fetch("/api/review-poster", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: snapshot.imageDataUrl,
          metrics: snapshot.metrics,
          posterContent,
          paperContext,
          stage: "final",
          iteration,
          previousReview
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (expectedRevision !== sourceRevision) return;
      if (!response.ok) throw new Error(payload.error || "Visual poster review failed.");
      previousReview = payload.review;
      posterVisionReview.applyVisualReview(poster, payload.review);
      const appliedRevisions = applyPosterContentRevisions(payload.contentRefinement?.revisions);
      revisedSections += appliedRevisions.length;
      if (appliedRevisions.includes("theory") || appliedRevisions.includes("method")) await renderFormulaMath();
      await syncWorkspacePosterPreview();
      renderVisualReview(payload.review, payload.model, iteration, payload.contentRefinement, appliedRevisions);
      if (payload.review.verdict === "pass" && payload.review.overallScore >= 88) break;
    }
    setStatus(`Poster review complete. Final score: ${previousReview.overallScore}/100; ${revisedSections} content revision(s) and constrained layout repairs applied.`, "success");
  } catch (error) {
    if (controller.signal.aborted || expectedRevision !== sourceRevision) return;
    visualReviewStatus.textContent = error.message || "Visual review failed.";
    visualReviewBadge.textContent = "Unavailable";
    visualReviewBadge.dataset.state = "failed";
    setStatus(error.message || "Visual review failed.", "error");
  } finally {
    if (activeVisionController === controller) activeVisionController = null;
    if (expectedRevision === sourceRevision) {
      visualReviewBtn.disabled = false;
      visualReviewBtn.textContent = "Review & Improve";
    }
  }
}

function renderVisualReview(review, model, iteration, contentRefinement = {}, appliedRevisions = []) {
  const dimensions = [
    ["Readability", review.dimensions?.readability],
    ["Hierarchy", review.dimensions?.hierarchy],
    ["Balance", review.dimensions?.balance],
    ["Assets", review.dimensions?.assetLegibility],
    ["Density", review.dimensions?.contentDensity],
    ["Polish", review.dimensions?.polish],
    ["Narrative", review.dimensions?.narrative],
    ["Selection", review.dimensions?.contentSelection],
    ["Evidence", review.dimensions?.evidenceCommunication],
    ["Concision", review.dimensions?.concision]
  ];
  visualReviewStatus.textContent = `${model || "Vision model"}, iteration ${iteration}: ${review.summary}`;
  visualReviewBadge.textContent = `${review.overallScore}/100`;
  visualReviewBadge.dataset.state = review.verdict === "pass" ? "passed" : "failed";
  visualReviewScores.innerHTML = dimensions.map(([label, score]) => `
    <span><small>${label}</small><b>${Math.round(Number(score) || 0)}</b></span>
  `).join("");
  const refinementNote = appliedRevisions.length
    ? `<p><strong>Content refined:</strong> ${appliedRevisions.map(escapeHtml).join(", ")}.</p>`
    : contentRefinement.status === "unavailable"
      ? `<p><strong>Content refinement unavailable:</strong> ${escapeHtml(contentRefinement.error || "Text model request failed.")}</p>`
      : "";
  visualReviewSummary.innerHTML = review.strengths?.length
    ? `<strong>Visible strengths</strong><p>${review.strengths.map(escapeHtml).join(" · ")}</p>${refinementNote}`
    : `${escapeHtml(review.summary || "Poster review completed.")}${refinementNote}`;
  visualReviewIssues.innerHTML = review.issues?.length
    ? review.issues.map((issue) => `
      <article data-severity="${escapeHtml(issue.severity)}">
        <strong>${escapeHtml(issue.panel)} · ${escapeHtml(issue.category)}</strong>
        <p>${escapeHtml(issue.observation)}</p>
        <small>${escapeHtml(issue.recommendation)}</small>
      </article>
    `).join("")
    : '<div class="visual-review-clear">No visible high-priority issues were reported.</div>';
}

function collectPosterReviewContent() {
  return {
    summary: targets.summary.textContent.trim(),
    problem: targets.problem.textContent.trim(),
    motivation: targets.motivation.textContent.trim(),
    method: targets.method.textContent.replace(/\s+/g, " ").trim(),
    theory: currentAnalysis?.theory || targets.formula.querySelector(".poster-section-lead")?.textContent.trim() || "",
    results: targets.result.textContent.trim(),
    contributions: targets.contribution.textContent.trim(),
    visualEvidence: [...poster.querySelectorAll(".poster-inline-assets figcaption")].map((caption) => caption.textContent.replace(/\s+/g, " ").trim()).slice(0, 5),
    formulaExplanations: [...targets.formula.querySelectorAll(".asset-interpretation")].map((item) => item.textContent.replace(/\s+/g, " ").trim()).slice(0, 4)
  };
}

function collectPosterPaperContext() {
  if (!currentAnalysis) return {};
  const fields = ["title", "summary", "problem", "motivation", "method", "theory", "experiments", "results", "contributions", "innovation", "methodSupportsProblem", "experimentsValidateClaims"];
  return {
    analysis: Object.fromEntries(fields.map((field) => [field, currentAnalysis[field]]).filter(([, value]) => typeof value === "string" && value.trim())),
    evidence: currentAnalysis._agent?.evidence || {},
    verification: {
      verdict: currentAnalysis._agent?.verification?.verdict || "",
      summary: currentAnalysis._agent?.verification?.summary || ""
    }
  };
}

function applyPosterContentRevisions(revisions) {
  if (!revisions || typeof revisions !== "object") return [];
  const applied = [];
  const simpleTargets = {
    summary: targets.summary,
    problem: targets.problem,
    motivation: targets.motivation,
    results: targets.result,
    contributions: targets.contribution
  };
  for (const [field, target] of Object.entries(simpleTargets)) {
    const value = typeof revisions[field] === "string" ? revisions[field].trim() : "";
    if (!value) continue;
    target.textContent = value;
    if (currentAnalysis) currentAnalysis[field] = value;
    applied.push(field);
  }
  if (typeof revisions.method === "string" && revisions.method.trim()) {
    const value = revisions.method.trim();
    targets.method.innerHTML = makeList([value]);
    if (currentAnalysis) currentAnalysis.method = value;
    applied.push("method");
  }
  if (typeof revisions.theory === "string" && revisions.theory.trim()) {
    const rawValue = revisions.theory.trim();
    const formulaSources = [
      ...(Array.isArray(currentAnalysis?.sourceFormulas) ? currentAnalysis.sourceFormulas : []),
      currentAnalysis?.supportingTheoryFormula || ""
    ];
    const value = window.PaperInlineMath?.repairMissingInlineMath
      ? window.PaperInlineMath.repairMissingInlineMath(rawValue, formulaSources)
      : rawValue;
    if (currentAnalysis?.theory && window.PaperInlineMath?.preservesInlineMath
      && !window.PaperInlineMath.preservesInlineMath(currentAnalysis.theory, value)) {
      console.warn("Rejected theory revision because it removed an existing formula.");
      return applied;
    }
    let lead = targets.formula.querySelector(".poster-section-lead");
    if (!lead) {
      lead = document.createElement("p");
      lead.className = "poster-section-lead";
      targets.formula.prepend(lead);
    }
    lead.innerHTML = renderInlineMathText(value);
    if (currentAnalysis) currentAnalysis.theory = value;
    applied.push("theory");
  }
  if (applied.length) {
    poster.dataset.contentRevisionCount = String(Number(poster.dataset.contentRevisionCount || 0) + applied.length);
  }
  return applied;
}

function resetVisualReview() {
  delete poster.dataset.reviewLayoutHints;
  delete poster.dataset.visualReviewScore;
  delete poster.dataset.reviewBodyScale;
  delete poster.dataset.reviewHeadingScale;
  delete poster.dataset.reviewMediaScale;
  delete poster.dataset.contentRevisionCount;
  poster.style.removeProperty("--poster-review-body-size");
  poster.style.removeProperty("--poster-review-heading-size");
  poster.style.removeProperty("--poster-review-media-scale");
  poster.style.removeProperty("--poster-review-media-max-height");
  poster.classList.remove("poster-review-contrast");
  visualReviewStatus.textContent = "Generate a poster, then run visual review.";
  visualReviewBadge.textContent = "Ready";
  visualReviewBadge.dataset.state = "";
  visualReviewScores.replaceChildren();
  visualReviewSummary.textContent = "The reviewer checks content selection, narrative, evidence communication, readability, hierarchy, and visual polish.";
  visualReviewIssues.replaceChildren();
}

analyzeBtn.addEventListener("click", generatePoster);
evaluateBtn.addEventListener("click", runEvaluationBenchmark);
visualReviewBtn.addEventListener("click", runVisualPosterReview);

loadSampleBtn.addEventListener("click", () => {
  beginNewPaperSource("sample paper");
  currentSourceProfile = { sourceType: "text", sourceLabel: "sample" };
  input.value = samplePaper;
  loadCurrentPaperMemory();
  resetAgentFlow();
  if (agentTrace) agentTrace.textContent = "Sample loaded. Agent analysis has not started.";
  setStatus("Sample paper loaded. Click Generate Poster to run LLM analysis.", "success");
});

clearBtn.addEventListener("click", () => {
  beginNewPaperSource("paper");
  currentSourceProfile = { sourceType: "text" };
  renderPosterTitle("Waiting for a paper");
  targets.summary.textContent = "Upload a PDF or paste paper text to begin.";
  if (agentTrace) agentTrace.textContent = "Agent is ready.";
  setStatus("Upload a PDF, or paste paper text, Markdown notes, formulas, and figure placeholders.");
});

pdfInput.addEventListener("change", handlePdfUpload);
loadArxivBtn.addEventListener("click", handleArxivLoad);
arxivInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    handleArxivLoad();
  }
});
input.addEventListener("input", () => {
  activeAnalysisController?.abort();
  activeVisionController?.abort();
  activeAnalysisController = null;
  activeVisionController = null;
  sourceRevision += 1;
  currentAnalysis = null;
  clearUploadedPdfUrl();
  browserTools.clearTrace();
  serverPreprocessingTrace = [];
  reliableArxivFormulas = [];
  reliableArxivPaperText = "";
  exactFormulaLookupCompleted = false;
  reliableArxivFigures = [];
  reliableArxivTables = [];
  reliablePdfFormulaImages = [];
  reliablePdfAssetPageMap = { figures: {}, tables: {} };
  currentSourceProfile = { sourceType: "text", sourceLabel: "manual" };
  clearTimeout(memoryRefreshTimer);
  memoryRefreshTimer = setTimeout(loadCurrentPaperMemory, 350);
});
addAnnotationBtn.addEventListener("click", () => {
  if (!ensureMemoryForNotes()) return;
  currentMemory = paperMemory.addAnnotation(currentMemory, annotationInput.value);
  annotationInput.value = "";
  renderNotebook();
});
addQuestionBtn.addEventListener("click", () => {
  if (!ensureMemoryForNotes()) return;
  currentMemory = paperMemory.addQuestion(currentMemory, questionInput.value);
  questionInput.value = "";
  renderNotebook();
});
annotationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-memory-action='delete-note']");
  if (!button || !currentMemory) return;
  currentMemory = paperMemory.deleteAnnotation(currentMemory, button.dataset.memoryId);
  renderNotebook();
});
questionList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-memory-action]");
  if (!button || !currentMemory) return;
  if (button.dataset.memoryAction === "toggle-question") {
    currentMemory = paperMemory.toggleQuestion(currentMemory, button.dataset.memoryId);
  } else if (button.dataset.memoryAction === "delete-question") {
    currentMemory = paperMemory.deleteQuestion(currentMemory, button.dataset.memoryId);
  }
  renderNotebook();
});
testApiBtn.addEventListener("click", testApiConnection);
exportBtn.addEventListener("click", exportPoster);

setStatus(`Ready. Client ${clientVersion}. Upload a PDF, or paste paper text, Markdown notes, formulas, and figure placeholders.`);
renderNotebook();
