const { SkillRegistry } = require("../agent/skill-registry");
const { createPaperTypeClassifierSkill } = require("./paper-type-classifier");
const { createReadingPlanBuilderSkill } = require("./reading-plan-builder");
const { createSectionWritingSkill } = require("./section-writing");
const { createVisualEvidencePlannerSkill } = require("./visual-evidence-planner");
const { createPosterComposerSkill } = require("./poster-composer");

function createPaperSkills({ trace = [] } = {}) {
  const registry = new SkillRegistry({ trace });
  [
    createPaperTypeClassifierSkill(),
    createReadingPlanBuilderSkill(),
    createSectionWritingSkill(),
    createVisualEvidencePlannerSkill(),
    createPosterComposerSkill()
  ].forEach((skill) => registry.register(skill));
  return registry;
}

module.exports = { createPaperSkills };
