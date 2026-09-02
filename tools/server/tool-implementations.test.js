const test = require("node:test");
const assert = require("node:assert/strict");
const { extractLatexFormulas } = require("./latex-formulas");
const { extractLatexFigures, getCachedAsset } = require("./latex-figures");
const { extractLatexTables } = require("./latex-tables");
const { fetchArxivLatexBundle, resolveArxivIdByTitle, unpackArxivPayload, combineTexFiles } = require("./arxiv-source");
const { retrieveTaskEvidence } = require("./evidence-retrieve");
const { auditAnalysis } = require("./reflection-audit");
const { recallPaperMemory } = require("./memory-recall");
const { extractLatexTitle, extractLatexTitleLines } = require("./latex-utils");
const { extractRenderableTableLatex } = require("./pdf-table-crop");

test("LaTeX title extraction preserves wrapped subtitles and removes author notes", () => {
  const title = extractLatexTitle(String.raw`\title{Perceiver: \textbf{General Perception}\\ with Iterative Attention\thanks{Equal contribution}}`);
  assert.equal(title, "Perceiver: General Perception with Iterative Attention");
  assert.deepEqual(extractLatexTitleLines(String.raw`\title{Perceiver: \textbf{General Perception}\\ with Iterative Attention}`), [
    "Perceiver: General Perception",
    "with Iterative Attention"
  ]);
  assert.deepEqual(extractLatexTitleLines(String.raw`\title{Attention Is All You Need}`), []);
});

test("formula implementation expands zero-argument macros", () => {
  const formulas = extractLatexFormulas(String.raw`\newcommand{\dmodel}{d_{model}}
\begin{equation}x = \dmodel\end{equation}`);
  assert.equal(formulas.length, 1);
  assert.match(formulas[0], /d_\{model\}/);
});

test("formula implementation expands nested and parameterized RAG macros", () => {
  const formulas = extractLatexFormulas(String.raw`\newcommand{\peranswer}{p_{\text{\tiny{RAG-Sequence}}}}
\newcommand{\history}[1]{{1:#1-1}}
\newcommand{\query}{\ensuremath{x}}
\begin{equation}\peranswer(y|\query)=\sum_{\mathclap{z \in K}} p(y_i|x,y_\history{i})\end{equation}`);
  assert.equal(formulas.length, 1);
  assert.match(formulas[0], /RAG-Sequence/);
  assert.match(formulas[0], /1:i-1/);
  assert.doesNotMatch(formulas[0], /\\(?:peranswer|history|ensuremath|mathclap|tiny)/);
});

test("formula implementation rejects author metadata wrapped as display math", () => {
  const formulas = extractLatexFormulas(String.raw`\[ , Yanlin Wang \]
\begin{equation}L = L_{task} + L_{reg}\end{equation}`);
  assert.equal(formulas.length, 1);
  assert.match(formulas[0], /L_\{task\}/);
  assert.doesNotMatch(formulas[0], /Yanlin Wang/);
});

test("figure implementation resolves original archive assets", () => {
  const files = [{ name: "figures/model.png", data: Buffer.from("image") }];
  const latex = String.raw`\begin{figure}\includegraphics{figures/model}\caption{Model overview}\end{figure}`;
  const figures = extractLatexFigures(latex, files, "1234.5678");
  assert.equal(figures[0].caption, "Model overview");
  assert.equal(figures[0].assets[0].path, "figures/model.png");
});

test("rendered LaTeX table artwork excludes its caption and neighboring prose", () => {
  const artwork = extractRenderableTableLatex(String.raw`\begin{table}
\small
\caption{Parzen-window estimates for MNIST. Nearby explanatory prose.}
\label{tab:mnist}
\begin{tabular}{lr}
Model & MNIST \\
DBN & 138 \\
\end{tabular}
\end{table}`);
  assert.match(artwork, /\\begin\{tabular\}/);
  assert.match(artwork, /DBN & 138/);
  assert.match(artwork, /\\small/);
  assert.doesNotMatch(artwork, /caption|Parzen|Nearby|label/);
});

test("table implementation reconstructs rows and multicolumn spans", () => {
  const tables = extractLatexTables(String.raw`\begin{table}\caption{Scores}\begin{tabular}{cc}A & B \\ \multicolumn{2}{c}{value} \\ \end{tabular}\end{table}`);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].rows[0], ["A", "B"]);
  assert.equal(tables[0].rows[1][0], "value");
});

test("arXiv source implementation accepts a plain TeX payload and expands includes", () => {
  const payload = Buffer.from("\\documentclass{article}\\begin{document}Hello\\end{document}");
  const unpacked = unpackArxivPayload(payload);
  assert.equal(unpacked[0].name, "source.tex");
  const combined = combineTexFiles(
    { name: "main.tex", content: "Start \\input{part} End" },
    [{ name: "main.tex", content: "" }, { name: "part.tex", content: "middle" }]
  );
  assert.match(combined, /middle/);
});

test("arXiv source download falls back to the secondary endpoint", async () => {
  const calls = [];
  const latex = String.raw`\documentclass{article}\begin{document}\title{Fallback Test}\maketitle\end{document}`;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("primary.example")) throw new Error("network unavailable");
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(latex).buffer
    };
  };

  const bundle = await fetchArxivLatexBundle("9999.00001", {
    baseUrls: ["https://primary.example/e-print", "https://fallback.example/e-print"],
    fetchImpl,
    timeoutMs: 1000,
    cache: false
  });

  assert.equal(calls.length, 2);
  assert.equal(bundle.mainTex.name, "source.tex");
  assert.match(bundle.combinedTex, /Fallback Test/);
});

test("arXiv title lookup accepts only an exact normalized paper title", async () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><id>https://arxiv.org/abs/2005.11401v4</id><title>Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks</title></entry>
    <entry><id>https://arxiv.org/abs/2401.00001v1</id><title>A Survey of Retrieval-Augmented Generation</title></entry>
  </feed>`;
  const match = await resolveArxivIdByTitle("Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", {
    endpoint: "https://example.test/api/query",
    fetchImpl: async () => ({ ok: true, text: async () => xml })
  });
  assert.deepEqual(match, {
    id: "2005.11401",
    title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"
  });
  const noMatch = await resolveArxivIdByTitle("Retrieval Augmentation for an Unrelated Task", {
    endpoint: "https://example.test/api/query",
    fetchImpl: async () => ({ ok: true, text: async () => xml })
  });
  assert.equal(noMatch, null);
});

test("asset lookup rejects path traversal", () => {
  const cache = new Map([["id", new Map([["figure.png", { name: "figure.png" }]])]]);
  assert.equal(getCachedAsset(cache, "id", "../figure.png")?.name, "figure.png");
  assert.ok(getCachedAsset(cache, "id", "../../missing.png") == null);
});

test("evidence retrieval prioritizes sections relevant to the reading task", () => {
  const paper = [
    "# Introduction\nA general problem statement.",
    "# Method\nThe model uses sparse attention and a gated projection layer.",
    "# Results\nAccuracy improves on the evaluation benchmark."
  ].join("\n");
  const result = retrieveTaskEvidence(paper, {
    id: "method",
    label: "Method",
    goal: "Reconstruct the model architecture."
  }, { maxChars: 400 });
  assert.equal(result.candidates[0].location, "Method");
  assert.match(result.context, /sparse attention/);
});

test("method evidence prefers Methodology over Related Work in a method paper", () => {
  const paper = `# Abstract
We propose AgentCoder, a three-agent code generation framework.
# 2 Related Work
Existing multi-agent methods use many agents. Prior work has weak feedback.
# 3 Methodology
AgentCoder routes independently generated tests and code to a local test executor. Failed executions return concrete error feedback to the programmer agent until all tests pass.
# 4 Evaluation
AgentCoder is evaluated on HumanEval and MBPP.`;
  const task = { id: "method", label: "Method", goal: "Reconstruct the proposed framework", fields: ["method"] };
  const result = retrieveTaskEvidence(paper, task, { maxChunks: 1, maxChars: 1800 });
  assert.match(result.candidates[0].location, /Methodology/i);
  assert.match(result.context, /local test executor/i);
});

test("reflection audit checks asset provenance and missing key content", () => {
  const report = auditAnalysis({
    analysis: { methodSupportsProblem: "supported", experimentsValidateClaims: "supported" },
    evidence: { problem: [{}], method: [{}], experiments: [{}], results: [{}] },
    readingTasks: [{ status: "completed" }],
    sourceProfile: { sourceType: "arxiv", formulaCount: 2, figureCount: 1, tableCount: 1 },
    toolTrace: [
      { name: "latex.formulas", status: "completed" },
      { name: "latex.figures", status: "completed" },
      { name: "latex.tables", status: "completed" }
    ]
  });
  assert.equal(report.checks.find((check) => check.id === "formula-provenance").ok, true);
  assert.equal(report.checks.find((check) => check.id === "figure-provenance").ok, true);
  assert.equal(report.checks.find((check) => check.id === "required-content").ok, false);
  assert.equal(report.verdict, "warning");
});

test("memory recall selects task notes without treating them as evidence", () => {
  const recalled = recallPaperMemory({
    metadata: { title: "Paper" },
    sectionSummaries: { method: { summary: "Prior method summary", evidenceLocations: ["Method"] } },
    annotations: ["Check sparse attention assumptions", "Unrelated publication note"],
    unresolvedQuestions: ["Does the method ablate sparse attention?"]
  }, { id: "method", label: "Method", goal: "Reconstruct the architecture" });
  assert.equal(recalled.available, true);
  assert.equal(recalled.priorSection.summary, "Prior method summary");
  assert.match(recalled.annotations[0], /sparse attention/);
  assert.ok(!Object.prototype.hasOwnProperty.call(recalled, "evidence"));
});
