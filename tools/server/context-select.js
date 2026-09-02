const { buildPaperContext } = require("../../agent/context");

function createContextSelectTool() {
  return {
    name: "context.select",
    description: "Gathering, selecting, structuring, and compressing task-relevant paper context",
    stage: "context",
    run: ({ paperText, tasks, maxChars, taskMaxChars }) => buildPaperContext(paperText, {
      tasks,
      maxChars,
      taskMaxChars
    }),
    summarize: (bundle) => `GSSC selected ${bundle.stats.selectedChunks}/${bundle.stats.gatheredChunks} chunks for ${bundle.stats.structuredTasks} tasks; ${bundle.stats.contextChars} verification chars.`
  };
}

module.exports = { createContextSelectTool };
