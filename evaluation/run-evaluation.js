const fs = require("node:fs");
const path = require("node:path");
const { loadEvaluationFixtures, runEvaluation } = require("../tools/server/evaluation-run");

const root = path.join(__dirname, "..");
const fixtures = loadEvaluationFixtures(path.join(__dirname, "fixtures"));
const report = runEvaluation(fixtures);
const outputDir = path.join(root, "outputs");
const outputPath = path.join(outputDir, "evaluation-report.json");

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const summary = report.summary;
console.log(`Evaluation: ${summary.passed}/${summary.cases} passed`);
console.log(`Overall ${summary.overallScore}% | Coverage ${summary.contentCoverage}% | Formula F1 ${summary.formulaF1}%`);
console.log(`Figures ${summary.figureRecall}% | Tables ${summary.tableRecall}% | Evidence ${summary.evidenceConsistency}% | Hallucination ${summary.hallucinationRate}%`);
console.log(`Report: ${outputPath}`);

if (summary.passed !== summary.cases) process.exitCode = 1;
