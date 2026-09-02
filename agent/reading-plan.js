const READING_PLAN = [
  {
    id: "overview",
    label: "Paper overview",
    goal: "Identify the paper title and produce a concise overall summary.",
    fields: ["title", "summary"],
    evidenceKey: "summary"
  },
  {
    id: "problem",
    label: "Research problem",
    goal: "Identify the research problem, gap, motivation, and why the problem matters.",
    fields: ["problem", "motivation"],
    evidenceKey: "problem"
  },
  {
    id: "method",
    label: "Method",
    goal: "Reconstruct the proposed method, pipeline, assumptions, and important implementation details.",
    fields: ["method"],
    evidenceKey: "method"
  },
  {
    id: "theory",
    label: "Formula and theory",
    goal: "Explain the role of the key objective, formula, theorem, or theoretical mechanism without inventing notation.",
    fields: ["theory"],
    evidenceKey: "theory"
  },
  {
    id: "experiments",
    label: "Experiments",
    goal: "Extract datasets, baselines, metrics, ablations, and implementation evidence.",
    fields: ["experiments"],
    evidenceKey: "experiments"
  },
  {
    id: "results",
    label: "Results and claim support",
    goal: "Identify concrete results and judge whether the method and experiments support the paper's claims.",
    fields: ["results", "methodSupportsProblem", "experimentsValidateClaims"],
    evidenceKey: "results"
  },
  {
    id: "contribution",
    label: "Contribution and logic",
    goal: "Summarize contributions, novelty, limitations, and critically reconstruct the complete argument chain.",
    fields: ["contributions", "innovation", "logicReview"],
    evidenceKey: "contributions"
  }
];

function createTaskState(task) {
  return {
    id: task.id,
    label: task.label,
    goal: task.goal,
    fields: [...task.fields],
    status: "pending",
    durationMs: 0,
    evidenceCount: 0,
    attempts: 0,
    evidenceToolCalls: 0,
    memoryHits: 0,
    fallbackUsed: false,
    reactSteps: [],
    error: ""
  };
}

module.exports = { READING_PLAN, createTaskState };
