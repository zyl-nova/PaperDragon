function extractLatexFormulas(text) {
  const formulas = [];
  const macros = extractLatexMacroDefinitions(text);
  const envPattern = /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)\}([\s\S]*?)\\end\{\1\}/g;
  for (const match of text.matchAll(envPattern)) {
    formulas.push(cleanLatexFormula(expandLatexMacros(`\\begin{${match[1]}}\n${match[2]}\n\\end{${match[1]}}`, macros)));
  }
  for (const match of text.matchAll(/\\\[([\s\S]*?)\\\]/g)) {
    formulas.push(cleanLatexFormula(expandLatexMacros(match[1], macros)));
  }
  for (const match of text.matchAll(/\$\$([\s\S]*?)\$\$/g)) {
    formulas.push(cleanLatexFormula(expandLatexMacros(match[1], macros)));
  }
  return uniqueBy(formulas.filter(isPlausibleLatexFormula), (item) => item.replace(/\s+/g, " ")).slice(0, 12);
}

function isPlausibleLatexFormula(value) {
  const source = String(value || "").trim();
  if (source.length < 3) return false;
  if (/\\(?:author|affiliation|institution|email|orcid|thanks)\b/i.test(source)) return false;
  const unwrapped = source
    .replace(/\\begin\{(?:equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)\}|\\end\{[^}]+\}/g, "")
    .replace(/\\(?:label|tag)\{[^}]*\}/g, "")
    .trim();
  if (/^[,;:'`.\s\p{L}-]+$/u.test(unwrapped)) return false;
  const hasRelationOrOperation = /[=<>≈≃∝±×÷+*/^_|]|\\(?:sum|prod|int|frac|sqrt|min|max|log|exp|argmin|argmax|mathbb|mathbf|mathrm|operatorname)\b/i.test(unwrapped);
  const hasStructuredFunction = /[A-Za-z]_[{A-Za-z0-9]|[A-Za-z]\s*\([^)]*[|,][^)]*\)/.test(unwrapped);
  return hasRelationOrOperation || hasStructuredFunction;
}

function extractLatexMacroDefinitions(text) {
  const macros = new Map();
  const balancedBody = "((?:[^{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*)";
  const commandPattern = new RegExp(`\\\\(?:newcommand|renewcommand|providecommand)\\s*\\{?\\\\([A-Za-z@]+)\\}?\\s*(?:\\[(\\d+)\\])?\\s*\\{${balancedBody}\\}`, "g");
  const defPattern = new RegExp(`\\\\(?:def|gdef|edef|xdef)\\s*\\\\([A-Za-z@]+)\\s*((?:#\\d\\s*)*)\\{${balancedBody}\\}`, "g");
  for (const match of text.matchAll(commandPattern)) macros.set(match[1], { args: Number(match[2] || 0), body: match[3] });
  for (const match of text.matchAll(defPattern)) {
    const args = Math.max(0, ...[...match[2].matchAll(/#(\d)/g)].map((item) => Number(item[1])));
    macros.set(match[1], { args, body: match[3] });
  }
  for (const macro of scanCommandMacros(text)) macros.set(macro.name, { args: macro.args, body: macro.body });
  return macros;
}

function scanCommandMacros(text) {
  const source = String(text || "");
  const results = [];
  const pattern = /\\(?:newcommand|renewcommand|providecommand)\s*/g;
  for (const match of source.matchAll(pattern)) {
    let cursor = match.index + match[0].length;
    let name = "";
    if (source[cursor] === "{") {
      const group = readBalancedGroup(source, cursor);
      name = group?.value.match(/^\\([A-Za-z@]+)$/)?.[1] || "";
      cursor = group?.end ?? cursor;
    } else {
      const command = source.slice(cursor).match(/^\\([A-Za-z@]+)/);
      name = command?.[1] || "";
      cursor += command?.[0]?.length || 0;
    }
    if (!name) continue;
    cursor = skipWhitespace(source, cursor);
    let args = 0;
    if (source[cursor] === "[") {
      const end = source.indexOf("]", cursor + 1);
      if (end < 0) continue;
      args = Number(source.slice(cursor + 1, end).trim() || 0);
      cursor = skipWhitespace(source, end + 1);
    }
    const body = readBalancedGroup(source, cursor);
    if (body) results.push({ name, args, body: body.value });
  }
  return results;
}

function readBalancedGroup(source, start) {
  if (source[start] !== "{") return null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) {
      return { value: source.slice(start + 1, index), end: index + 1 };
    }
  }
  return null;
}

function skipWhitespace(source, start) {
  let cursor = start;
  while (/\s/.test(source[cursor] || "")) cursor += 1;
  return cursor;
}

function expandLatexMacros(formula, macros) {
  let output = formula;
  for (let pass = 0; pass < 5; pass += 1) {
    let changed = false;
    for (const [name, macro] of macros) {
      const next = macro.args === 0
        ? output.replace(new RegExp(`\\\\${name}(?![A-Za-z@])`, "g"), () => `{${macro.body}}`)
        : expandParameterizedMacro(output, name, macro);
      if (next !== output) changed = true;
      output = next;
    }
    if (!changed) break;
  }
  return output;
}

function expandParameterizedMacro(source, name, macro) {
  const pattern = new RegExp(`\\\\${name}(?![A-Za-z@])`, "g");
  let output = "";
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    let argumentCursor = skipWhitespace(source, match.index + match[0].length);
    const args = [];
    for (let index = 0; index < macro.args; index += 1) {
      const group = readBalancedGroup(source, argumentCursor);
      if (!group) break;
      args.push(group.value);
      argumentCursor = skipWhitespace(source, group.end);
    }
    if (args.length !== macro.args) continue;
    output += source.slice(cursor, match.index);
    output += `{${macro.body.replace(/#(\d+)/g, (_, number) => args[Number(number) - 1] ?? "")}}`;
    cursor = argumentCursor;
  }
  return cursor ? output + source.slice(cursor) : source;
}

function cleanLatexFormula(value) {
  let output = value.replace(/\\label\{[^}]*\}/g, "");
  const wrappers = ["ensuremath", "mathclap", "tiny", "scriptsize", "footnotesize", "small"];
  for (let pass = 0; pass < 8; pass += 1) {
    let next = output;
    for (const name of wrappers) next = expandParameterizedMacro(next, name, { args: 1, body: "#1" });
    if (next === output) break;
    output = next;
  }
  return output.replace(/\n{3,}/g, "\n\n").trim();
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createLatexFormulaTool() {
  return {
    name: "latex.formulas",
    description: "Extracting exact LaTeX formulas",
    stage: "extraction",
    runtime: "server",
    inputTypes: ["arxiv"],
    run: ({ latex }) => extractLatexFormulas(latex),
    summarize: (items) => `${items.length} formulas extracted.`
  };
}

module.exports = { createLatexFormulaTool, extractLatexFormulas, extractLatexMacroDefinitions, expandLatexMacros, isPlausibleLatexFormula };
