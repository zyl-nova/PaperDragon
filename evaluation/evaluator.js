const ANALYSIS_FIELDS = [
  "summary", "problem", "motivation", "method", "theory", "experiments", "results",
  "contributions", "innovation", "logicReview", "methodSupportsProblem", "experimentsValidateClaims"
];

function evaluatePaperResult(fixture, candidate = fixture?.candidate || {}) {
  const paperText = String(fixture?.paperText || "");
  const expected = fixture?.expected || {};
  const analysis = candidate.analysis || {};
  const content = evaluateContentCoverage(analysis, expected.requiredFields || {});
  const formulas = evaluateSet(candidate.formulas || analysis.formulas, expected.formulas, normalizeFormula);
  const figures = evaluateAssets(candidate.figures || analysis.figures, expected.figures);
  const tables = evaluateAssets(candidate.tables || analysis.tables, expected.tables);
  const evidence = evaluateEvidenceConsistency(candidate.agent?.evidence || analysis.evidence, paperText);
  const hallucination = evaluateHallucination(analysis, paperText);
  const efficiency = evaluateEfficiency(candidate.agent?.metrics || {});
  const visualRecall = average([figures.recall, tables.recall]);
  const overallScore = roundPercentValue(
    content.score * 0.3
    + formulas.f1 * 0.15
    + visualRecall * 0.15
    + evidence.score * 0.2
    + (1 - hallucination.rate) * 100 * 0.2
  );
  const thresholds = {
    overallScore: Number(fixture?.thresholds?.overallScore ?? 80),
    evidenceConsistency: Number(fixture?.thresholds?.evidenceConsistency ?? 90),
    hallucinationRate: Number(fixture?.thresholds?.hallucinationRate ?? 5)
  };
  const passed = overallScore >= thresholds.overallScore
    && evidence.score >= thresholds.evidenceConsistency
    && hallucination.rate * 100 <= thresholds.hallucinationRate;
  return {
    id: fixture.id,
    title: fixture.title,
    passed,
    overallScore,
    thresholds,
    metrics: { content, formulas, figures, tables, visualRecall: roundPercentValue(visualRecall), evidence, hallucination, efficiency }
  };
}

function runEvaluationSuite(fixtures) {
  const cases = fixtures.map((fixture) => evaluatePaperResult(fixture));
  const metric = (reader) => roundScore(average(cases.map(reader)));
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      cases: cases.length,
      passed: cases.filter((item) => item.passed).length,
      passRate: metric((item) => item.passed ? 1 : 0),
      overallScore: metric((item) => item.overallScore / 100),
      contentCoverage: metric((item) => item.metrics.content.score / 100),
      formulaF1: metric((item) => item.metrics.formulas.f1 / 100),
      figureRecall: metric((item) => item.metrics.figures.recall / 100),
      tableRecall: metric((item) => item.metrics.tables.recall / 100),
      evidenceConsistency: metric((item) => item.metrics.evidence.score / 100),
      hallucinationRate: metric((item) => item.metrics.hallucination.rate),
      durationMs: Math.round(average(cases.map((item) => item.metrics.efficiency.durationMs))),
      totalTokens: Math.round(average(cases.map((item) => item.metrics.efficiency.totalTokens)))
    },
    cases
  };
}

function evaluateContentCoverage(analysis, requiredFields) {
  const details = [];
  let expectedCount = 0;
  let matchedCount = 0;
  for (const [field, concepts] of Object.entries(requiredFields)) {
    const text = normalizeText(analysis[field]);
    const expectedConcepts = Array.isArray(concepts) ? concepts : [];
    const matched = expectedConcepts.filter((concept) => text.includes(normalizeText(concept)));
    expectedCount += expectedConcepts.length;
    matchedCount += matched.length;
    details.push({ field, matched: matched.length, expected: expectedConcepts.length, missing: expectedConcepts.filter((item) => !matched.includes(item)) });
  }
  return { score: percent(matchedCount, expectedCount), matched: matchedCount, expected: expectedCount, details };
}

function evaluateSet(actualValue, expectedValue, normalizer = normalizeText) {
  const actual = unique((Array.isArray(actualValue) ? actualValue : []).map(itemName).map(normalizer).filter(Boolean));
  const expected = unique((Array.isArray(expectedValue) ? expectedValue : []).map(itemName).map(normalizer).filter(Boolean));
  const matched = actual.filter((item) => expected.includes(item)).length;
  const precision = percent(matched, actual.length || expected.length);
  const recall = percent(matched, expected.length);
  const f1 = precision + recall ? roundScore((2 * precision * recall) / (precision + recall) / 100) : 100;
  return { precision, recall, f1, matched, expected: expected.length, actual: actual.length };
}

function evaluateAssets(actual, expected) {
  const actualNames = (Array.isArray(actual) ? actual : []).map(itemName).map(normalizeText).filter(Boolean);
  const expectedNames = (Array.isArray(expected) ? expected : []).map(itemName).map(normalizeText).filter(Boolean);
  const matched = expectedNames.filter((name) => actualNames.some((actualName) => actualName.includes(name) || name.includes(actualName))).length;
  return { recall: percent(matched, expectedNames.length), matched, expected: expectedNames.length, actual: actualNames.length };
}

function evaluateEvidenceConsistency(evidence, paperText) {
  const source = normalizeText(paperText);
  const items = evidence && typeof evidence === "object"
    ? Object.values(evidence).flatMap((value) => Array.isArray(value) ? value : [])
    : [];
  const grounded = items.filter((item) => {
    const quote = normalizeText(item?.quote);
    return quote.length >= 4 && source.includes(quote);
  }).length;
  return { score: percent(grounded, items.length), grounded, total: items.length, ungrounded: items.length - grounded };
}

function evaluateHallucination(analysis, paperText) {
  const sourceNumbers = new Set(extractNumbers(paperText));
  const claims = ANALYSIS_FIELDS.map((field) => String(analysis[field] || "")).join(" ");
  const claimNumbers = unique(extractNumbers(claims));
  const unsupported = claimNumbers.filter((number) => !sourceNumbers.has(number));
  return { rate: claimNumbers.length ? Number((unsupported.length / claimNumbers.length).toFixed(4)) : 0, unsupported, numericClaims: claimNumbers.length };
}

function evaluateEfficiency(metrics) {
  return {
    durationMs: Math.max(0, Number(metrics.durationMs || 0)),
    modelCalls: Math.max(0, Number(metrics.modelCalls || 0)),
    totalTokens: Math.max(0, Number(metrics.totalTokens || 0)),
    estimatedCostUsd: metrics.estimatedCostUsd == null ? null : Math.max(0, Number(metrics.estimatedCostUsd || 0)),
    tokenEstimate: Boolean(metrics.tokenEstimate)
  };
}

function normalizeFormula(value) {
  return String(value || "")
    .replace(/\\begin\{(?:equation\*?|align\*?)\}|\\end\{(?:equation\*?|align\*?)\}/g, "")
    .replace(/\s+/g, "")
    .replace(/\\mathrm\{([^{}]+)\}/g, "$1")
    .toLowerCase();
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}%._]+/gu, " ").replace(/\s+/g, " ").trim();
}

function extractNumbers(value) {
  return String(value || "").match(/\b\d+(?:\.\d+)?%?/g) || [];
}

function itemName(item) {
  return typeof item === "string" ? item : item?.name || item?.caption || "";
}

function unique(items) {
  return [...new Set(items)];
}

function percent(numerator, denominator) {
  return denominator ? roundScore(numerator / denominator) : 100;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
}

function roundScore(ratio) {
  return Number((ratio * 100).toFixed(1));
}

function roundPercentValue(value) {
  return Number(Number(value || 0).toFixed(1));
}

module.exports = {
  evaluatePaperResult,
  runEvaluationSuite,
  evaluateContentCoverage,
  evaluateSet,
  evaluateAssets,
  evaluateEvidenceConsistency,
  evaluateHallucination,
  evaluateEfficiency,
  normalizeFormula
};
