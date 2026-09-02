const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeReviewHints } = require("./poster-vision-review.js");

test("merges iterative visual repairs without exceeding safe bounds", () => {
  const result = mergeReviewHints(
    [{ panel: "results", areaScale: 1.2, widthScale: 1.1, heightScale: 1 }],
    [
      { panel: "results", areaScale: 1.2, widthScale: 1.2, heightScale: 1.1, reason: "Enlarge table" },
      { panel: "unknown", areaScale: 1.3 }
    ]
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].areaScale, 1.35);
  assert.equal(result[0].widthScale, 1.32);
  assert.equal(result[0].heightScale, 1.1);
});
