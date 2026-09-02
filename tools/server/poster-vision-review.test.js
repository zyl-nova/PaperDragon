const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePosterReview, buildPosterReviewPrompt, isImageDataUrl } = require("./poster-vision-review");

test("normalizes visual review into bounded repair instructions", () => {
  const review = normalizePosterReview({
    overallScore: 108,
    verdict: "pass",
    dimensions: { readability: 91, hierarchy: -2 },
    issues: [{ panel: "results", severity: "high", observation: "Table is too small." }],
    contentRequests: [{ field: "motivation", operation: "shorten", maxSentences: 7 }],
    layoutAdjustments: [{ panel: "results", areaScale: 4, widthScale: 0.1, heightScale: 1.2 }],
    styleAdjustments: { bodyFontScale: 1.8, contrast: "increase" }
  });

  assert.equal(review.overallScore, 100);
  assert.equal(review.verdict, "revise");
  assert.equal(review.dimensions.hierarchy, 0);
  assert.deepEqual(review.layoutAdjustments[0], {
    panel: "results",
    areaScale: 1.35,
    widthScale: 0.8,
    heightScale: 1.2,
    reason: ""
  });
  assert.equal(review.styleAdjustments.bodyFontScale, 1.35);
  assert.deepEqual(review.contentRequests[0], {
    field: "motivation",
    operation: "shorten",
    objective: "",
    maxSentences: 3
  });
});

test("accepts only browser-safe raster image data URLs", () => {
  assert.equal(isImageDataUrl("data:image/jpeg;base64,abc"), true);
  assert.equal(isImageDataUrl("data:image/svg+xml;base64,abc"), false);
  assert.equal(isImageDataUrl("https://example.com/poster.png"), false);
});

test("converts a consistent ten-point visual review to the required hundred-point scale", () => {
  const review = normalizePosterReview({
    overallScore: 8,
    verdict: "pass",
    dimensions: {
      readability: 8,
      hierarchy: 7,
      balance: 8,
      assetLegibility: 9,
      contentDensity: 7,
      polish: 8
    }
  });

  assert.equal(review.overallScore, 80);
  assert.equal(review.dimensions.readability, 80);
  assert.equal(review.dimensions.assetLegibility, 90);
});

test("repairs a ten-point overall score alongside hundred-point dimensions", () => {
  const review = normalizePosterReview({
    overallScore: 8,
    dimensions: { readability: 82, hierarchy: 76, balance: 80 }
  });

  assert.equal(review.overallScore, 80);
  assert.equal(review.dimensions.readability, 82);
});

test("production prompts specialize asset and content inspection", () => {
  const assets = buildPosterReviewPrompt({ stage: "assets", iteration: 1, metrics: {}, posterContent: {}, paperContext: {} });
  const content = buildPosterReviewPrompt({ stage: "content", iteration: 1, metrics: {}, posterContent: {}, paperContext: {} });

  assert.match(assets, /complete intended asset/i);
  assert.match(assets, /formula, figure, and table/i);
  assert.match(content, /summary, research problem, motivation, method, theory\/formulas, results, and contributions/i);
  assert.match(content, /PAPER CONTEXT/);
});
