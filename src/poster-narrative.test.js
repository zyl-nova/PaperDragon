const test = require("node:test");
const assert = require("node:assert/strict");
const { composeResults, composeMethod, composeContributions } = require("./poster-narrative");

test("poster narrative keeps concrete results ahead of experiment setup", () => {
  const text = composeResults({
    experiments: "The study uses five benchmarks and two foundation models.",
    results: "PairCoder improves pass@1 by 12.00%-162.43% over direct prompting.",
    experimentsValidateClaims: "The main comparison and ablation support both proposed mechanisms."
  });
  assert.ok(text.indexOf("12.00%-162.43%") < text.indexOf("five benchmarks"));
  assert.ok(text.indexOf("ablation") < text.indexOf("five benchmarks"));
});

test("poster narrative exposes method support and critical contribution scope", () => {
  const method = composeMethod({
    method: "Navigator explores plans while Driver implements and tests code.",
    methodSupportsProblem: "Plan switching directly addresses failure under a rigid initial plan."
  });
  const contributions = composeContributions({
    contributions: "The paper introduces PairCoder.",
    innovation: "It combines multi-plan exploration with feedback-driven refinement.",
    logicReview: "Accuracy gains are supported, with additional API-call cost."
  });
  assert.match(method, /directly addresses/);
  assert.match(contributions, /multi-plan exploration/);
  assert.match(contributions, /API-call cost/);
});
