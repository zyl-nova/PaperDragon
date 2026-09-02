const { ToolRegistry } = require("./tool-registry");
const { createPosterVisionReviewTool } = require("../tools/server/poster-vision-review");
const { createPosterContentRefineTool } = require("../tools/server/poster-content-refine");

async function runPosterReviewAgent({
  imageDataUrl,
  metrics,
  posterContent = {},
  paperContext = {},
  stage = "final",
  iteration = 1,
  previousReview = null,
  callModel,
  callTextModel,
  onEvent = () => {},
  options = {}
}) {
  const trace = [];
  const tools = new ToolRegistry({ trace, onEvent });
  tools.register(createPosterVisionReviewTool({ callModel, options }));
  if (typeof callTextModel === "function") {
    tools.register(createPosterContentRefineTool({
      callModel: callTextModel,
      options: {
        maxTokens: options.contentMaxTokens || 1800,
        timeoutMs: options.contentTimeoutMs || 60000
      }
    }));
  }
  onEvent({ stage: "visual-review", message: `Inspecting poster ${stage} stage (iteration ${iteration}).` });
  const result = await tools.execute("vision.poster-review", {
    imageDataUrl,
    metrics,
    posterContent,
    paperContext,
    stage,
    iteration,
    previousReview
  });
  onEvent({
    stage: "visual-review",
    message: `Visual review completed at ${result.review.overallScore}/100.`,
    review: result.review
  });
  let contentRefinement = { status: "skipped", revisions: {}, rejected: {} };
  if (["content", "final"].includes(stage) && result.review.contentRequests.length && typeof callTextModel === "function") {
    try {
      onEvent({ stage: "content-refinement", message: `Refining ${result.review.contentRequests.length} poster section(s) against paper evidence.` });
      const refined = await tools.execute("poster.content-refine", {
        posterContent,
        paperContext,
        requests: result.review.contentRequests
      });
      contentRefinement = { status: "completed", revisions: refined.revisions, rejected: refined.rejected };
    } catch (error) {
      contentRefinement = {
        status: "unavailable",
        revisions: {},
        rejected: {},
        error: String(error?.message || "Content refinement failed.").slice(0, 240)
      };
    }
  }
  return {
    review: result.review,
    contentRefinement,
    agent: {
      mode: "multimodal-poster-critic-refiner",
      stage,
      iteration,
      tools: trace,
      toolManifest: tools.manifest()
    }
  };
}

module.exports = { runPosterReviewAgent };
