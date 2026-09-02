const SKILL_SEQUENCE = [
  { name: "paper-type-classifier", reason: "Identify the paper type and evidence priorities." },
  { name: "reading-plan-builder", reason: "Adapt the reading plan to the detected paper type." },
  { name: "section-writing", reason: "Apply section-specific evidence and writing rules." },
  { name: "visual-evidence-planner", reason: "Plan formulas, figures, and tables by argumentative purpose." },
  { name: "poster-composer", reason: "Compose the verified analysis into a type-aware poster." }
];

function buildSkillPlan() {
  return { selected: SKILL_SEQUENCE.map((item, index) => ({ ...item, order: index + 1 })) };
}

module.exports = { SKILL_SEQUENCE, buildSkillPlan };
