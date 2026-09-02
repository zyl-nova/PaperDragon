const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyAssetPlacement, partitionPosterAssets } = require("./poster-asset-placement.js");

test("places architecture figures beside the method and result evidence beside experiments", () => {
  assert.equal(classifyAssetPlacement({ name: "Figure 1: Model architecture and training pipeline" }), "method");
  assert.equal(classifyAssetPlacement({ caption: "Ablation results and BLEU comparison" }), "results");
  assert.equal(classifyAssetPlacement({ caption: "Key idea: feature alignment principle" }), "theory");
  assert.equal(classifyAssetPlacement({ name: "Figure X", _posterAnalysis: { placement: "results" } }), "results");
});

test("partitions selected assets and always attaches tables to results", () => {
  const partitioned = partitionPosterAssets({
    figures: [{ name: "Method overview" }, { name: "Feature alignment principle" }, { name: "Performance comparison" }],
    tables: [{ name: "Table 1" }]
  });
  assert.deepEqual(partitioned.methodFigures.map((item) => item.name), ["Method overview"]);
  assert.deepEqual(partitioned.theoryFigures.map((item) => item.name), ["Feature alignment principle"]);
  assert.deepEqual(partitioned.resultFigures.map((item) => item.name), ["Performance comparison"]);
  assert.deepEqual(partitioned.resultTables.map((item) => item.name), ["Table 1"]);
});
