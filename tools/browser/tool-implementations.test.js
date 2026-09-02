const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadBrowserTools(...names) {
  const window = {};
  const context = vm.createContext({ window });
  for (const name of names) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    vm.runInContext(source, context, { filename: name });
  }
  return window;
}

test("text formula tool owns and exposes its extraction algorithm", () => {
  const window = loadBrowserTools("text-formulas.js");
  const source = String.raw`Formula: $p(y|x)=\sum_z p(y|z,x)p(z|x)$`;
  assert.deepEqual(
    Array.from(window.PaperToolAlgorithms.extractFormulas(source)),
    [String.raw`p(y|x)=\sum_z p(y|z,x)p(z|x)`]
  );
  const tool = window.PaperToolDefinitions.textFormulas();
  assert.equal(tool.run({ text: source }).length, 1);
});

test("text formula tool does not treat author names as equations", () => {
  const window = loadBrowserTools("text-formulas.js");
  const source = String.raw`$$
, Yanlin Wang
$$
Formula: $L=L_{task}+L_{reg}$`;
  assert.deepEqual(
    Array.from(window.PaperToolAlgorithms.extractFormulas(source)),
    [String.raw`L=L_{task}+L_{reg}`]
  );
});

test("text figure tool owns markdown and source-reference extraction", () => {
  const window = loadBrowserTools("text-figures.js");
  const result = window.PaperToolAlgorithms.extractFigures([
    "![Architecture](figure-1.png)",
    "Figure 2: [Attention heads] Source: /api/arxiv/asset/id/figure-2.png"
  ].join("\n"));
  assert.equal(result.length, 2);
  assert.equal(result[0].source, "figure-1.png");
  assert.equal(result[1].name, "Attention heads");
});

test("browser registry plans only tools compatible with the input profile", () => {
  const window = loadBrowserTools(
    "tool-runtime.js", "pdf-parser.js", "text-formulas.js", "text-figures.js",
    "pdf-table-crop.js", "poster-interactions.js", "paper-tools.js"
  );
  const tools = window.createPaperBrowserTools({ waitForPdfJs: async () => ({}), setStatus: () => {} });
  assert.deepEqual(
    Array.from(tools.plan({ sourceType: "pdf" }, { stage: "preprocessing" }), (tool) => tool.name),
    ["text.formulas", "text.figures"]
  );
  assert.deepEqual(
    Array.from(tools.plan({ sourceType: "arxiv" }, { stage: "preprocessing" }), (tool) => tool.name),
    []
  );
});

test("poster interaction tool retrieves exact page-grounded evidence for missing section links", () => {
  const window = loadBrowserTools("poster-interactions.js");
  const source = [
    "## Page 2",
    "Standard text-only retrieval loses layout structure and non-textual evidence in visually rich documents.",
    "## Page 4",
    "VLD-RAG combines sparse lexical retrieval with dense visual retrieval using modality-consistent fusion."
  ].join("\n");
  const items = window.PaperToolAlgorithms.findPosterGroundedExcerpts(
    source,
    "The method combines sparse lexical retrieval and dense visual retrieval with modality-consistent fusion.",
    2
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].page, 4);
  assert.match(items[0].quote, /modality-consistent fusion/i);
  assert.equal(window.PaperToolDefinitions.posterInteractions().stage, "reporting");
});

test("poster interaction evidence relevance rejects a result quote for a method panel", () => {
  const window = loadBrowserTools("poster-interactions.js");
  const query = "The architecture routes requests through a planner, executor, and verifier.";
  const methodEvidence = { quote: "The planner decomposes each request before the executor and verifier process it." };
  const resultEvidence = { quote: "The system reaches 84.2 percent accuracy on the main benchmark." };
  assert.ok(window.PaperToolAlgorithms.posterEvidenceRelevance(methodEvidence, query) >= 0.2);
  assert.equal(window.PaperToolAlgorithms.posterEvidenceRelevance(resultEvidence, query), 0);
});

test("poster interaction method query ignores a trailing implementation aside", () => {
  const window = loadBrowserTools("poster-interactions.js");
  const query = window.PaperToolAlgorithms.posterCoreSectionQuery({
    method: "The framework coordinates a planner, executor, and verifier. The verifier returns failures to the planner for revision. Implementation prompts ask for pseudocode creation.",
    methodSupportsProblem: "The independent verifier reduces self-confirmation."
  }, { fields: ["method", "methodSupportsProblem"] });
  assert.match(query, /planner, executor, and verifier/i);
  assert.doesNotMatch(query, /pseudocode creation/i);
});

test("poster interaction rejects evidence with a merged section boundary", () => {
  const window = loadBrowserTools("poster-interactions.js");
  assert.equal(window.PaperToolAlgorithms.posterEvidenceHasMergedSection(
    "The approach reduces cost Introduction We next describe the architecture."
  ), true);
});

test("PDF parser detects arXiv identity from a file name or first-page text", () => {
  const window = loadBrowserTools("pdf-parser.js");
  assert.equal(window.PaperToolAlgorithms.detectArxivId("1706.03762v7.pdf", ""), "1706.03762v7");
  assert.equal(window.PaperToolAlgorithms.detectArxivId("paper.pdf", "Preprint arXiv: 2401.01234v2"), "2401.01234v2");
  assert.equal(window.PaperToolAlgorithms.detectArxivId("paper.pdf", "arXiv:hep-th/9901001v2"), "hep-th/9901001v2");
  assert.equal(window.PaperToolAlgorithms.detectArxivId("paper.pdf", "2v73650.2081:viXra"), "1802.05637v2");
});

test("PDF asset selection preserves a later mitigation figure instead of taking only the first pages", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const regions = Array.from({ length: 12 }, (_, index) => ({
    number: index + 1,
    caption: index === 11 ? "Hallucination mitigation before-and-after results" : `Example case ${index + 1}`
  }));
  const selected = Array.from(window.PaperToolAlgorithms.selectPdfAssetRegions(regions, 8, "figure"));
  assert.equal(selected.length, 8);
  assert.ok(selected.some((region) => region.number === 12));
});

test("PDF title extraction prefers metadata and joins wrapped first-page title lines", () => {
  const window = loadBrowserTools("pdf-parser.js");
  assert.equal(window.PaperToolAlgorithms.inferPdfTitle({ info: { Title: "Complete Metadata Title: With Subtitle" } }, [], "paper.pdf"), "Complete Metadata Title: With Subtitle");
  assert.equal(window.PaperToolAlgorithms.inferPdfTitle({ info: { Title: "Formatting Instructions for ICLR 2024 Conference Submissions" } }, [
    { text: "A Pair Programming Framework for Code Generation", y: 70, height: 22 },
    { text: "via Multi-Plan Exploration and Feedback", y: 96, height: 21 }
  ], "paper.pdf", { height: 792 }), "A Pair Programming Framework for Code Generation via Multi-Plan Exploration and Feedback");
  const inferred = window.PaperToolAlgorithms.inferPdfTitle({}, [
    { text: "Perceiver: General Perception", y: 80, height: 22 },
    { text: "with Iterative Attention", y: 106, height: 21 },
    { text: "Andrew Jaegle et al.", y: 145, height: 11 }
  ], "1706.00000.pdf", { height: 792 });
  assert.equal(inferred, "Perceiver: General Perception with Iterative Attention");
  assert.equal(window.PaperToolAlgorithms.inferPdfTitle({}, [
    { text: "Conditional Image Synthesis with Auxiliary Classifier GANs", y: 70, height: 22 },
    { text: "Abstract", y: 105, height: 21 }
  ], "paper.pdf", { height: 792 }), "Conditional Image Synthesis with Auxiliary Classifier GANs");
  assert.deepEqual(window.PaperToolAlgorithms.inferPdfTitleLines([
    { text: "Perceiver: General Perception", y: 80, height: 22 },
    { text: "with Iterative Attention", y: 106, height: 21 },
    { text: "Andrew Jaegle et al.", y: 145, height: 11 }
  ], { height: 792 }), ["Perceiver: General Perception", "with Iterative Attention"]);
  assert.deepEqual(window.PaperToolAlgorithms.inferPdfTitleLines([
    { text: "Conditional Image Synthesis with Auxiliary Classifier GANs", y: 70, height: 22 },
    { text: "Abstract", y: 105, height: 21 }
  ], { height: 792 }), ["Conditional Image Synthesis with Auxiliary Classifier GANs"]);
  assert.deepEqual(window.PaperToolAlgorithms.inferPdfTitleLines([
    { text: "Query: Which film did Ben Piazza appear in first?", y: 0, height: 9 },
    { text: "Query-Driven Multimodal GraphRAG: Dynamic Local Knowledge Graph", y: 71.3, height: 14.3 },
    { text: "Construction for Online Reasoning", y: 87.2, height: 14.3 },
    { text: "ChenyangBu, GuojieChang, ZihaoChen, CunyuanDang", y: 109.5, height: 12 },
    { text: "ZhizeWu YiHe XindongWu", y: 123.6, height: 12 },
    { text: "School of Computer Science and Information Engineering", y: 150.7, height: 12 }
  ], { height: 792 }), [
    "Query-Driven Multimodal GraphRAG: Dynamic Local Knowledge Graph",
    "Construction for Online Reasoning"
  ]);
  assert.equal(window.PaperToolAlgorithms.inferPdfTitle({}, [
    { text: "Query-Driven Multimodal GraphRAG: Dynamic Local Knowledge Graph", y: 71.3, height: 14.3 },
    { text: "Construction for Online Reasoning", y: 87.2, height: 14.3 },
    { text: "ChenyangBu, GuojieChang, ZihaoChen, CunyuanDang", y: 109.5, height: 12 }
  ], "2025.findings-acl.1100.pdf", { height: 792 }), "Query-Driven Multimodal GraphRAG: Dynamic Local Knowledge Graph Construction for Online Reasoning");
});

test("PDF identity extraction canonicalizes DOI links and falls back to arXiv", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const doiIdentity = window.PaperToolAlgorithms.detectPaperUrl(
    "ACM DOI https://doi.org/10.1145/3690407.3690479.", ""
  );
  assert.equal(doiIdentity.doi, "10.1145/3690407.3690479");
  assert.equal(doiIdentity.paperUrl, "https://doi.org/10.1145/3690407.3690479");
  const arxivIdentity = window.PaperToolAlgorithms.detectPaperUrl("No DOI", "1706.03762v7");
  assert.equal(arxivIdentity.doi, "");
  assert.equal(arxivIdentity.paperUrl, "https://arxiv.org/abs/1706.03762v7");
  const templateIdentity = window.PaperToolAlgorithms.detectPaperUrl(
    "ACM template DOI https://doi.org/10.1145/nnnnnnn.nnnnnnn", "2501.07811v1"
  );
  assert.equal(templateIdentity.doi, "");
  assert.equal(templateIdentity.paperUrl, "https://arxiv.org/abs/2501.07811v1");
});

test("PDF page regions expose a stable figure and table page map", () => {
  const window = loadBrowserTools("pdf-parser.js");
  assert.deepEqual(JSON.parse(JSON.stringify(window.PaperToolAlgorithms.buildPdfAssetPageMap({
    figures: [{ number: "2", pageNumber: 4, caption: "Framework overview." }],
    tables: [{ number: "2", pageNumber: 12, caption: "Main results." }, { number: "3", pageNumber: 12, caption: "Ablation results." }]
  }))), {
    figures: { 2: 4 },
    tables: { 2: 12, 3: 12 },
    figureCaptions: { 2: "Framework overview." },
    tableCaptions: { 2: "Main results.", 3: "Ablation results." }
  });
});

test("PDF identity ignores DOI and arXiv identifiers found only in later references", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const identity = window.PaperToolAlgorithms.detectPrimaryPaperIdentity({
    metadataText: '{"Title":"A New Paper"}',
    fileName: "new-paper.pdf",
    firstPageText: "A New Paper has no public identifier on its first page."
  });
  assert.deepEqual(JSON.parse(JSON.stringify(identity)), { arxivId: "", doi: "", paperUrl: "" });
  const withPrimaryDoi = window.PaperToolAlgorithms.detectPrimaryPaperIdentity({
    metadataText: "",
    fileName: "new-paper.pdf",
    firstPageText: "Published as https://doi.org/10.1145/3690407.3690479"
  });
  assert.equal(withPrimaryDoi.paperUrl, "https://doi.org/10.1145/3690407.3690479");
});

test("PDF text grouping rejoins adjacent small-caps font runs inside title words", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] };
  const lines = window.PaperToolAlgorithms.groupPdfTextItems([
    { str: "C", transform: [1, 0, 0, 1, 80, 700], width: 9, height: 18 },
    { str: "GAN", transform: [1, 0, 0, 1, 89.4, 700], width: 35, height: 18 },
    { str: "S", transform: [1, 0, 0, 1, 124.8, 700], width: 9, height: 18 },
    { str: "WITH", transform: [1, 0, 0, 1, 144, 700], width: 48, height: 18 },
    { str: "P", transform: [1, 0, 0, 1, 205, 700], width: 9, height: 18 },
    { str: "ROJECTION", transform: [1, 0, 0, 1, 214.4, 700], width: 92, height: 18 },
    { str: "D", transform: [1, 0, 0, 1, 319, 700], width: 10, height: 18 },
    { str: "ISCRIMINATOR", transform: [1, 0, 0, 1, 329.4, 700], width: 126, height: 18 }
  ], viewport);
  assert.equal(lines[0].text, "CGANS WITH PROJECTION DISCRIMINATOR");
});

test("PDF parser classifies caption and formula lines as crop regions", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "Attention(Q, K, V) = softmax(QK^T / sqrt(d_k))V (1)", x: 120, y: 300, width: 370, height: 12 },
    { text: "Figure 1: The Transformer model architecture.", x: 70, y: 610, width: 450, height: 11 },
    { text: "Table 2: Results on English constituency parsing.", x: 70, y: 80, width: 450, height: 11 },
    { text: "Model F1 Params", x: 90, y: 105, width: 220, height: 10, items: [
      { text: "Model", x: 90, width: 45 }, { text: "F1", x: 200, width: 20 }, { text: "Params", x: 270, width: 40 }
    ] },
    { text: "Parser 92.1 65M", x: 90, y: 123, width: 220, height: 10, items: [
      { text: "Parser", x: 90, width: 45 }, { text: "92.1", x: 200, width: 28 }, { text: "65M", x: 270, width: 25 }
    ] }
  ], { width: 612, height: 792 }, 3);
  assert.equal(regions.formulas.length, 1);
  assert.equal(regions.figures[0].number, "1");
  assert.equal(regions.tables[0].number, "2");
  assert.equal(regions.figures[0].pageNumber, 3);
});

test("PDF parser rejects a table caption when nearby content has no table structure", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "Table 2: Samples of generated tags.", x: 320, y: 210, width: 240, height: 10, items: [{}] },
    { text: "But by using multiple tags at once we hope to achieve a useful representation.", x: 320, y: 235, width: 240, height: 10, items: [{}] },
    { text: "We would like to thank the developers and reviewers for helpful discussion.", x: 320, y: 270, width: 240, height: 10, items: [{}] },
    { text: "Better mixing via deep representations.", x: 320, y: 320, width: 210, height: 10, items: [{}] }
  ], { width: 612, height: 792 }, 7);
  assert.equal(regions.tables.length, 0);
});

test("PDF parser accepts a nonnumeric table with three aligned text rows", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const cellRow = (left, right, y) => ({
    text: `${left} ${right}`, x: 55, y, width: 230, height: 10,
    items: [{ text: left, x: 55, width: 75 }, { text: right, x: 190, width: 95 }]
  });
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "Table 2: Samples of generated tags.", x: 55, y: 100, width: 230, height: 10, items: [{}] },
    cellRow("Image", "Generated tags", 126),
    cellRow("Beach", "water sand", 145),
    cellRow("City", "road building", 164)
  ], { width: 612, height: 792 }, 4);
  assert.equal(regions.tables.length, 1);
});

test("PDF parser separates two-column captions and confines crops to their column", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] };
  const lines = window.PaperToolAlgorithms.groupPdfTextItems([
    { str: "Table 2: Translation results.", transform: [1, 0, 0, 1, 42, 672], width: 252, height: 10 },
    { str: "Table 3: Parsing results.", transform: [1, 0, 0, 1, 312, 672], width: 238, height: 10 },
    { str: "Model  BLEU  Cost", transform: [1, 0, 0, 1, 48, 647], width: 178, height: 10 },
    { str: "Layer  F1  Params", transform: [1, 0, 0, 1, 351, 647], width: 172, height: 10 },
    { str: "Base  28.4  1.0", transform: [1, 0, 0, 1, 48, 627], width: 166, height: 10 },
    { str: "Large  92.1  65M", transform: [1, 0, 0, 1, 351, 627], width: 170, height: 10 }
  ], viewport);

  assert.equal(lines.filter((line) => /^Table/.test(line.text)).length, 2);
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions(lines, viewport, 4);
  assert.equal(regions.tables.length, 2);
  assert.ok(regions.tables[0].x + regions.tables[0].width < viewport.width / 2);
  assert.ok(regions.tables[1].x > viewport.width / 2);
});

test("PDF parser orders a two-column page by column instead of interleaving rows", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const lines = [
    { text: "Paper title", x: 150, y: 20, width: 310, height: 12 },
    { text: "Left first.", x: 42, y: 100, width: 220, height: 10 },
    { text: "Right first.", x: 325, y: 100, width: 220, height: 10 },
    { text: "Left second.", x: 42, y: 120, width: 220, height: 10 },
    { text: "Right second.", x: 325, y: 120, width: 220, height: 10 },
    { text: "Left third.", x: 42, y: 140, width: 220, height: 10 },
    { text: "Right third.", x: 325, y: 140, width: 220, height: 10 },
    { text: "Left fourth.", x: 42, y: 160, width: 220, height: 10 },
    { text: "Right fourth.", x: 325, y: 160, width: 220, height: 10 }
  ];
  const ordered = window.PaperToolAlgorithms.orderPdfLinesForReading(lines, { width: 612, height: 792 });
  assert.deepEqual(Array.from(ordered, (line) => line.text), [
    "Paper title", "Left first.", "Left second.", "Left third.", "Left fourth.",
    "Right first.", "Right second.", "Right third.", "Right fourth."
  ]);
});

test("PDF parser rejects body references and prose-like equals lines as visual assets", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "Figure 2 presents an overview of this survey.", x: 42, y: 130, width: 245, height: 10, items: [{}] },
    { text: "Table 3 compares the methods discussed below.", x: 320, y: 160, width: 230, height: 10, items: [{}] },
    { text: "The transmittance T(t) = O + td is formulated as a sigmoid function while the grids use three planes", x: 42, y: 210, width: 510, height: 10, items: [{}, {}] }
  ], viewport, 5);
  assert.equal(regions.figures.length, 0);
  assert.equal(regions.tables.length, 0);
  assert.equal(regions.formulas.length, 0);
});

test("PDF parser only crops numbered standalone equations", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "x = y + z", x: 80, y: 120, width: 100, height: 10, items: [{}] },
    { text: "w_i = exp(s_i) / sum_j exp(s_j) (4)", x: 80, y: 160, width: 210, height: 10, items: [{}] }
  ], viewport, 2);
  assert.equal(regions.formulas.length, 1);
  assert.equal(regions.formulas[0].equationNumber, "4");
});

test("PDF parser recovers an unnumbered core marginalization formula after a formal introduction", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "We treat the retrieved document as a latent variable and marginalize it to define the probability.", x: 42, y: 120, width: 245, height: 10, items: [{}] },
    { text: "p_RAG-Sequence(y|x) ≈ sum_z p_eta(z|x) p_theta(y|x,z)", x: 65, y: 152, width: 220, height: 11, items: [{}] },
    { text: "The generator then produces the complete sequence.", x: 42, y: 181, width: 235, height: 10, items: [{}] }
  ], viewport, 3);
  assert.equal(regions.formulas.length, 1);
  assert.equal(regions.formulas[0].equationNumber, "");
  assert.equal(regions.formulas[0].confidence, "core-unnumbered-equation");
  assert.ok(regions.formulas[0].y + regions.formulas[0].height < 181);
});

test("PDF parser joins an equation body with a separately positioned number", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "w_i = exp(s_i) / sum_j exp(s_j)", x: 55, y: 160, width: 195, height: 10, items: [{}] },
    { text: "(4)", x: 270, y: 160, width: 16, height: 10, items: [{}] }
  ], { width: 612, height: 792 }, 2);
  assert.equal(regions.formulas.length, 1);
  assert.match(regions.formulas[0].caption, /w_i.*\(4\)/);
});

test("PDF parser gives a centered numbered equation a tight content width", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "f(x,y) = y^T V phi(x) + psi(phi(x))", x: 140, y: 160, width: 330, height: 12, items: [{}] },
    { text: "(3)", x: 520, y: 160, width: 18, height: 12, items: [{}] }
  ], { width: 612, height: 792 }, 3);
  assert.equal(regions.formulas.length, 1);
  assert.ok(regions.formulas[0].x > 120);
  assert.ok(regions.formulas[0].width < 430);
  assert.ok(regions.formulas[0].x + regions.formulas[0].width >= 538);
});

test("PDF parser keeps a long method-defining projection equation", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "f(x,y;theta) := f_1(x,y;theta) + f_2(x;theta) = y^T V phi(x;theta) + psi(phi(x;theta))", x: 42, y: 160, width: 515, height: 12, items: [{}] },
    { text: "(3)", x: 570, y: 160, width: 18, height: 12, items: [{}] }
  ], { width: 612, height: 792 }, 3);
  assert.equal(regions.formulas.length, 1);
  assert.equal(regions.formulas[0].equationNumber, "3");
});

test("PDF parser does not pull a left-column heading into a right-side equation", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions([
    { text: "3.1. Adversarial Loss", x: 42, y: 164, width: 145, height: 13, items: [{}] },
    { text: "G*, F* = arg min max L(G, F, D_X, D_Y)", x: 335, y: 164, width: 215, height: 13, items: [{}] },
    { text: "(4)", x: 570, y: 164, width: 18, height: 13, items: [{}] }
  ], { width: 612, height: 792 }, 4);
  assert.equal(regions.formulas.length, 1);
  assert.ok(regions.formulas[0].x > 300);
  assert.ok(regions.formulas[0].width < 290);
});

test("PDF table region expands across both columns when rows span the gutter", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "Table 2: Reconstruction results.", x: 60, y: 100, width: 240, height: 10, items: [{}] },
    { text: "Method  IoU  0.61", x: 45, y: 130, width: 220, height: 10, items: [
      { text: "Method", x: 45, width: 45 }, { text: "IoU", x: 145, width: 20 }, { text: "0.61", x: 225, width: 25 }
    ] },
    { text: "Category  IoU  0.64", x: 330, y: 130, width: 220, height: 10, items: [
      { text: "Category", x: 330, width: 55 }, { text: "IoU", x: 430, width: 20 }, { text: "0.64", x: 510, width: 25 }
    ] },
    { text: "Baseline  IoU  0.55", x: 45, y: 150, width: 220, height: 10, items: [
      { text: "Baseline", x: 45, width: 50 }, { text: "IoU", x: 145, width: 20 }, { text: "0.55", x: 225, width: 25 }
    ] },
    { text: "Pix2Vox  IoU  0.68", x: 330, y: 150, width: 220, height: 10, items: [
      { text: "Pix2Vox", x: 330, width: 50 }, { text: "IoU", x: 430, width: 20 }, { text: "0.68", x: 510, width: 25 }
    ] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 0, "table", viewport);
  assert.ok(region.width > viewport.width * 0.85);
});

test("PDF table above its caption keeps both sides and excludes the caption", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const row = (left, middle, right, y) => [
    { text: left, x: 28, y, width: 205, height: 11, items: [{ text: left, x: 28, width: 205 }] },
    { text: middle, x: 275, y, width: 105, height: 11, items: [{ text: middle, x: 275, width: 105 }] },
    { text: right, x: 445, y, width: 125, height: 11, items: [{ text: right, x: 445, width: 125 }] }
  ];
  const lines = [
    ...row("Method", "Map to Photo", "Photo to Map", 190),
    ...row("CoGAN", "0.6% +/- 0.5%", "0.9% +/- 0.5%", 211),
    ...row("CycleGAN (ours)", "26.8% +/- 2.8%", "23.2% +/- 3.4%", 232),
    { text: "Table 1: AMT real vs fake test on maps and aerial photos.", x: 42, y: 252, width: 360, height: 11, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 9, "table", viewport);
  assert.ok(region.x < 35);
  assert.ok(region.x + region.width > 565);
  assert.ok(region.y + region.height < 252);
});

test("PDF formula region stops before the following prose line", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "l = sum_i p_i log(q_i)", x: 55, y: 160, width: 195, height: 12, items: [{}] },
    { text: "(3)", x: 270, y: 160, width: 16, height: 12, items: [{}] },
    { text: "where N denotes the number of voxels in the ground truth.", x: 55, y: 180, width: 230, height: 10, items: [{}] }
  ];
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions(lines, viewport, 2);
  assert.equal(regions.formulas.length, 1);
  assert.ok(regions.formulas[0].y + regions.formulas[0].height < 180);
});

test("PDF formula region includes vertically separated numerator and denominator", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "exp(m_r)", x: 145, y: 146, width: 58, height: 9, items: [{}] },
    { text: "s_r =", x: 72, y: 160, width: 55, height: 11, items: [{}] },
    { text: "(1)", x: 274, y: 160, width: 16, height: 11, items: [{}] },
    { text: "sum_p exp(m_p)", x: 130, y: 175, width: 92, height: 10, items: [{}] },
    { text: "where n represents the number of views.", x: 55, y: 198, width: 220, height: 10, items: [{}] }
  ];
  const regions = window.PaperToolAlgorithms.detectPdfPageRegions(lines, viewport, 4);
  assert.equal(regions.formulas.length, 1);
  assert.ok(regions.formulas[0].y <= 146);
  assert.ok(regions.formulas[0].y + regions.formulas[0].height >= 185);
  assert.ok(regions.formulas[0].y + regions.formulas[0].height <= 185);
});

test("PDF table crop ends before prose following the table", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "Table 2: Quantitative comparison.", x: 42, y: 100, width: 245, height: 10, items: [{}] },
    { text: "Method Chamfer Distance Volume IoU", x: 48, y: 126, width: 225, height: 10, items: [{}, {}, {}, {}] },
    { text: "RealFusion 0.0819 0.2741", x: 48, y: 146, width: 210, height: 10, items: [{}, {}, {}] },
    { text: "Baseline 0.1092 0.2310", x: 48, y: 161, width: 210, height: 10, items: [{}, {}, {}] },
    { text: "The following methods optimize a volumetric representation and then continue with extensive discussion.", x: 48, y: 178, width: 235, height: 10, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 0, "table", viewport);
  assert.ok(region.y + region.height < 178);
});

test("PDF table crop excludes a numeric caption continuation above the header", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const cell = (text, x, y, width = 48) => ({ text, x, y, width, height: 10, items: [{ text, x, width }] });
  const lines = [
    { text: "Table 1. Retrieval performance across top-K settings measured in percentage.", x: 45, y: 100, width: 520, height: 10, items: [{}] },
    { text: "MoLoRAG is stronger at K = 3 and K = 5, whereas VLD-RAG improves evidence page coverage.", x: 45, y: 114, width: 520, height: 10, items: [{}] },
    cell("Top-K", 70, 145), cell("Method", 150, 145), cell("Recall", 330, 145), cell("NDCG", 430, 145),
    cell("1", 70, 164), cell("VLD-RAG", 150, 164, 80), cell("48.92", 330, 164), cell("64.52", 430, 164),
    cell("3", 70, 182), cell("VLD-RAG", 150, 182, 80), cell("70.16", 330, 182), cell("68.83", 430, 182)
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 0, "table", viewport);
  assert.ok(region.y > 125);
  assert.ok(region.y <= 145);
});

test("PDF table crop keeps a segmented header and stops before split two-column prose", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const cell = (text, x, y, width = 42) => ({ text, x, y, width, height: 9, items: [{ text, x, width }] });
  const lines = [
    cell("Baseline", 50, 260), cell("0.560", 190, 260), cell("0.640", 330, 260),
    { text: "Table 2: Multi-view reconstruction on ShapeNet compared using IoU. The best results for different", x: 42, y: 300, width: 520, height: 10, items: [{}] },
    { text: "numbers of views are highlighted in bold.", x: 42, y: 313, width: 260, height: 10, items: [{}] },
    cell("Methods", 45, 336, 55), cell("1 view", 150, 336), cell("2 views", 230, 336), cell("3 views", 310, 336),
    cell("3D-R2N2", 45, 354, 55), cell("0.560", 150, 354), cell("0.603", 230, 354), cell("0.617", 310, 354),
    cell("Pix2Vox-A", 45, 372, 65), cell("0.661", 150, 372), cell("0.686", 230, 372), cell("0.693", 310, 372),
    { text: "3.2.5", x: 45, y: 405, width: 30, height: 11, items: [{}] },
    { text: "Loss Function", x: 82, y: 405, width: 85, height: 11, items: [{}] },
    { text: "ShapeNet dataset and real images from the Pix3D dataset.", x: 330, y: 405, width: 230, height: 10, items: [{}] },
    { text: "The loss function of the network is defined as the mean value of voxel-wise binary cross entropies.", x: 45, y: 424, width: 240, height: 10, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 3, "table", viewport);
  assert.ok(region.y <= 336);
  assert.ok(region.y + region.height <= 388);
});

test("PDF table crop selects a compact two-cell table above a long caption", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const row = (label, value, y) => [
    { text: label, x: 330, y, width: 150, height: 10, items: [{ text: label, x: 330, width: 150 }] },
    { text: value, x: 520, y, width: 28, height: 10, items: [{ text: value, x: 520, width: 28 }] }
  ];
  const lines = [
    ...row("ResNet-50", "77.6", 170),
    ...row("ViT-B-16", "77.9", 187),
    ...row("Perceiver (FF)", "78.0", 204),
    { text: "Table 1: Top-1 validation accuracy (in %) on ImageNet. Models", x: 320, y: 230, width: 245, height: 10, items: [{}] },
    { text: "that use 2D convolutions exploit domain-specific grid structure", x: 320, y: 243, width: 245, height: 10, items: [{}] },
    { text: "architecturally, while models that only use global attention do not.", x: 320, y: 256, width: 245, height: 10, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 6, "table", viewport);
  assert.ok(region.y <= 159);
  assert.ok(region.y + region.height < 225);
  assert.ok(region.x >= 300);
});

test("PDF inline math extraction preserves complexity expressions without cropping prose", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const formulas = window.PaperToolAlgorithms.extractPdfInlineMath([
    { text: "A byte Transformer has complexity O(LM2) while the latent model has O(LN2)." },
    { text: "The resulting architecture has complexity O(MN + LN2), independent of input depth." }
  ]);
  assert.deepEqual(Array.from(formulas), ["O(LM^{2})", "O(LN^{2})", "O(MN + LN^{2})"]);
});

test("vision crop refinement converts a normalized context box back to PDF coordinates", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const region = { kind: "table", x: 100, y: 120, width: 200, height: 100 };
  const context = { x: 60, y: 70, width: 300, height: 200 };
  const refined = window.PaperToolAlgorithms.applyVisionCropBox(region, context, {
    left: 0.1, top: 0.15, right: 0.9, bottom: 0.82
  });
  assert.equal(refined.x, 90);
  assert.equal(refined.y, 100);
  assert.equal(refined.width, 240);
  assert.equal(refined.height, 134);
});

test("vision crop context gives figures enough surrounding page area to recover clipped sides", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const context = window.PaperToolAlgorithms.computeVisionCropContextBounds(
    612,
    792,
    { kind: "figure", x: 306, y: 200, width: 250, height: 300 }
  );
  assert.ok(context.x < 234);
  assert.ok(context.right > 556);
});

test("vision crop context gives a misclassified table nearly the full page width", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const context = window.PaperToolAlgorithms.computeVisionCropContextBounds(
    612,
    792,
    { kind: "table", x: 320, y: 180, width: 230, height: 90 }
  );
  assert.ok(context.x < 30);
  assert.equal(context.right, 612);
});

test("PDF asset geometry recovery expands an implausibly thin CodeCoT-style figure strip", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const region = window.PaperToolAlgorithms.stabilizePdfAssetRegion(
    { kind: "figure", x: 30, y: 260, width: 552, height: 48 },
    { width: 612, height: 792 },
    "figure"
  );
  assert.ok(region.height >= 100);
  assert.ok(region.width / region.height < 7.5);
  assert.equal(region.y + region.height, 308);
});

test("PDF asset geometry recovery leaves a plausible complete table unchanged", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const original = { kind: "table", x: 80, y: 140, width: 450, height: 180 };
  const region = window.PaperToolAlgorithms.stabilizePdfAssetRegion(
    original,
    { width: 612, height: 792 },
    "table"
  );
  assert.deepEqual(region, original);
});

test("edge repair expands only the sides reported as clipped", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const region = window.PaperToolAlgorithms.expandRegionAtEdges(
    { kind: "table", x: 100, y: 120, width: 300, height: 140 },
    ["top", "bottom"],
    612,
    792
  );
  assert.equal(region.x, 100);
  assert.equal(region.width, 300);
  assert.ok(region.y < 120);
  assert.ok(region.y + region.height > 260);
});

test("PDF artwork keeps the complete deterministic crop when a vision refinement is incomplete", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const refined = { complete: false, clippedEdges: ["right"], url: "vision" };
  const original = { complete: true, clippedEdges: [], url: "caption-aware" };
  const selected = window.PaperToolAlgorithms.preferCompletePdfCrop(refined, original);
  assert.equal(selected.crop.url, "caption-aware");
  assert.equal(selected.usedFallback, true);
});

test("PDF artwork retains a complete vision refinement when it passes validation", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const refined = { complete: true, clippedEdges: [], url: "vision" };
  const original = { complete: true, clippedEdges: [], url: "caption-aware" };
  const selected = window.PaperToolAlgorithms.preferCompletePdfCrop(refined, original);
  assert.equal(selected.crop.url, "vision");
  assert.equal(selected.usedFallback, false);
});

test("vision crop quality gate rejects a table candidate that loses rows", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const original = { kind: "table", x: 100, y: 100, width: 400, height: 240 };
  const incomplete = { kind: "table", x: 100, y: 100, width: 400, height: 110 };
  assert.equal(window.PaperToolAlgorithms.isSafeVisionRefinement(original, incomplete, {
    applied: true, complete: true, clippedEdges: []
  }), false);
});

test("vision crop quality gate accepts a complete conservative table refinement", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const original = { kind: "table", x: 100, y: 100, width: 400, height: 240 };
  const refined = { kind: "table", x: 105, y: 103, width: 390, height: 230 };
  assert.equal(window.PaperToolAlgorithms.isSafeVisionRefinement(original, refined, {
    applied: true, complete: true, clippedEdges: []
  }), true);
});

test("vision crop quality gate allows a complete table to shed neighboring vertical prose", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const original = { kind: "table", x: 100, y: 100, width: 400, height: 240 };
  const refined = { kind: "table", x: 105, y: 128, width: 390, height: 135 };
  assert.equal(window.PaperToolAlgorithms.isSafeVisionRefinement(original, refined, {
    applied: true, complete: true, clippedEdges: []
  }), true);
});

test("PDF figure crop excludes page headers and its own caption", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "Authors / Paper title", x: 90, y: 22, width: 200, height: 9, items: [{}] },
    { text: "Figure 2: Method overview.", x: 42, y: 330, width: 245, height: 11, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 1, "figure", viewport);
  assert.ok(region.y > 31);
  assert.ok(region.y + region.height <= 313);
});

test("PDF figure crop treats a centered cross-column caption as full-width artwork", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "Figure 9: Super-resolution by different methods", x: 174, y: 285, width: 265, height: 11, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 0, "figure", viewport);
  assert.ok(region.x < 30);
  assert.ok(region.width > 560);
});

test("PDF figure crop ignores prose-like text embedded inside a wide workflow diagram", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "CodeCoT: Tackling Code Syntax Errors", x: 165, y: 44, width: 290, height: 9, items: [{}] },
    { text: "Return a sorted list of unique elements from the input list.", x: 55, y: 128, width: 230, height: 8, items: [{}] },
    { text: "Generate test cases for the given code.", x: 320, y: 145, width: 170, height: 8, items: [{}] },
    { text: "Figure 2: CodeCoT's workflow with four components.", x: 48, y: 245, width: 500, height: 11, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 3, "figure", viewport);
  assert.ok(region.y <= 75);
  assert.ok(region.height >= 150);
  assert.ok(region.y + region.height < 245);
});

test("PDF figure crop starts below the preceding figure caption", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "Figure 1: Discriminator models for conditional GANs", x: 150, y: 205, width: 315, height: 11, items: [{}] },
    { text: "continued caption text for the first figure.", x: 150, y: 219, width: 260, height: 10, items: [{}] },
    { text: "Figure 2: Generated examples and category morphing.", x: 135, y: 455, width: 340, height: 11, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 2, "figure", viewport);
  assert.ok(region.y > 229);
  assert.ok(region.y + region.height < 455);
});

test("PDF figure crop starts below a preceding table instead of including it", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "Table 2: Main pass@1 comparison.", x: 42, y: 90, width: 250, height: 11, items: [{}] },
    { text: "Approaches HumanEval MBPP CodeContest", x: 70, y: 125, width: 360, height: 10, items: [{}] },
    { text: "Direct prompting 67.68 66.80 6.06", x: 70, y: 143, width: 330, height: 10, items: [{}] },
    { text: "PairCoder 87.80 80.60 15.15", x: 70, y: 161, width: 300, height: 10, items: [{}] },
    { text: "Figure 9: Accuracy changes with the maximum number of iterations.", x: 80, y: 390, width: 440, height: 11, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 4, "figure", viewport);
  assert.ok(region.y > 171);
  assert.ok(region.y + region.height < 390);
});

test("PDF parser joins a wrapped caption without swallowing later body prose", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const lines = [
    { text: "Table 2: Inception accuracy and MS-SSIM on different methods. We picked up", x: 42, y: 100, width: 420, height: 10, items: [{}] },
    { text: "the checkpoint with the best validation score.", x: 42, y: 113, width: 285, height: 10, items: [{}] },
    { text: "The projection model is evaluated below in a separate experiment.", x: 42, y: 145, width: 340, height: 10, items: [{}] }
  ];
  const caption = window.PaperToolAlgorithms.collectPdfCaption(lines, 0, { width: 612, height: 792 });
  assert.match(caption.text, /best validation score\.$/);
  assert.doesNotMatch(caption.text, /separate experiment/);
});

test("PDF parser does not stop a wrapped caption at the w.r.t. abbreviation", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const lines = [
    { text: "Figure 4: Relative NDCG@5 performance gain w.r.t.", x: 315, y: 100, width: 250, height: 10, items: [{}] },
    { text: "An unrelated sentence in the left column ends here.", x: 35, y: 108, width: 240, height: 10, items: [{}] },
    { text: "the default ColPali (1024 patches). TabFQuAD fine-", x: 315, y: 113, width: 260, height: 10, items: [{}] },
    { text: "tuning measures the performance difference on the task.", x: 315, y: 126, width: 270, height: 10, items: [{}] },
    { text: "Further analysis begins in the next paragraph.", x: 315, y: 160, width: 245, height: 10, items: [{}] }
  ];
  const caption = window.PaperToolAlgorithms.collectPdfCaption(lines, 0, { width: 612, height: 792 });
  assert.match(caption.text, /default ColPali \(1024 patches\)/);
  assert.match(caption.text, /TabFQuAD finetuning measures/);
  assert.doesNotMatch(caption.text, /Further analysis/);
  assert.doesNotMatch(caption.text, /unrelated sentence/);
});

test("PDF parser stops a wide caption before following single-column prose", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const lines = [
    { text: "Figure 1: Pipeline of AgentCoder with a code generation example from HumanEval", x: 75, y: 310, width: 462, height: 11, items: [{}] },
    { text: "to non-code generation tasks, AgentCoder addresses unique challenges in software development.", x: 36, y: 324, width: 246, height: 10, items: [{}] }
  ];
  const caption = window.PaperToolAlgorithms.collectPdfCaption(lines, 0, { width: 612, height: 792 });
  assert.equal(caption.text, "Pipeline of AgentCoder with a code generation example from HumanEval");
});

test("PDF parser treats a moderately wide centered caption as cross-column", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const lines = [
    { text: "Figure 1: Overview of the complete framework", x: 148, y: 310, width: 316, height: 11, items: [{}] },
    { text: "The next section discusses implementation details and training choices.", x: 36, y: 324, width: 246, height: 10, items: [{}] }
  ];
  const caption = window.PaperToolAlgorithms.collectPdfCaption(lines, 0, { width: 612, height: 792 });
  assert.equal(caption.text, "Overview of the complete framework");
});

test("PDF table crop keeps column headers and a compact group label above data rows", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "Table 1: End-to-end results of AgentCoder and baseline approaches.", x: 36, y: 72, width: 420, height: 10, items: [{}] },
    { text: "Models HumanEval HumanEval-ET MBPP MBPP-ET Mean", x: 38, y: 132, width: 530, height: 10, items: [
      { text: "Models", x: 38, width: 70 }, { text: "HumanEval", x: 210, width: 70 }, { text: "HumanEval-ET", x: 300, width: 90 }, { text: "MBPP", x: 420, width: 45 }, { text: "MBPP-ET", x: 480, width: 60 }, { text: "Mean", x: 550, width: 35 }
    ] },
    { text: "Zero-Shot LLMs", x: 38, y: 145, width: 110, height: 10, items: [{}] },
    { text: "AlphaCode 17.1 - - - 17.1", x: 38, y: 158, width: 530, height: 10, items: [
      { text: "AlphaCode", x: 38, width: 80 }, { text: "17.1", x: 220, width: 28 }, { text: "-", x: 330, width: 8 }, { text: "-", x: 430, width: 8 }, { text: "-", x: 500, width: 8 }, { text: "17.1", x: 550, width: 28 }
    ] },
    { text: "Incoder 15.2 11.6 17.6 14.3 14.7", x: 38, y: 170, width: 530, height: 10, items: [
      { text: "Incoder", x: 38, width: 70 }, { text: "15.2", x: 220, width: 28 }, { text: "11.6", x: 330, width: 28 }, { text: "17.6", x: 430, width: 28 }, { text: "14.3", x: 500, width: 28 }, { text: "14.7", x: 550, width: 28 }
    ] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 0, "table", viewport);
  assert.ok(region.y <= 122);
});

test("PDF figure crop does not treat code inside a full-page comparison as body prose", () => {
  const window = loadBrowserTools("pdf-parser.js");
  const viewport = { width: 612, height: 792 };
  const lines = [
    { text: "HumanEval Task 1 Code Generation", x: 135, y: 190, width: 260, height: 10, items: [{}] },
    { text: "def has_close_elements(numbers, threshold):", x: 135, y: 220, width: 260, height: 10, items: [{}] },
    { text: "Check if in given list of numbers, are any two numbers closer than the threshold.", x: 135, y: 245, width: 330, height: 10, items: [{}] },
    { text: ">>> has_close_elements([1.0, 2.0], 0.5)", x: 135, y: 260, width: 300, height: 10, items: [{}] },
    { text: "for i in range(len(numbers)):", x: 135, y: 320, width: 220, height: 10, items: [{}] },
    { text: "return False", x: 165, y: 350, width: 80, height: 10, items: [{}] },
    { text: "Figure 2: A case illustration of CodeCoT and AgentCoder generated code.", x: 90, y: 650, width: 430, height: 11, items: [{}] }
  ];
  const region = window.PaperToolAlgorithms.computePdfVisualRegion(lines, 6, "figure", viewport);
  assert.ok(region.y <= 195);
});
