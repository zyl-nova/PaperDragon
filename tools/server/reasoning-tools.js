const { ToolRegistry } = require("../../agent/tool-registry");
const { createContextSelectTool } = require("./context-select");
const { createMemoryRecallTool } = require("./memory-recall");
const { createEvidenceRetrieveTool } = require("./evidence-retrieve");
const { createLlmAnalyzeTool } = require("./llm-analyze");
const { createReflectionAuditTool } = require("./reflection-audit");
const { createLlmVerifyTool } = require("./llm-verify");

function createReasoningTools({ trace = [], onEvent = () => {}, callModel, options = {} }) {
  const tools = new ToolRegistry({ trace, onEvent });
  [
    createContextSelectTool(),
    createMemoryRecallTool(),
    createEvidenceRetrieveTool(),
    createLlmAnalyzeTool({ callModel, options }),
    createReflectionAuditTool(),
    createLlmVerifyTool({ callModel, options })
  ].forEach((tool) => tools.register(tool));
  return tools;
}

module.exports = { createReasoningTools };
