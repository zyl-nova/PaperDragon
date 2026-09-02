const test = require("node:test");
const assert = require("node:assert/strict");
const viewer = require("./poster-evidence-viewer");

test("extracts PDF page numbers from common evidence locations", () => {
  assert.equal(viewer.pageFromLocation("Uploaded PDF, page 8"), 8);
  assert.equal(viewer.pageFromLocation("Results, p. 12"), 12);
  assert.equal(viewer.pageFromLocation("Method section"), null);
});

test("maps result claims to result and experiment evidence without duplicates", () => {
  const shared = { quote: "Accuracy improves by 12%.", location: "Page 8" };
  const items = viewer.evidenceForSection({
    results: [shared],
    experiments: [shared, { quote: "Ablation removes memory.", location: "page 9" }]
  }, "results");
  assert.deepEqual(items, [
    { quote: "Accuracy improves by 12%.", location: "Page 8", page: 8 },
    { quote: "Ablation removes memory.", location: "page 9", page: 9 }
  ]);
});

test("filters isolated fragments and DOI leakage before annotating a poster", () => {
  const items = viewer.evidenceForSection({
    method: [
      { quote: "V.", location: "Section V" },
      { quote: "2.", location: "Page 4" },
      { quote: "Test cases.", location: "Page 3" },
      { quote: "org/10.1145/3690407.3690479 The method checks optimized code.", location: "Introduction, page 1" }
    ]
  }, "method");
  assert.deepEqual(items, [{
    quote: "The method checks optimized code.",
    location: "Introduction, page 1",
    page: 1
  }]);
});

test("filters evidence sentences containing obvious PDF word fragments", () => {
  const items = viewer.evidenceForSection({
    method: [
      { quote: "Figure 2 provides the pipeline, divided into four tion, Code Generation, and Self-Examination.", location: "Method, page 4" },
      { quote: "The four-stage pipeline contains prompting, test generation, code generation, and self-examination.", location: "Method, page 4" }
    ]
  }, "method");
  assert.deepEqual(items, [{
    quote: "The four-stage pipeline contains prompting, test generation, code generation, and self-examination.",
    location: "Method, page 4",
    page: 4
  }]);
});

test("filters evidence that merges the end of one section into the next heading", () => {
  const items = viewer.evidenceForSection({
    problem: [{
      quote: "The approach reduces inference cost Introduction We next present the architecture.",
      location: "Abstract, page 1"
    }]
  }, "problem");
  assert.deepEqual(items, []);
});

test("standalone viewer includes source, copy, image controls, and accessible keyboard behavior", () => {
  const source = viewer.standaloneScript();
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /poster-evidence-trigger/);
  assert.match(source, /keydown/);
  assert.match(source, /Paper page/);
  assert.match(source, /blockquote/);
  assert.match(source, /image\.src/);
  assert.match(source, /\["asset", "formula"\]/);
  assert.match(source, /Open paper/);
  assert.match(source, /arxiv\\\.org/);
  assert.match(source, /#page=/);
  assert.match(source, /paperPageUrl\(sourceLink\.href, pages\[0\]\)/);
  assert.match(source, /paper-evidence-open-paper/);
  assert.match(source, /uploadedPdfAvailable/);
  assert.match(source, /Copy quote/);
  assert.match(source, /data-evidence-zoom/);
  assert.match(source, /Download original image/);
  assert.match(source, /navigator\.clipboard/);
  assert.match(source, /event\.key === "Tab"/);
  assert.match(source, /'"': "&quot;"/);
});

test("evidence interaction does not add a visible information badge", () => {
  const implementation = viewer.setEvidenceData.toString();
  assert.doesNotMatch(implementation, /createElement\(["']span["']\)/);
  assert.doesNotMatch(implementation, /textContent\s*=\s*["']i["']/);
});
