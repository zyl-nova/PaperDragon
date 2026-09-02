const test = require("node:test");
const assert = require("node:assert/strict");
const { READING_PLAN } = require("./reading-plan");
const { SkillRegistry } = require("./skill-registry");
const { buildSkillPlan } = require("./skill-planner");
const { createPaperSkills } = require("../skills");
const { classifyPaper } = require("../skills/paper-type-classifier");
const { buildAdaptiveReadingPlan } = require("../skills/reading-plan-builder");

test("paper type skill distinguishes method, theory, and survey signals", () => {
  assert.equal(classifyPaper({ text: "We propose a new model and our method uses an attention architecture." }).paperType, "method");
  assert.equal(classifyPaper({ text: "We study translation benchmarks and propose a parallel attention architecture." }).paperType, "method");
  assert.equal(classifyPaper({ text: "Theorem 1 gives a formal guarantee. Proof. Lemma 2 establishes the upper bound." }).paperType, "theory");
  assert.equal(classifyPaper({ text: "We propose a conditional adversarial model with a generator and discriminator.\nReferences\nA proof of convergence. Theorem 2." }).paperType, "method");
  assert.equal(classifyPaper({ text: "This systematic survey presents a taxonomy and meta-analysis of prior work." }).paperType, "survey");
  assert.equal(classifyPaper({ text: "# Advances in 3D Generation: A Survey\nThis paper reviews models, architectures, algorithms, and existing methods across the research landscape." }).paperType, "survey");
  assert.equal(classifyPaper({ text: "Formatting Instructions for ICLR Conference Submissions. Papers must be prepared according to these author guidelines. There is a strict upper limit of 9 pages." }).paperType, "guideline");
  assert.equal(classifyPaper({ text: "LLM Hallucinations in Practical Code Generation: Phenomena, Mechanism, and Mitigation. We conduct an empirical study with research questions, manual annotation, a taxonomy, CoderEval, and Pass@1 mitigation experiments." }).paperType, "empirical");
  assert.equal(classifyPaper({
    text: "MapCoder: Multi-Agent Code Generation for Competitive Problem Solving. We introduce MapCoder: a novel multi-agent prompting framework that replicates the human programming cycle through retrieval, planning, coding, and debugging agents. We evaluate it on eight benchmarks with Pass@1."
  }).paperType, "method");
  assert.equal(classifyPaper({ text: `
AgentCoder: Multi-Agent Code Generation with Effective Testing and Self-optimisation
Abstract
To address these issues, this paper introduces AgentCoder, a novel code generation solution comprising a multi-agent framework with a specialized test designer agent, programmer agent, and test executor agent.
Our main contributions are as follows: we propose AgentCoder and conduct extensive experiments.
2 Related Work
Prior work includes many existing methods across the research landscape. Existing methods use multi-agent collaboration. Prior work is compared with existing methods.
3 Methodology
The framework of AgentCoder and its pipeline are illustrated in Figure 1.
4 Evaluation
We evaluate AgentCoder on HumanEval and MBPP.
` }).paperType, "method");
});

test("guideline reading tasks produce requirements and compliance checks instead of experiments", () => {
  const result = buildAdaptiveReadingPlan({ classification: { paperType: "guideline" }, basePlan: READING_PLAN });
  assert.match(result.tasks.find((task) => task.id === "method").goal, /mandatory submission requirements/i);
  assert.match(result.tasks.find((task) => task.id === "theory").goal, /layout, typography, length/i);
  assert.match(result.tasks.find((task) => task.id === "results").goal, /compliance checklist/i);
});

test("survey reading tasks ask for taxonomy and conceptual synthesis instead of a proposed method", () => {
  const result = buildAdaptiveReadingPlan({ classification: { paperType: "survey" }, basePlan: READING_PLAN });
  assert.match(result.tasks.find((task) => task.id === "method").goal, /taxonomy|organizing dimensions/i);
  assert.match(result.tasks.find((task) => task.id === "theory").goal, /do not require a new formula/i);
  assert.match(result.tasks.find((task) => task.id === "experiments").goal, /without implying the survey ran new experiments/i);
});

test("reading plan preserves coverage while adapting priorities and section order", () => {
  const result = buildAdaptiveReadingPlan({ classification: { paperType: "theory" }, basePlan: READING_PLAN });
  assert.equal(result.tasks.length, READING_PLAN.length);
  assert.equal(result.tasks.find((task) => task.id === "theory").priority, "high");
  assert.equal(result.tasks.find((task) => task.id === "experiments").priority, "supporting");
  assert.ok(result.sectionOrder.indexOf("theory") < result.sectionOrder.indexOf("experiments"));
});

test("five skills execute through one registry and produce auditable plans", async () => {
  const trace = [];
  const skills = createPaperSkills({ trace });
  const plan = buildSkillPlan();
  const text = "We propose a model. Figure 1 shows its architecture. Table 1 reports results. $$L=L_1+L_2$$";
  const classification = await skills.execute("paper-type-classifier", { text, sourceProfile: { sourceType: "arxiv" } });
  const readingPlan = await skills.execute("reading-plan-builder", { classification, basePlan: READING_PLAN });
  const writingGuide = await skills.execute("section-writing", { classification, plan: readingPlan });
  const visualPlan = await skills.execute("visual-evidence-planner", { text, classification, sourceProfile: { sourceType: "arxiv" } });
  const composition = await skills.execute("poster-composer", { classification, readingPlan, visualPlan, analysis: { summary: "A model." } });
  assert.equal(plan.selected.length, 5);
  assert.equal(skills.manifest().length, 5);
  assert.equal(trace.length, 5);
  assert.ok(trace.every((record) => record.status === "completed"));
  assert.equal(Object.keys(writingGuide.sections).length, READING_PLAN.length);
  assert.ok(visualPlan.slots.some((slot) => slot.available));
  assert.equal(composition.sections.length, READING_PLAN.length);
});

test("visual planning treats extracted formula crops as mechanism evidence", async () => {
  const skills = createPaperSkills({ trace: [] });
  const visualPlan = await skills.execute("visual-evidence-planner", {
    text: "The method treats retrieved documents as latent variables and marginalizes their probability to optimize likelihood.",
    classification: { paperType: "method", characteristics: {} },
    sourceProfile: { sourceType: "pdf", formulaCount: 2, formulaImageCount: 2 }
  });
  assert.equal(visualPlan.availableSignals.formulaSignals, 2);
  assert.equal(visualPlan.selectionPolicy.requireMechanismFormula, true);
  assert.equal(visualPlan.slots.find((slot) => slot.kind === "key-formula").available, true);
});

test("skill registry isolates implementation behind a stable contract", async () => {
  const trace = [];
  const registry = new SkillRegistry({ trace });
  registry.register({ name: "example", stage: "planning", run: ({ value }) => value * 2, summarize: (value) => `Result ${value}` });
  assert.equal(await registry.execute("example", { value: 3 }), 6);
  assert.deepEqual(trace[0], { name: "example", stage: "planning", status: "completed", durationMs: trace[0].durationMs, summary: "Result 6" });
  await assert.rejects(() => registry.execute("missing"), /Unknown skill/);
});
