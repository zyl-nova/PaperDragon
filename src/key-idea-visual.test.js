const test = require("node:test");
const assert = require("node:assert/strict");
const { buildKeyIdeaMap, buildMethodFlow, buildMechanismFlow, shouldBuildKeyIdeaMap } = require("./key-idea-visual");

test("builds a grounded concept map from theory phrases", () => {
  const map = buildKeyIdeaMap({
    theory: "The paper introduces universal feature coding and proposes two alignment strategies: format alignment, which reshapes CNN features into the token format, and value alignment, which truncates and normalizes features to a consistent range.",
    method: "The aligned representations are encoded by a shared entropy model."
  });
  assert.match(map.center, /universal feature coding/i);
  assert.ok(map.branches.some((branch) => /format alignment/i.test(branch)));
  assert.ok(map.branches.some((branch) => /value alignment/i.test(branch)));
});

test("does not manufacture a map from insufficient source content", () => {
  assert.equal(buildKeyIdeaMap({ theory: "Shared alignment." }), null);
});

test("does not repeat the method prose as a redundant key-idea map", () => {
  const method = "The method uses Base Code-CoT to decompose tasks and generate tests; Self-Critical Code-CoT executes the tests and iteratively repairs incorrect code.";
  const theory = "Base Code-CoT decomposes tasks and generates tests; Self-Critical Code-CoT executes those tests and iteratively repairs incorrect code.";

  assert.equal(buildKeyIdeaMap({ theory, method }), null);
});

test("builds a source-grounded method flow when no paper method figure is available", () => {
  const flow = buildMethodFlow({
    method: "The generator transforms noise and a class label into an image; the discriminator predicts whether the image is real or fake; an auxiliary classifier predicts the image class; both objectives jointly train the network."
  });
  assert.equal(flow.steps.length, 4);
  assert.match(flow.steps[0], /generator/i);
  assert.ok(flow.steps.some((step) => /auxiliary classifier/i.test(step)));
});

test("does not create a method flow from an incomplete method statement", () => {
  assert.equal(buildMethodFlow({ method: "Uses a classifier." }), null);
});

test("never builds a generated key-idea map when original formula evidence exists", () => {
  assert.equal(shouldBuildKeyIdeaMap({ formulas: [{ latex: "p(y|x)" }] }), false);
  assert.equal(shouldBuildKeyIdeaMap({ formulaImages: [{ url: "/formula.png" }] }), false);
  assert.equal(shouldBuildKeyIdeaMap({ theoryFigures: [{ url: "/figure.png" }] }), false);
  assert.equal(shouldBuildKeyIdeaMap({}), true);
});

test("fallback mechanism flow keeps operations and drops performance claims", () => {
  const flow = buildMechanismFlow({
    theory: "The retriever and generator are trained jointly by marginalizing over retrieved documents.",
    method: "A dense retriever selects the top-k passages; the generator conditions on each retrieved passage; token probabilities are marginalized across passages; this improves factual accuracy and achieves state-of-the-art results."
  });
  assert.equal(flow.steps.length, 4);
  assert.ok(flow.steps.some((step) => /retriever selects/i.test(step)));
  assert.ok(flow.steps.some((step) => /generator conditions/i.test(step)));
  assert.ok(flow.steps.some((step) => /marginali/i.test(step)));
  assert.ok(flow.steps.every((step) => !/accuracy|state-of-the-art|performance/i.test(step)));
});

test("does not emit concept-map branches cut at dangling connector words", () => {
  const map = buildKeyIdeaMap({
    theory: "RAG combines parametric memory with non-parametric memory; the model maximizes the marginal likelihood over retrieved documents without direct retrieval supervision; the generator conditions on complete retrieved passages; the retriever and generator are optimized jointly end to end.",
    method: "A dense retriever selects passages and a sequence generator produces the answer."
  });
  assert.ok(map);
  assert.ok(map.branches.every((branch) => !/\b(?:and|or|with|without|that|which|to|for)$/i.test(branch)));
});

test("keeps CodeCoT mechanism clauses complete and preserves decimal results", () => {
  const map = buildKeyIdeaMap({
    theory: "CodeCoT integrates chain-of-thought reasoning with a self-examination process to address syntax errors in generated code. The mechanism begins with CoT prompting for initial code generation, then generates test cases, executes the code locally, and iteratively refines the code based on error feedback. This approach increases pass@1 from 75.6% to 79.3% on HumanEval.",
    method: "The four-stage workflow generates code, tests it locally, and repairs syntax errors from execution feedback."
  });
  const phrases = [map.center, ...map.branches];
  assert.ok(phrases.some((phrase) => /75\.6% to 79\.3%/.test(phrase)));
  assert.ok(phrases.some((phrase) => /generates test cases/i.test(phrase)));
  assert.ok(phrases.every((phrase) => !/\b(?:and|or|with|without|that|which|to|for|then|generates?|executes?)$/i.test(phrase)));
});
