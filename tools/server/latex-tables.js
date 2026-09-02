const { extractLatexMacroDefinitions, expandLatexMacros } = require("./latex-formulas");
const { cleanLatexInline, extractLatexCaption } = require("./latex-utils");

function extractLatexTables(text) {
  const macros = extractLatexMacroDefinitions(text);
  return [...text.matchAll(/\\begin\{table\*?\}([\s\S]*?)\\end\{table\*?\}/g)]
    .map((match, index) => {
      const tabular = match[1].match(/\\begin\{tabular\*?\}(?:\{[^}]*\})?([\s\S]*?)\\end\{tabular\*?\}/);
      return {
        name: `Table ${index + 1}`,
        source: "table environment in LaTeX source",
        caption: extractLatexCaption(match[1]) || "caption not found",
        rows: tabular ? extractLatexTableRows(tabular[1], macros) : [],
        latex: `\\begin{table}\n${match[1]}\n\\end{table}`
      };
    })
    .slice(0, 12);
}

function extractLatexTableRows(body, macros = new Map()) {
  const rows = body
    .replace(/\\(?:toprule|midrule|bottomrule|hline|cline\{[^}]*\}|cmidrule(?:\([^)]*\))?\{[^}]*\})/g, "")
    .split(/\\\\(?:\[[^\]]*\])?/)
    .map((row) => row.split(/(?<!\\)&/).flatMap((cell) => expandLatexTableCell(cell, macros)))
    .filter((row) => row.length > 1 && row.some(Boolean))
    .slice(0, 20);
  const columnCount = Math.min(24, Math.max(0, ...rows.map((row) => row.length)));
  return rows.map((row) => [...row.slice(0, columnCount), ...Array(Math.max(0, columnCount - row.length)).fill("")]);
}

function expandLatexTableCell(value, macros) {
  const expanded = expandLatexMacros(String(value || ""), macros).trim();
  const multicolumn = readLatexCommandArguments(expanded, "multicolumn", 3);
  if (!multicolumn) return [cleanLatexTableCell(expanded)];
  const span = Math.max(1, Math.min(24, Number(multicolumn.args[0]) || 1));
  return [cleanLatexTableCell(`${multicolumn.args[2]} ${multicolumn.rest}`), ...Array(span - 1).fill("")];
}

function readLatexCommandArguments(value, command, argumentCount) {
  const match = value.match(new RegExp(`^\\\\${command}\\s*`));
  if (!match) return null;
  let offset = match[0].length;
  const args = [];
  for (let argument = 0; argument < argumentCount; argument += 1) {
    while (/\s/.test(value[offset] || "")) offset += 1;
    if (value[offset] !== "{") return null;
    const start = offset + 1;
    let depth = 1;
    offset += 1;
    while (offset < value.length && depth > 0) {
      if (value[offset] === "{" && value[offset - 1] !== "\\") depth += 1;
      if (value[offset] === "}" && value[offset - 1] !== "\\") depth -= 1;
      offset += 1;
    }
    if (depth !== 0) return null;
    args.push(value.slice(start, offset - 1));
  }
  return { args, rest: value.slice(offset).trim() };
}

function cleanLatexTableCell(value) {
  const cleaned = String(value || "")
    .replace(/\\rule(?:\[[^\]]*\])?\{[^{}]*\}\{[^{}]*\}/g, "")
    .replace(/\\(?:hspace|vspace)\*?\{[^{}]*\}/g, "")
    .replace(/\\(?:kern|mkern)\s*-?[\d.]+(?:pt|ex|em|mu)/g, "")
    .replace(/\\(?:phantom|vphantom|hphantom)\{[^{}]*\}/g, "")
    .replace(/\\multirow\{[^{}]*\}\{[^{}]*\}\{([^{}]*)\}/g, "$1")
    .replace(/\\multicolumn\{\d+\}\{[^{}]*\}\{([^{}]*)\}/g, "$1")
    .replace(/\\(?:centering|raggedright|raggedleft|arraybackslash)\b/g, "")
    .replace(/^\s*\[[^\]]*(?:pt|ex|em)\]\s*/, "")
    .trim();
  return cleaned.split(/(\$[^$]*\$|\\\([\s\S]*?\\\))/g)
    .map((part) => (/^\$|^\\\(/.test(part) ? part.trim() : cleanLatexInline(part)))
    .join("").replace(/\s+/g, " ").trim();
}

function createLatexTableTool() {
  return {
    name: "latex.tables",
    description: "Parsing LaTeX table structures",
    stage: "extraction",
    runtime: "server",
    inputTypes: ["arxiv"],
    run: ({ latex }) => extractLatexTables(latex),
    summarize: (items) => `${items.length} table structures extracted.`
  };
}

module.exports = { createLatexTableTool, extractLatexTables, extractLatexTableRows };
