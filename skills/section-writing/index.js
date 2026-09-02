const BASE_GUIDANCE = {
  overview: "Write at most two complete sentences: lead with the paper's central takeaway, then state the approach and strongest supported result.",
  problem: "Separate the concrete research obstacle from motivation; name the affected setting and consequence.",
  method: "Summarize the end-to-end pipeline in one conclusion-first sentence, then state only the function of essential components. Preserve named component responsibilities exactly and keep benchmark or ablation outcomes in the results section.",
  theory: "Preserve exact notation and assumptions; explain why the formula or theorem matters without reconstructing missing symbols.",
  experiments: "Separate datasets, baselines, metrics, implementation settings, main comparison, and ablations.",
  results: "Lead with the main result, then pair it with the strongest reported number, baseline comparison, or qualitative observation while retaining qualifiers.",
  contribution: "Distinguish supported novelty from implementation detail; include limitations or missing validation in the logic review."
};

const TYPE_ADVICE = {
  method: "Emphasize the mechanism-to-problem link and whether ablations isolate each component.",
  theory: "Emphasize assumptions, statement boundaries, proof idea, and implications rather than experimental breadth.",
  empirical: "Emphasize study design, controls, uncertainty, threats to validity, and whether observations support causality.",
  survey: "Emphasize scope, selection criteria, taxonomy dimensions, comparison rules, and uncovered gaps.",
  system: "Emphasize architecture, workload, implementation constraints, throughput or latency, and scalability evidence.",
  dataset: "Emphasize collection, annotation, statistics, splits, benchmark protocol, bias, licensing, and ethics.",
  guideline: "Emphasize exact mandatory rules, limits, exceptions, and a usable compliance sequence; never reinterpret sample assets as scientific evidence."
};

function buildSectionWritingGuide({ plan, classification } = {}) {
  const paperType = classification?.paperType || plan?.paperType || "method";
  const sections = {};
  for (const task of plan?.tasks || []) {
    sections[task.id] = {
      instruction: BASE_GUIDANCE[task.id] || "Write a concise evidence-grounded section.",
      typeAdvice: TYPE_ADVICE[paperType],
      requiredEvidence: [...(task.requiredEvidence || [])],
      maxSentences: task.id === "overview" ? 2 : 3
    };
  }
  return { paperType, sections };
}

function createSectionWritingSkill() {
  return {
    name: "section-writing",
    description: "Provide task-specific evidence-grounded writing rules",
    stage: "analysis",
    run: buildSectionWritingGuide,
    summarize: (result) => `Prepared writing guidance for ${Object.keys(result.sections).length} sections.`
  };
}

module.exports = { buildSectionWritingGuide, createSectionWritingSkill };
