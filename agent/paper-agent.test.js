const test = require("node:test");
const assert = require("node:assert/strict");
const { runPaperAgent } = require("./paper-agent");
const { READING_PLAN } = require("./reading-plan");

const paper = `
# Abstract
We study slow sequence transduction and propose a parallel attention architecture.
# Method
The model uses multi-head attention and a position-wise feed-forward network.
Figure 1 shows the attention architecture.
# Experiments
We evaluate on translation benchmarks against recurrent and convolutional baselines.
# Results
The model improves translation quality while requiring less training time.
# Conclusion
Our contribution is a sequence model based entirely on attention.
`;

const fieldValues = {
  title: "Attention Study",
  summary: "A parallel sequence model.",
  problem: "Sequential computation slows sequence transduction.",
  motivation: "Parallel training can reduce training time.",
  method: "Multi-head attention with feed-forward layers.",
  theory: "Attention relates token representations directly.",
  experiments: "Translation benchmarks with recurrent and convolutional baselines.",
  results: "The model improves translation quality.",
  contributions: "A sequence model based entirely on attention.",
  innovation: "It removes recurrence from the main architecture.",
  logicReview: "The method directly targets sequential computation.",
  methodSupportsProblem: "Yes, attention enables parallel computation.",
  experimentsValidateClaims: "The comparison supports the efficiency claim."
};

function taskResponse(task) {
  const quotes = {
    overview: "parallel attention architecture",
    problem: "slow sequence transduction",
    method: "multi-head attention",
    theory: "multi-head attention",
    experiments: "translation benchmarks",
    results: "less training time",
    contribution: "based entirely on attention"
  };
  return {
    content: JSON.stringify({
      status: "complete",
      fields: Object.fromEntries(task.fields.map((field) => [field, fieldValues[field]])),
      evidence: [{ quote: quotes[task.id], location: task.label }],
      assetRecommendations: task.id === "method"
        ? [{ type: "figure", reference: "Figure 1", purpose: "Method overview", insight: "The figure shows the end-to-end attention architecture." }]
        : []
    })
  };
}

test("executes each reading task, merges results, and applies verification", async () => {
  const events = [];
  let calls = 0;
  const result = await runPaperAgent({
    text: paper,
    onEvent: (event) => events.push(event),
    callModel: async () => {
      const callIndex = calls++;
      if (callIndex < READING_PLAN.length) return taskResponse(READING_PLAN[callIndex]);
      return {
        content: JSON.stringify({
          verdict: "revise",
          summary: "One result needed qualification.",
          confidence: 0.9,
          checks: [{ name: "evidence grounding", ok: true, detail: "Grounded" }],
          corrections: { results: "The supplied context reports improved quality and less training time." }
        })
      };
    }
  });

  assert.equal(result.analysis.source, "agent");
  assert.match(result.analysis.results, /supplied context/);
  assert.equal(result.agent.verification.verdict, "revise");
  assert.equal(result.agent.metrics.modelCalls, READING_PLAN.length + 1);
  assert.ok(result.agent.metrics.totalTokens > 0);
  assert.equal(result.agent.metrics.tokenEstimate, true);
  assert.equal(result.agent.metrics.taskCompletion, 100);
  assert.equal(result.agent.metrics.evidenceCoverage, 100);
  assert.equal(result.agent.skills.plan.selected.length, 5);
  assert.equal(result.agent.skills.trace.length, 5);
  assert.equal(result.agent.skills.classification.paperType, "method");
  assert.ok(result.agent.skills.trace.every((skill) => skill.status === "completed"));
  assert.deepEqual(result.analysis.assetRecommendations, [{
    type: "figure",
    reference: "Figure 1",
    section: "method",
    purpose: "Method overview",
    insight: "The figure shows the end-to-end attention architecture."
  }]);
  assert.ok(result.agent.plan.every((task) => task.status === "completed"));
  const lifecycle = events.map((event) => event.stage);
  assert.equal(lifecycle[0], "planning");
  assert.ok(lifecycle.indexOf("context") < lifecycle.indexOf("analysis"));
  assert.ok(lifecycle.indexOf("analysis") < lifecycle.indexOf("verification"));
  assert.equal(lifecycle.at(-1), "reporting");
  assert.equal(result.agent.tools.filter((tool) => tool.name === "llm.analyze").length, READING_PLAN.length);
  assert.equal(result.agent.tools.filter((tool) => tool.name === "evidence.retrieve").length, READING_PLAN.length);
  assert.equal(result.agent.tools.filter((tool) => tool.name === "reflection.audit").length, 1);
});

test("keeps all task results when the single verification pass fails", async () => {
  let calls = 0;
  const result = await runPaperAgent({
    text: paper,
    callModel: async () => {
      const callIndex = calls++;
      if (callIndex < READING_PLAN.length) return taskResponse(READING_PLAN[callIndex]);
      throw new Error("verification timeout");
    }
  });

  assert.equal(result.analysis.title, fieldValues.title);
  assert.equal(result.agent.verification.verdict, "unavailable");
  assert.match(result.agent.verification.summary, /verification timeout/);
  assert.equal(result.agent.metrics.modelCalls, READING_PLAN.length + 1);
  assert.equal(result.agent.stages.at(-1).stage, "reporting");
});

test("isolates one failed reading task and continues the remaining plan", async () => {
  let calls = 0;
  const result = await runPaperAgent({
    text: paper,
    options: { verify: false },
    callModel: async () => {
      const task = READING_PLAN[calls++];
      if (task.id === "theory") return { content: "not json" };
      return taskResponse(task);
    }
  });

  assert.equal(result.agent.metrics.completedReadingTasks, READING_PLAN.length - 1);
  assert.equal(result.agent.metrics.failedReadingTasks, 1);
  assert.equal(result.agent.plan.find((task) => task.id === "theory").status, "failed");
  assert.equal(result.analysis.theory, "not found in provided context");
  assert.equal(result.analysis.contributions, fieldValues.contributions);
});

test("surfaces an actionable billing error when every reading task receives HTTP 402", async () => {
  await assert.rejects(
    runPaperAgent({
      text: paper,
      options: { verify: false },
      callModel: async () => {
        throw new Error("LLM request failed (402): Insufficient Balance");
      }
    }),
    /HTTP 402.*account balance and billing status/i
  );
});

test("ReAct broadens evidence retrieval once after an ungrounded answer", async () => {
  const attempts = new Map();
  const result = await runPaperAgent({
    text: paper,
    options: { verify: false },
    callModel: async (request) => {
      const prompt = request.messages[1].content;
      const taskId = prompt.match(/- id: ([a-z]+)/)?.[1];
      const task = READING_PLAN.find((item) => item.id === taskId);
      const count = (attempts.get(taskId) || 0) + 1;
      attempts.set(taskId, count);
      if (taskId === "method" && count === 1) {
        return { content: JSON.stringify({
          status: "complete",
          fields: { method: "Unsupported method" },
          evidence: [{ quote: "invented quotation", location: "Method" }]
        }) };
      }
      return taskResponse(task);
    }
  });

  const methodTask = result.agent.plan.find((task) => task.id === "method");
  assert.equal(methodTask.attempts, 2);
  assert.equal(methodTask.evidenceToolCalls, 2);
  assert.equal(methodTask.reactSteps[0].conclusion, "insufficient evidence");
  assert.equal(methodTask.reactSteps[1].conclusion, "grounded conclusion");
  assert.equal(result.analysis.method, fieldValues.method);
  assert.equal(result.agent.metrics.retries, 1);
});

test("ReAct uses progressively broader repair rounds until grounded evidence is recovered", async () => {
  const attempts = new Map();
  const result = await runPaperAgent({
    text: paper,
    options: { verify: false, maxTaskRounds: 4 },
    callModel: async (request) => {
      const prompt = request.messages[1].content;
      const taskId = prompt.match(/- id: ([a-z]+)/)?.[1];
      const task = READING_PLAN.find((item) => item.id === taskId);
      const count = (attempts.get(taskId) || 0) + 1;
      attempts.set(taskId, count);
      if (taskId === "method" && count < 3) {
        return { content: JSON.stringify({
          status: "complete",
          fields: { method: "Unsupported method" },
          evidence: [{ quote: "invented quotation", location: "Method" }]
        }) };
      }
      return taskResponse(task);
    }
  });

  const methodTask = result.agent.plan.find((task) => task.id === "method");
  assert.equal(methodTask.status, "completed");
  assert.equal(methodTask.attempts, 3);
  assert.equal(methodTask.evidenceToolCalls, 3);
  assert.equal(result.agent.metrics.retries, 2);
  assert.ok(result.agent.tools.some((tool) => tool.name === "evidence.retrieve" && /full-paper-expanded-r3/.test(tool.summary)));
});

test("evidence validation tolerates PDF line-break hyphenation", () => {
  const evidence = require("./paper-agent").validateTaskEvidence({
    evidence: [{ quote: "The methods improve translation quality", location: "Results" }]
  }, "The meth-\nods improve translation quality while requiring less time.");
  assert.equal(evidence.length, 1);
});

test("task field validation rejects captions and broken PDF fragments", () => {
  const { validateTaskFields } = require("./paper-agent");
  const task = READING_PLAN.find((item) => item.id === "problem");
  assert.ok(validateTaskFields(task, {
    fields: {
      problem: "ing problem and use recurrent neural networks to",
      motivation: "Figure 3: The network architecture of Pix2Vox."
    }
  }).length >= 2);
  assert.deepEqual(validateTaskFields(task, {
    fields: {
      problem: "Sequential recurrent fusion loses long-term information and depends on input order.",
      motivation: "A permutation-invariant fusion mechanism can use arbitrary views without discarding useful evidence."
    }
  }), []);
});

test("task field validation rejects a conclusion cut at an abbreviation", () => {
  const { validateTaskFields } = require("./paper-agent");
  const task = READING_PLAN.find((item) => item.id === "problem");
  const issues = validateTaskFields(task, {
    fields: {
      problem: "RNN-based reconstruction methods have several limitations, e. g.",
      motivation: "Removing sequential fusion allows arbitrary input views to contribute to reconstruction."
    }
  });
  assert.ok(issues.some((issue) => /abbreviation/.test(issue)));
});

test("task field validation rejects a dangling method clause", () => {
  const { validateTaskFields } = require("./paper-agent");
  const task = READING_PLAN.find((item) => item.id === "method");
  const issues = validateTaskFields(task, {
    fields: {
      method: "The discriminator is trained with an adversarial loss, and for the projection model."
    }
  });
  assert.ok(issues.some((issue) => /dangling clause/.test(issue)));
});

test("overview validation rejects a summary with a missing comparison target", () => {
  const { validateTaskFields } = require("./paper-agent");
  const task = READING_PLAN.find((item) => item.id === "overview");
  const issues = validateTaskFields(task, {
    fields: {
      title: "PairCoder",
      summary: "PairCoder achieves relative pass@1 improvements of 12.00%-162.43% compared."
    }
  });
  assert.ok(issues.some((issue) => /comparison target/.test(issue)));
});

test("contribution validation rejects result-only claims and accepts supported novelty", () => {
  const { validateTaskFields } = require("./paper-agent");
  const task = READING_PLAN.find((item) => item.id === "contribution");
  const common = {
    innovation: "The auxiliary classification objective supplies class information during adversarial training.",
    logicReview: "The generator and discriminator objectives directly connect conditional synthesis to class-aware evaluation."
  };
  const issues = validateTaskFields(task, {
    fields: {
      ...common,
      contributions: "High-resolution samples are more than twice as discriminable and achieve a 50% improvement."
    }
  });
  assert.ok(issues.some((issue) => /experimental result instead/i.test(issue)));
  assert.deepEqual(validateTaskFields(task, {
    fields: {
      ...common,
      contributions: "The paper introduces an auxiliary classifier GAN architecture that jointly predicts source and class labels."
    }
  }), []);
});

test("exhausted model repairs use grounded extractive evidence instead of leaving poster fields empty", async () => {
  const result = await runPaperAgent({
    text: paper,
    options: { verify: false, maxTaskRounds: 2 },
    callModel: async (request) => {
      const taskId = request.messages[1].content.match(/- id: ([a-z]+)/)?.[1];
      const task = READING_PLAN.find((item) => item.id === taskId);
      if (taskId === "problem") {
        return { content: JSON.stringify({
          status: "insufficient_evidence",
          fields: { problem: "not found in provided context", motivation: "not found in provided context" },
          evidence: []
        }) };
      }
      return taskResponse(task);
    }
  });

  const problemTask = result.agent.plan.find((task) => task.id === "problem");
  assert.equal(problemTask.status, "completed");
  assert.equal(problemTask.fallbackUsed, true);
  assert.ok(problemTask.evidenceCount > 0);
  assert.doesNotMatch(result.analysis.problem, /not found in provided context/i);
  assert.equal(result.agent.metrics.insufficientReadingTasks, 0);
  assert.equal(result.agent.metrics.taskCompletion, 100);
});

test("reflection rejects a correction containing a number absent from the paper", async () => {
  let calls = 0;
  const result = await runPaperAgent({
    text: paper,
    callModel: async () => {
      const callIndex = calls++;
      if (callIndex < READING_PLAN.length) return taskResponse(READING_PLAN[callIndex]);
      return { content: JSON.stringify({
        verdict: "revise",
        summary: "A numeric claim was proposed.",
        confidence: 0.6,
        checks: [],
        corrections: { results: "The model reaches 99.9% accuracy." }
      }) };
    }
  });
  assert.equal(result.analysis.results, fieldValues.results);
  assert.match(result.agent.verification.rejectedCorrections.results, /99\.9%/);
  assert.deepEqual(result.agent.verification.appliedCorrections, {});
});

test("recalls paper memory for each task while keeping source evidence authoritative", async () => {
  const prompts = [];
  const result = await runPaperAgent({
    text: paper,
    options: { verify: false },
    memory: {
      paperId: "paper:test",
      metadata: { title: "Attention Study" },
      sectionSummaries: { method: { summary: "Prior method note", evidenceLocations: ["Method"] } },
      annotations: ["My critique: inspect the attention assumption."],
      unresolvedQuestions: ["Does the experiment isolate attention?"]
    },
    callModel: async (request) => {
      prompts.push(request.messages[1].content);
      const taskId = request.messages[1].content.match(/- id: ([a-z]+)/)?.[1];
      return taskResponse(READING_PLAN.find((task) => task.id === taskId));
    }
  });
  assert.equal(result.agent.memory.used, true);
  assert.ok(result.agent.memory.recalledItems > 0);
  assert.equal(result.agent.tools.filter((tool) => tool.name === "memory.recall").length, READING_PLAN.length);
  assert.ok(prompts.some((prompt) => prompt.includes("My critique")));
  assert.ok(prompts.every((prompt) => prompt.includes("not paper evidence")));
});
