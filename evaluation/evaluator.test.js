const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { evaluatePaperResult, runEvaluationSuite } = require("./evaluator");

const fixtureDir = path.join(__dirname, "fixtures");

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8"));
}

test("a grounded reference candidate passes all benchmark thresholds", () => {
  const result = evaluatePaperResult(loadFixture("attention-mini.json"));
  assert.equal(result.passed, true);
  assert.equal(result.overallScore, 100);
  assert.equal(result.metrics.formulas.f1, 100);
  assert.equal(result.metrics.evidence.score, 100);
  assert.equal(result.metrics.hallucination.rate, 0);
  assert.equal(result.metrics.visualRecall, 100);
});

test("the evaluator detects missing assets, unsupported evidence, and invented numbers", () => {
  const fixture = loadFixture("attention-mini.json");
  fixture.candidate = {
    analysis: {
      problem: "A generic translation problem.",
      method: "An unspecified attention method.",
      experiments: "A benchmark was used.",
      results: "The model reaches 99.9 BLEU.",
      contributions: "A model."
    },
    formulas: [],
    figures: [],
    tables: [],
    agent: { evidence: { results: [{ quote: "This quote is not in the paper." }] }, metrics: {} }
  };
  const result = evaluatePaperResult(fixture);
  assert.equal(result.passed, false);
  assert.equal(result.metrics.formulas.recall, 0);
  assert.equal(result.metrics.figures.recall, 0);
  assert.equal(result.metrics.tables.recall, 0);
  assert.equal(result.metrics.evidence.score, 0);
  assert.deepEqual(result.metrics.hallucination.unsupported, ["99.9"]);
});

test("the evaluation suite aggregates fixed cases deterministically", () => {
  const fixtures = [loadFixture("attention-mini.json"), loadFixture("graph-mini.json"), loadFixture("paircoder-mini.json")];
  const report = runEvaluationSuite(fixtures);
  assert.equal(report.summary.cases, 3);
  assert.equal(report.summary.passed, 3);
  assert.equal(report.summary.passRate, 100);
  assert.equal(report.summary.overallScore, 100);
  assert.equal(report.summary.hallucinationRate, 0);
});
