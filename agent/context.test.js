const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPaperContext, compressText, gatherPaper } = require("./context");
const { READING_PLAN } = require("./reading-plan");

const longPaper = [
  "# Abstract\nWe study slow decoding and propose a parallel architecture.",
  "# Introduction\nSequential computation is the central bottleneck. The problem matters for efficient training.",
  "# Method\nOur architecture uses sparse attention. A gated projection produces the final representation.",
  "# Experiments\nWe evaluate on Dataset Alpha against recurrent baselines. Accuracy and training time are reported.",
  "# Results\nThe proposed model improves accuracy. It also requires less training time.",
  "# Conclusion\nThe main contribution is a fully parallel sequence model.",
  "# References\nUnrelated method result experiment keywords should not be selected."
].join("\n\n");

test("GSSC creates a distinct structured context for every reading task", () => {
  const bundle = buildPaperContext(longPaper, {
    tasks: READING_PLAN,
    maxChars: 5000,
    taskMaxChars: 900
  });
  assert.equal(bundle.stats.strategy, "GSSC");
  assert.equal(bundle.stats.structuredTasks, READING_PLAN.length);
  assert.match(bundle.taskContexts.method.context, /task=method/);
  assert.match(bundle.taskContexts.method.context, /sparse attention/);
  assert.match(bundle.taskContexts.experiments.context, /Dataset Alpha/);
  assert.doesNotMatch(bundle.context, /Unrelated method result experiment keywords/);
  assert.ok(bundle.context.length <= 5000);
});

test("Gather recognizes numbered canonical section headings", () => {
  const gathered = gatherPaper("1 Introduction\nProblem text.\n2 Method\nMethod text.");
  assert.deepEqual(gathered.sections.map((section) => section.heading), ["1 Introduction", "2 Method"]);
  assert.equal(gathered.chunks[1].id, "S2C1");
});

test("Compress keeps complete relevant sentences instead of slicing mid-sentence", () => {
  const source = "Opening sentence is generic. The method uses sparse attention for parallel computation. Closing filler sentence is generic.";
  const compressed = compressText(source, READING_PLAN.find((task) => task.id === "method"), 78);
  assert.match(compressed, /sparse attention/);
  assert.ok(/[.!?]$/.test(compressed));
  assert.ok(compressed.length <= 78);
});

test("Compress preserves examples introduced by e.g. inside one sentence", () => {
  const source = "Prior fusion has limitations, e. g. order dependence and long-term memory loss. The method removes recurrent fusion.";
  const compressed = compressText(source, READING_PLAN.find((task) => task.id === "problem"), 100);
  assert.match(compressed, /e\.g\. order dependence/);
  assert.match(compressed, /long-term memory loss/);
});

test("method context prioritizes methodology over ablation and result sections", () => {
  const paper = [
    "# Abstract\nWe introduce a modular framework and report strong benchmark accuracy.",
    "# Methodology\nThe coordinator delegates planning to one component and verification to another component before revising the output.",
    "# Ablation Results\nTable 2 shows that removing either component lowers accuracy."
  ].join("\n\n");
  const methodTask = READING_PLAN.find((task) => task.id === "method");
  const bundle = buildPaperContext(paper, { tasks: [methodTask], taskMaxChars: 900 });
  const methodChunk = bundle.taskContexts.method.selected.find((chunk) => /Methodology/i.test(chunk.heading));
  const abstractChunk = bundle.taskContexts.method.selected.find((chunk) => /Abstract/i.test(chunk.heading));
  assert.ok(methodChunk.score > abstractChunk.score);
  assert.match(bundle.taskContexts.method.context, /delegates planning/);
});
