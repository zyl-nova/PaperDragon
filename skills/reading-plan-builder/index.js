const TYPE_FOCUS = {
  method: { high: ["problem", "method", "theory", "experiments", "results"], order: ["overview", "problem", "method", "theory", "experiments", "results", "contribution"] },
  theory: { high: ["problem", "theory", "contribution"], order: ["overview", "problem", "theory", "method", "results", "contribution", "experiments"] },
  empirical: { high: ["problem", "experiments", "results", "contribution"], order: ["overview", "problem", "experiments", "results", "method", "contribution", "theory"] },
  survey: { high: ["overview", "problem", "method", "contribution"], order: ["overview", "problem", "method", "results", "contribution", "experiments", "theory"] },
  system: { high: ["problem", "method", "experiments", "results"], order: ["overview", "problem", "method", "experiments", "results", "contribution", "theory"] },
  dataset: { high: ["problem", "method", "experiments", "results"], order: ["overview", "problem", "method", "experiments", "results", "contribution", "theory"] },
  guideline: { high: ["overview", "problem", "method", "results"], order: ["overview", "problem", "method", "theory", "results", "contribution", "experiments"] }
};

const EVIDENCE_TARGETS = {
  overview: ["abstract claim", "paper objective"],
  problem: ["stated gap", "failure of prior work", "importance"],
  method: ["pipeline", "module roles", "implementation choices"],
  theory: ["exact formula or theorem", "assumptions", "notation meaning"],
  experiments: ["datasets", "baselines", "metrics", "ablations"],
  results: ["numerical result", "comparison", "claim qualifier"],
  contribution: ["claimed novelty", "supported contribution", "limitation"]
};

const SURVEY_TASK_GOALS = {
  overview: "Identify the survey scope, field boundaries, organizing thesis, and concise overall takeaway.",
  problem: "Identify why the field needs synthesis, which fragmentation or comparison gaps motivate the survey, and why they matter.",
  method: "Reconstruct the survey taxonomy, organizing dimensions, scope or selection process, and comparison framework.",
  theory: "Explain the key conceptual definitions or theoretical principles used to organize the field; do not require a new formula when none is proposed.",
  experiments: "Extract recurring datasets, benchmarks, metrics, and evaluation practices across the surveyed studies without implying the survey ran new experiments.",
  results: "Summarize cross-method comparisons, field-wide trends, trade-offs, and conclusions supported by the survey's tables or discussion.",
  contribution: "Summarize the survey's synthesis, taxonomy, identified gaps, limitations, future directions, and complete organizing logic."
};

const SURVEY_EVIDENCE_TARGETS = {
  overview: ["survey scope", "organizing thesis", "field coverage"],
  problem: ["fragmentation", "comparison gap", "open challenge"],
  method: ["taxonomy dimensions", "scope or selection process", "comparison framework"],
  theory: ["concept definition", "organizing principle", "theoretical distinction"],
  experiments: ["datasets across studies", "benchmarks", "evaluation metrics"],
  results: ["cross-method comparison", "trend", "trade-off"],
  contribution: ["survey synthesis", "research gap", "future direction"]
};

const GUIDELINE_TASK_GOALS = {
  overview: "Identify the document's audience, scope, purpose, and the most consequential mandatory rule.",
  problem: "Explain which submission or compliance errors the instructions are intended to prevent and why consistency matters.",
  method: "Organize mandatory submission requirements into a concise workflow covering preparation, formatting, anonymization, and submission.",
  theory: "Extract exact layout, typography, length, file, and presentation rules; do not invent a scientific mechanism or formula.",
  experiments: "Identify checks, examples, exceptions, or validation procedures; do not describe sample figures and tables as experiments.",
  results: "Produce a compliance checklist of the most important enforceable requirements and consequences of violations.",
  contribution: "Summarize the practical value of the instructions, notable exceptions, and remaining items authors must verify."
};

const GUIDELINE_EVIDENCE_TARGETS = {
  overview: ["audience", "scope", "mandatory rule"],
  problem: ["common error", "consistency need", "compliance risk"],
  method: ["submission workflow", "required format", "anonymization"],
  theory: ["page limit", "font size", "margin", "file requirement"],
  experiments: ["compliance check", "example", "exception"],
  results: ["must", "must not", "strict limit"],
  contribution: ["author takeaway", "exception", "verification item"]
};

function buildAdaptiveReadingPlan({ classification, basePlan = [] } = {}) {
  const paperType = classification?.paperType || "method";
  const profile = TYPE_FOCUS[paperType] || TYPE_FOCUS.method;
  const priorities = new Set(profile.high);
  const taskGoals = paperType === "survey" ? SURVEY_TASK_GOALS : paperType === "guideline" ? GUIDELINE_TASK_GOALS : null;
  const evidenceTargets = paperType === "survey" ? SURVEY_EVIDENCE_TARGETS : paperType === "guideline" ? GUIDELINE_EVIDENCE_TARGETS : EVIDENCE_TARGETS;
  const tasks = basePlan.map((task) => ({
    ...task,
    priority: priorities.has(task.id) ? "high" : "supporting",
    requiredEvidence: [...(evidenceTargets[task.id] || [])],
    goal: `${taskGoals?.[task.id] || task.goal} Apply the ${paperType}-document reading focus and preserve explicit qualifiers.`
  }));
  return { paperType, tasks, executionOrder: tasks.map((task) => task.id), sectionOrder: [...profile.order] };
}

function createReadingPlanBuilderSkill() {
  return {
    name: "reading-plan-builder",
    description: "Build a type-aware reading plan with explicit evidence targets",
    stage: "planning",
    run: buildAdaptiveReadingPlan,
    summarize: (result) => `Built ${result.tasks.length} tasks for a ${result.paperType} paper.`
  };
}

module.exports = { buildAdaptiveReadingPlan, createReadingPlanBuilderSkill };
