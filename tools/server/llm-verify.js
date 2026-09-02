const { buildVerificationPrompt } = require("../../agent/prompts");
const { modelMetrics } = require("./llm-analyze");

function createLlmVerifyTool({ callModel, options = {} }) {
  return {
    name: "llm.verify",
    description: "Verifying evidence grounding and argument consistency",
    stage: "verification",
    run: ({ analysis, context, audit, evidence, sourceProfile }) => callModel({
      messages: [
        { role: "system", content: "You verify academic analyses and correct only unsupported claims." },
        { role: "user", content: buildVerificationPrompt(analysis, context, audit, evidence, sourceProfile) }
      ],
      maxTokens: options.verificationMaxTokens || 1400,
      timeoutMs: options.verificationTimeoutMs || 50000,
      textChars: context.length
    }),
    summarize: () => "Verification response received.",
    metrics: (result, input) => modelMetrics(result, input.context)
  };
}

module.exports = { createLlmVerifyTool };
