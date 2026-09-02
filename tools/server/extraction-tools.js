const { ToolRegistry } = require("../../agent/tool-registry");
const { createArxivSourceTool } = require("./arxiv-source");
const { createLatexFormulaTool } = require("./latex-formulas");
const { createLatexFigureTool } = require("./latex-figures");
const { createLatexTableTool } = require("./latex-tables");
const { createPdfTableCropTool } = require("./pdf-table-crop");

function createExtractionTools({ trace = [], onEvent = () => {}, deps }) {
  const tools = new ToolRegistry({ trace, onEvent });
  [
    createArxivSourceTool(),
    createLatexFormulaTool(),
    createLatexFigureTool({ assetCache: deps.assetCache }),
    createLatexTableTool(),
    createPdfTableCropTool()
  ].forEach((tool) => tools.register(tool));
  return tools;
}

module.exports = { createExtractionTools };
