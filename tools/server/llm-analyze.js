const { buildTaskAnalysisPrompt } = require("../../agent/prompts");

function createLlmAnalyzeTool({ callModel, options = {} }) {
  return {
    name: "llm.analyze",
    description: "Running one evidence-grounded reading task",
    stage: "analysis",
    run: ({ task, context, observation, memory }) => callModel({
      messages: [
        { role: "system", content: "You are an evidence-grounded academic paper reading agent." },
        { role: "user", content: buildTaskAnalysisPrompt(task, context, observation, memory) }
      ],
      maxTokens: options.analysisMaxTokens || 3200,
      timeoutMs: options.analysisTimeoutMs || 70000,
      textChars: context.length
    }),
    summarize: (result, input) => `${input.task.label} response received (${String(result?.content || "").length} chars).`,
    metrics: (result, input) => modelMetrics(result, input.context)
  };
}

function modelMetrics(result, inputText) {
  const usage = result?.raw?.usage || {};
  const inputChars = String(inputText || "").length;
  const outputChars = String(result?.content || "").length;
  const hasUsage = Number.isFinite(Number(usage.prompt_tokens));
  const inputTokens = hasUsage ? Number(usage.prompt_tokens) : Math.ceil(inputChars / 4);
  const outputTokens = Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : Math.ceil(outputChars / 4);
  return {
    inputChars,
    outputChars,
    inputTokens,
    outputTokens,
    totalTokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : inputTokens + outputTokens,
    tokenEstimate: !hasUsage
  };
}

module.exports = { createLlmAnalyzeTool, modelMetrics };
