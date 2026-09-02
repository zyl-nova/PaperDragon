class SkillRegistry {
  constructor({ trace = [] } = {}) {
    this.skills = new Map();
    this.trace = trace;
  }

  register(skill) {
    if (!skill?.name || typeof skill.run !== "function") throw new Error("A skill requires a name and run function.");
    if (this.skills.has(skill.name)) throw new Error(`Skill already registered: ${skill.name}`);
    this.skills.set(skill.name, skill);
    return this;
  }

  async execute(name, input = {}) {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Unknown skill: ${name}`);
    const record = { name, stage: skill.stage || "planning", status: "running", durationMs: 0, summary: "" };
    const startedAt = Date.now();
    this.trace.push(record);
    try {
      const result = await skill.run(input);
      record.status = "completed";
      record.summary = skill.summarize ? skill.summarize(result, input) : "Completed.";
      return result;
    } catch (error) {
      record.status = "failed";
      record.summary = error.message || "Skill failed.";
      throw error;
    } finally {
      record.durationMs = Date.now() - startedAt;
    }
  }

  manifest() {
    return [...this.skills.values()].map(({ name, description, stage }) => ({ name, description, stage }));
  }
}

module.exports = { SkillRegistry };
