const test = require("node:test");
const assert = require("node:assert/strict");
const { runPosterReviewAgent } = require("./poster-review-agent");

test("poster reviewer composes visual criticism with evidence-grounded content refinement", async () => {
  const result = await runPosterReviewAgent({
    imageDataUrl: "data:image/jpeg;base64,abc",
    metrics: { poster: { width: 1600, height: 1000 } },
    posterContent: { motivation: "Attention removes recurrence and allows parallel training." },
    paperContext: { evidence: "Attention removes recurrence and allows parallel training." },
    callModel: async () => ({
      content: JSON.stringify({
        overallScore: 78,
        verdict: "revise",
        dimensions: { readability: 85, narrative: 62, contentSelection: 70, evidenceCommunication: 74, concision: 65 },
        issues: [{ panel: "motivation", severity: "medium", category: "vague_takeaway", observation: "The motivation lacks a direct takeaway." }],
        contentRequests: [{ field: "motivation", operation: "strengthen_takeaway", objective: "Lead with the parallelization gap.", maxSentences: 1 }]
      }),
      raw: { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }
    }),
    callTextModel: async () => ({
      content: JSON.stringify({ revisions: { motivation: "Removing recurrence enables parallel training." } }),
      raw: { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }
    })
  });

  assert.equal(result.agent.mode, "multimodal-poster-critic-refiner");
  assert.equal(result.contentRefinement.status, "completed");
  assert.equal(result.contentRefinement.revisions.motivation, "Removing recurrence enables parallel training.");
  assert.deepEqual(result.agent.tools.map((tool) => tool.name), ["vision.poster-review", "poster.content-refine"]);
});

test("asset production inspection never rewrites scientific prose", async () => {
  let textCalls = 0;
  const result = await runPosterReviewAgent({
    stage: "assets",
    imageDataUrl: "data:image/jpeg;base64,abc",
    posterContent: { method: "A compact method summary." },
    callModel: async () => ({
      content: JSON.stringify({
        overallScore: 82,
        verdict: "revise",
        issues: [{ panel: "theory", severity: "high", category: "clipping", observation: "Equation is cropped." }],
        contentRequests: [{ field: "method", operation: "clarify", objective: "Rewrite it." }]
      })
    }),
    callTextModel: async () => {
      textCalls += 1;
      return { content: JSON.stringify({ revisions: { method: "Changed." } }) };
    }
  });

  assert.equal(result.agent.stage, "assets");
  assert.equal(result.contentRefinement.status, "skipped");
  assert.equal(textCalls, 0);
});
