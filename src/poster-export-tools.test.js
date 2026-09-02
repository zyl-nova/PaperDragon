const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanPosterTitle, resolvePosterTitle, compactPosterPoints, posterEmphasisMatches, splitPosterTitle, stripPosterEvidenceCues } = require("./poster-export-tools.js");

test("poster export removes visible evidence badges while preserving clickable content", () => {
  let removed = 0;
  stripPosterEvidenceCues({
    querySelectorAll(selector) {
      assert.equal(selector, ".poster-evidence-cue");
      return [{ remove: () => { removed += 1; } }, { remove: () => { removed += 1; } }];
    }
  });
  assert.equal(removed, 2);
});

test("removes a trailing first-page section label from a PDF title", () => {
  assert.equal(cleanPosterTitle("Conditional Image Synthesis with Auxiliary Classifier GANs Abstract"), "Conditional Image Synthesis with Auxiliary Classifier GANs");
  assert.equal(cleanPosterTitle("Formatting Instructions for ICLR 2024Conference Submissions"), "Formatting Instructions for ICLR 2024 Conference Submissions");
  assert.equal(cleanPosterTitle("Pix2Vox: Context-aware 3D Reconstruction"), "Pix2Vox: Context-aware 3D Reconstruction");
});

test("authoritative PDF title cannot be overwritten by stale text or model output", () => {
  assert.equal(resolvePosterTitle(
    "Code Optimization Chain-of-Thought: Structured Understanding and Self-Checking",
    "Formatting Instructions for ICLR 2024 Conference Submissions",
    "Untitled paper"
  ), "Code Optimization Chain-of-Thought: Structured Understanding and Self-Checking");
});

test("long poster titles split into two balanced complete lines", () => {
  const title = "CROSS-ARCHITECTURE UNIVERSAL FEATURE CODING VIA DISTRIBUTION ALIGNMENT";
  const lines = splitPosterTitle(title);
  assert.equal(lines.length, 2);
  assert.equal(lines.join(" "), title);
  assert.ok(Math.abs(lines[0].length - lines[1].length) <= 12);
});

test("short poster titles remain on one line", () => {
  assert.deepEqual(splitPosterTitle("Attention Is All You Need"), ["Attention Is All You Need"]);
});

test("poster export compacts long analysis into a bounded set of points", () => {
  const points = compactPosterPoints(
    "First grounded finding. Second grounded finding. Third grounded finding. Fourth supporting detail.",
    3,
    120
  );

  assert.deepEqual(points, [
    "First grounded finding.",
    "Second grounded finding.",
    "Third grounded finding."
  ]);
  assert.ok(points.join(" ").length <= 120);
});

test("poster export supports Chinese sentence boundaries", () => {
  assert.deepEqual(compactPosterPoints("\u7b2c\u4e00\u9879\u7ed3\u8bba\u3002\u7b2c\u4e8c\u9879\u7ed3\u8bba\uff01\u7b2c\u4e09\u9879\u8865\u5145\u3002", 2, 120), [
    "\u7b2c\u4e00\u9879\u7ed3\u8bba\u3002",
    "\u7b2c\u4e8c\u9879\u7ed3\u8bba\uff01"
  ]);
});

test("poster export keeps decimal measurements inside one result sentence", () => {
  const points = compactPosterPoints(
    "The model reaches 28.4 BLEU on English-to-German and 41.8 BLEU on English-to-French. Training is substantially cheaper.",
    3,
    300
  );

  assert.deepEqual(points, [
    "The model reaches 28.4 BLEU on English-to-German and 41.8 BLEU on English-to-French.",
    "Training is substantially cheaper."
  ]);
});

test("poster export does not split sentences at academic abbreviations", () => {
  assert.deepEqual(compactPosterPoints(
    "RNN fusion has several limitations, e. g. order dependence and long-term memory loss. Pix2Vox removes sequential fusion.",
    2,
    300
  ), [
    "RNN fusion has several limitations, e.g. order dependence and long-term memory loss.",
    "Pix2Vox removes sequential fusion."
  ]);
});

test("poster export keeps comparison abbreviations inside one contribution", () => {
  assert.deepEqual(compactPosterPoints(
    "AgentCoder uses three agents vs. five or seven in prior work, thereby lowering token overhead. It also improves test quality.",
    3,
    300
  ), [
    "AgentCoder uses three agents vs. five or seven in prior work, thereby lowering token overhead.",
    "It also improves test quality."
  ]);
});

test("poster export keeps a long scientific claim complete when it exceeds the soft budget", () => {
  const sentence = "The proposed architecture removes recurrent computation, enabling every token to be processed in parallel while preserving global interactions through self-attention and improving training efficiency across the reported translation tasks.";
  const point = compactPosterPoints(
    sentence,
    1,
    110
  )[0];

  assert.equal(point, sentence);
  assert.ok(/[.!?]$/.test(point));
  assert.doesNotMatch(point, /\.\.\.$/);
});

test("poster export includes the next complete sentence before stopping at the soft budget", () => {
  const first = "Traditional optimization requires specialized knowledge and experienced programmers.";
  const second = "Existing inference-time optimization is often a one-time process, lacking iterative revision and improvement.";

  assert.deepEqual(compactPosterPoints(`${first} ${second}`, 2, first.length + 10), [first, second]);
});

test("poster export preserves a complete motivation sentence within its panel budget", () => {
  const sentence = `A complete motivation sentence ${"explains the documented limitation and its practical consequence ".repeat(4).trim()}.`;
  const point = compactPosterPoints(sentence, 2, 330)[0];

  assert.equal(point, sentence);
  assert.doesNotMatch(point, /\.\.\.$/);
});

test("motivation export can retain a long complete sentence without a per-sentence cap", () => {
  const sentence = `The motivation ${"connects the prior limitation to the practical need for the proposed method ".repeat(8).trim()}.`;
  const point = compactPosterPoints(sentence, 3, 2000)[0];

  assert.equal(point, sentence);
});

test("poster emphasis prioritizes metrics and technical terms", () => {
  const matches = posterEmphasisMatches(
    "The Transformer reaches 28.4 BLEU with scaled dot-product attention and self-attention."
  );

  assert.deepEqual(matches.map(({ text, kind }) => ({ text, kind })), [
    { text: "Transformer", kind: "term" },
    { text: "28.4 BLEU", kind: "metric" },
    { text: "scaled dot-product attention", kind: "term" }
  ]);
});

test("poster emphasis remains sparse", () => {
  const matches = posterEmphasisMatches(
    "BERT uses encoder-decoder attention with self-attention and reaches 91.2 F1 in 3 hours."
  );

  assert.equal(matches.length, 3);
  assert.ok(matches.some((match) => match.kind === "metric"));
});
