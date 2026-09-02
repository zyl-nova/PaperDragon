const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeContentRequests, validateRevisions } = require("./poster-content-refine");

test("content requests are limited to editable poster fields", () => {
  const requests = normalizeContentRequests([
    { field: "motivation", operation: "shorten", maxSentences: 9 },
    { field: "motivation", operation: "clarify" },
    { field: "formula", operation: "clarify" }
  ]);
  assert.deepEqual(requests, [{ field: "motivation", operation: "shorten", objective: "", maxSentences: 3 }]);
});

test("content revisions reject unsupported numbers and accept grounded compression", () => {
  const context = {
    posterContent: { results: "The model reaches 28.4 BLEU and trains in 12 hours." },
    paperContext: { evidence: "The model reaches 28.4 BLEU after 12 hours." },
    requests: [{ field: "results", operation: "shorten", maxSentences: 2 }]
  };
  const checked = validateRevisions({
    results: "The model reaches 31.2 BLEU while training in 12 hours."
  }, context);
  assert.equal(checked.revisions.results, undefined);
  assert.match(checked.rejected.results, /31\.2/);

  const accepted = validateRevisions({ results: "The model reaches 28.4 BLEU after 12 hours." }, context);
  assert.equal(accepted.revisions.results, "The model reaches 28.4 BLEU after 12 hours.");
});

test("content revisions cannot remove a formula from the theory field", () => {
  const context = {
    posterContent: { theory: "The model has O(MN + LN^2) complexity." },
    paperContext: { evidence: "The model has O(MN + LN^2) complexity." },
    requests: [{ field: "theory", operation: "clarify", maxSentences: 2 }]
  };
  const rejected = validateRevisions({ theory: "The model has a complexity where M and N denote array sizes." }, context);
  assert.match(rejected.rejected.theory, /mathematical notation/);

  const accepted = validateRevisions({ theory: "The model has O(MN + LN^2) complexity, where M and N denote array sizes." }, context);
  assert.equal(accepted.revisions.theory, "The model has O(MN + LN^2) complexity, where M and N denote array sizes.");
});
