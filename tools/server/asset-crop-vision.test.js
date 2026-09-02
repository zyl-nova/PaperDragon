const test = require("node:test");
const assert = require("node:assert/strict");
const { createAssetCropVisionTool, buildAssetCropPrompt, normalizeAssetCrop } = require("./asset-crop-vision");

test("asset crop prompt asks for complete table edges and excludes neighboring prose", () => {
  const prompt = buildAssetCropPrompt({
    assetKind: "table",
    caption: "Table 1: Results",
    candidateBox: { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 }
  });
  assert.match(prompt, /every rule, header, data row/i);
  assert.match(prompt, /exclude the table caption and neighboring body prose/i);
});

test("asset crop normalization accepts overlapping confident refinements", () => {
  const result = normalizeAssetCrop({
    found: true,
    complete: true,
    confidence: 0.91,
    bbox: { left: 0.12, top: 0.08, right: 0.9, bottom: 0.86 },
    clippedEdges: ["invalid"]
  }, { left: 0.2, top: 0.15, right: 0.85, bottom: 0.82 }, "table");
  assert.equal(result.applied, true);
  assert.deepEqual(result.clippedEdges, []);
  assert.equal(result.bbox.top, 0.08);
});

test("asset crop normalization rejects a visually reported clipped table", () => {
  const fallback = { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 };
  const result = normalizeAssetCrop({
    found: true,
    complete: false,
    confidence: 0.97,
    bbox: { left: 0.12, top: 0.03, right: 0.88, bottom: 0.72 },
    clippedEdges: ["top"]
  }, fallback, "table");
  assert.equal(result.applied, false);
  assert.deepEqual(result.bbox, fallback);
});

test("asset crop normalization rejects an implausibly thin figure strip", () => {
  const fallback = { left: 0.05, top: 0.35, right: 0.95, bottom: 0.7 };
  const result = normalizeAssetCrop({
    found: true,
    complete: true,
    confidence: 0.94,
    bbox: { left: 0.03, top: 0.45, right: 0.97, bottom: 0.53 },
    clippedEdges: []
  }, fallback, "figure");
  assert.equal(result.applied, false);
  assert.deepEqual(result.bbox, fallback);
});

test("asset crop tool falls back when model confidence is too low", async () => {
  const candidateBox = { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 };
  const tool = createAssetCropVisionTool({
    callModel: async () => ({ content: JSON.stringify({
      found: true,
      confidence: 0.2,
      bbox: { left: 0, top: 0, right: 1, bottom: 1 }
    }) })
  });
  const result = await tool.run({ imageDataUrl: "data:image/png;base64,abc", assetKind: "table", candidateBox });
  assert.equal(result.inspection.applied, false);
  assert.deepEqual(result.inspection.bbox, candidateBox);
});
