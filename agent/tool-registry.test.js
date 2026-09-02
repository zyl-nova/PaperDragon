const test = require("node:test");
const assert = require("node:assert/strict");
const { ToolRegistry } = require("./tool-registry");
const { buildToolPlan } = require("./tool-planner");
const { createExtractionTools } = require("../tools/server/extraction-tools");
const { createReasoningTools } = require("../tools/server/reasoning-tools");
const { runSourceExtractionAgent } = require("./source-agent");

test("tool registry records successful and failed calls", async () => {
  const trace = [];
  const events = [];
  const registry = new ToolRegistry({ trace, onEvent: (event) => events.push(event) });
  registry.register({
    name: "demo.ok",
    description: "Demo tool",
    run: ({ value }) => value * 2,
    summarize: (output) => `Result ${output}`,
    metrics: (output) => ({ resultValue: output })
  });
  registry.register({ name: "demo.fail", run: () => { throw new Error("expected failure"); } });

  assert.equal(await registry.execute("demo.ok", { value: 4 }), 8);
  await assert.rejects(() => registry.execute("demo.fail", {}), /expected failure/);
  assert.deepEqual(trace.map((item) => item.status), ["completed", "failed"]);
  assert.equal(events.length, 4);
  assert.equal(events[0].tool.callId, events[1].tool.callId);
  assert.equal(trace[0].metrics.resultValue, 8);
});

test("tool planner chooses source-specific tools", () => {
  const arxiv = buildToolPlan({ sourceType: "arxiv" }, { verify: true });
  const pdf = buildToolPlan({ sourceType: "pdf" }, { verify: false });
  const arxivNames = arxiv.selected.map((item) => item.name);
  const pdfNames = pdf.selected.map((item) => item.name);

  assert.ok(arxivNames.includes("latex.formulas"));
  assert.ok(arxivNames.includes("latex.figures"));
  assert.ok(arxivNames.includes("pdf.table-crop"));
  assert.ok(!pdfNames.includes("latex.formulas"));
  assert.ok(pdfNames.includes("pdf.parse"));
  assert.ok(!pdfNames.includes("llm.verify"));
});

test("independent server tool files compose into the expected manifests", () => {
  const extraction = createExtractionTools({
    deps: { assetCache: new Map() }
  });
  const reasoning = createReasoningTools({ callModel: async () => ({ content: "{}" }) });

  assert.deepEqual(extraction.manifest().map((item) => item.name), [
    "arxiv.source", "latex.formulas", "latex.figures", "latex.tables", "pdf.table-crop"
  ]);
  assert.deepEqual(reasoning.manifest().map((item) => item.name), [
    "context.select", "memory.recall", "evidence.retrieve", "llm.analyze", "reflection.audit", "llm.verify"
  ]);
});

test("tool registry selects implementations by source profile", () => {
  const registry = new ToolRegistry();
  registry.register({ name: "arxiv.only", inputTypes: ["arxiv"], run: () => null });
  registry.register({ name: "text.only", inputTypes: ["pdf", "text"], run: () => null });
  assert.deepEqual(registry.select({ sourceType: "arxiv" }).map((tool) => tool.name), ["arxiv.only"]);
  assert.deepEqual(registry.select({ sourceType: "pdf" }).map((tool) => tool.name), ["text.only"]);
});

test("source Agent executes only the selected arXiv extraction tools in dependency order", async () => {
  const calls = [];
  const registry = new ToolRegistry();
  const add = (name, run) => registry.register({
    name,
    inputTypes: ["arxiv"],
    run: (input) => { calls.push(name); return run(input); }
  });
  add("arxiv.source", () => ({ files: [], texFiles: [{ name: "main.tex" }], mainTex: { name: "main.tex" }, combinedTex: "paper" }));
  add("latex.formulas", () => ["x=y"]);
  add("latex.figures", () => [{ name: "Figure 1" }]);
  add("latex.tables", () => [{ name: "Table 1" }]);
  add("pdf.table-crop", ({ tables }) => tables.map((table) => ({ ...table, pdfCrop: true })));

  const result = await runSourceExtractionAgent({
    sourceProfile: { sourceType: "arxiv" },
    input: { arxivId: "1234.5678" },
    tools: registry
  });
  assert.deepEqual(calls, ["arxiv.source", "latex.formulas", "latex.figures", "latex.tables", "pdf.table-crop"]);
  assert.equal(result.tables[0].pdfCrop, true);
  assert.ok(result.toolPlan.selected.every((tool) => tool.runtime === "server"));
});
