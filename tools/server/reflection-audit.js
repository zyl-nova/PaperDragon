const { ANALYSIS_FIELDS } = require("../../agent/prompts");

function auditAnalysis({ analysis, evidence, readingTasks, sourceProfile, toolTrace }) {
  const profile = sourceProfile && typeof sourceProfile === "object" ? sourceProfile : {};
  const traces = Array.isArray(toolTrace) ? toolTrace : [];
  const checks = [];
  const add = (id, ok, severity, detail, fields = []) => checks.push({ id, ok, severity, detail, fields });
  const hasCompletedTool = (name) => traces.some((item) => item.name === name && item.status === "completed");
  const evidenceFor = (key) => Array.isArray(evidence?.[key]) ? evidence[key] : [];
  const missingFields = ANALYSIS_FIELDS.filter((field) => isMissing(analysis?.[field]));

  add(
    "evidence-coverage",
    (readingTasks || []).every((task) => task.status === "completed" || task.status === "insufficient"),
    "high",
    `${(readingTasks || []).filter((task) => task.status === "completed").length}/${(readingTasks || []).length} tasks produced grounded conclusions.`
  );
  add(
    "formula-provenance",
    Number(profile.formulaCount || 0) === 0 || hasCompletedTool(profile.sourceType === "arxiv" ? "latex.formulas" : "text.formulas"),
    "high",
    formulaDetail(profile, hasCompletedTool)
  );
  add(
    "figure-provenance",
    Number(profile.figureCount || 0) === 0 || hasCompletedTool(profile.sourceType === "arxiv" ? "latex.figures" : "text.figures"),
    "high",
    figureDetail(profile, hasCompletedTool)
  );
  add(
    "table-provenance",
    Number(profile.tableCount || 0) === 0 || hasCompletedTool("latex.tables") || hasCompletedTool("pdf.table-crop"),
    "medium",
    `${Number(profile.tableCount || 0)} table(s) reported; ${Number(profile.originalTableCount || 0)} original or rendered table image(s).`
  );
  add(
    "method-problem-fit",
    evidenceFor("problem").length > 0 && evidenceFor("method").length > 0 && !isMissing(analysis?.methodSupportsProblem),
    "high",
    "Requires grounded problem evidence, method evidence, and an explicit fit judgment.",
    ["problem", "method", "methodSupportsProblem"]
  );
  add(
    "experiment-claim-fit",
    evidenceFor("experiments").length > 0 && evidenceFor("results").length > 0 && !isMissing(analysis?.experimentsValidateClaims),
    "high",
    "Requires grounded experiment evidence, result evidence, and an explicit claim-support judgment.",
    ["experiments", "results", "experimentsValidateClaims"]
  );
  add(
    "required-content",
    missingFields.length === 0,
    "medium",
    missingFields.length ? `Missing or insufficient fields: ${missingFields.join(", ")}.` : "All required analysis fields are populated.",
    missingFields
  );

  const failed = checks.filter((check) => !check.ok);
  return {
    verdict: failed.some((check) => check.severity === "high") ? "review" : failed.length ? "warning" : "pass",
    score: Math.round((checks.filter((check) => check.ok).length / checks.length) * 100),
    checks,
    issues: failed.map((check) => ({ id: check.id, severity: check.severity, detail: check.detail, fields: check.fields }))
  };
}

function isMissing(value) {
  return !String(value || "").trim() || /not found in provided context|untitled paper/i.test(String(value));
}

function formulaDetail(profile, hasCompletedTool) {
  const count = Number(profile.formulaCount || 0);
  if (!count) return "No formula was extracted; no formula provenance claim is made.";
  const tool = profile.sourceType === "arxiv" ? "latex.formulas" : "text.formulas";
  return `${count} formula(s) reported through ${tool}; tool completed: ${hasCompletedTool(tool)}.`;
}

function figureDetail(profile, hasCompletedTool) {
  const count = Number(profile.figureCount || 0);
  if (!count) return "No figure was extracted; no figure provenance claim is made.";
  const tool = profile.sourceType === "arxiv" ? "latex.figures" : "text.figures";
  return `${count} figure(s) reported through ${tool}; ${Number(profile.originalFigureCount || 0)} include original artwork; tool completed: ${hasCompletedTool(tool)}.`;
}

function createReflectionAuditTool() {
  return {
    name: "reflection.audit",
    description: "Auditing evidence, assets, missing content, and argument support",
    stage: "verification",
    runtime: "server",
    inputTypes: [],
    run: auditAnalysis,
    summarize: (report) => `${report.score}% deterministic audit; ${report.issues.length} issue(s).`
  };
}

module.exports = { createReflectionAuditTool, auditAnalysis, isMissing };
