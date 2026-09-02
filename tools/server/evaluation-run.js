const fs = require("node:fs");
const path = require("node:path");
const { runEvaluationSuite } = require("../../evaluation/evaluator");

function loadEvaluationFixtures(fixturesDir) {
  return fs.readdirSync(fixturesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(fixturesDir, entry.name), "utf8")));
}

function runEvaluation(fixtures) {
  const startedAt = Date.now();
  const report = runEvaluationSuite(fixtures);
  report.runtime = { durationMs: Date.now() - startedAt, mode: "offline-reference" };
  return report;
}

function createEvaluationRunTool({ fixturesDir }) {
  return {
    name: "evaluation.run",
    description: "Run the fixed offline paper-reading benchmark without calling an LLM API",
    stage: "evaluation",
    runtime: "server",
    inputTypes: [],
    run: async () => runEvaluation(loadEvaluationFixtures(fixturesDir)),
    summarize: (report) => `${report.summary.passed}/${report.summary.cases} benchmark cases passed with ${report.summary.overallScore}% overall score.`
  };
}

module.exports = { loadEvaluationFixtures, runEvaluation, createEvaluationRunTool };
