function normalizeArchivePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function cleanLatexInline(text) {
  return String(text || "")
    .replace(/\\cite[tpa]?\{[^}]*\}/g, "")
    .replace(/\\ref\{([^}]*)\}/g, "$1")
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLatexCaption(block) {
  const start = block.search(/\\caption(?:\[[^\]]*\])?\{/);
  if (start === -1) return "";
  const open = block.indexOf("{", start);
  if (open === -1) return "";
  let depth = 0;
  for (let index = open; index < block.length; index += 1) {
    const char = block[index];
    const prev = block[index - 1];
    if (char === "{" && prev !== "\\") depth += 1;
    if (char === "}" && prev !== "\\") depth -= 1;
    if (depth === 0) return cleanLatexInline(block.slice(open + 1, index));
  }
  return "";
}

function extractLatexTitle(text) {
  const rawTitle = extractLatexTitleRaw(text);
  return rawTitle ? cleanLatexTitle(removeBalancedCommand(rawTitle, "thanks")) : "";
}

function extractLatexTitleLines(text) {
  const rawTitle = extractLatexTitleRaw(text);
  if (!rawTitle) return [];
  const withoutNotes = removeBalancedCommand(rawTitle, "thanks");
  const chunks = withoutNotes.split(/\\\\/);
  return chunks.length > 1 ? chunks.map(cleanLatexTitle).filter(Boolean) : [];
}

function extractLatexTitleRaw(text) {
  const source = String(text || "");
  const marker = /\\title\s*(?:\[[^\]]*\]\s*)?\{/.exec(source);
  if (!marker) return "";
  const open = source.indexOf("{", marker.index);
  if (open === -1) return "";
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (char === "{" && previous !== "\\") depth += 1;
    if (char === "}" && previous !== "\\") depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  return "";
}

function cleanLatexTitle(value) {
  let title = String(value || "");
  title = removeBalancedCommand(title, "thanks");
  for (let pass = 0; pass < 4; pass += 1) {
    title = title.replace(/\\(?:textbf|textit|emph|textrm|textsf|texttt|mbox)\s*\{([^{}]*)\}/g, "$1");
  }
  return title
    .replace(/\\\\/g, " ")
    .replace(/\\(?:&|%|#|_|\$)/g, "$1")
    .replace(/\\[A-Za-z@]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeBalancedCommand(text, command) {
  let output = String(text || "");
  const pattern = new RegExp(`\\\\${command}\\s*\\{`, "g");
  let match;
  while ((match = pattern.exec(output))) {
    const open = output.indexOf("{", match.index);
    let depth = 0;
    let end = -1;
    for (let index = open; index < output.length; index += 1) {
      if (output[index] === "{" && output[index - 1] !== "\\") depth += 1;
      if (output[index] === "}" && output[index - 1] !== "\\") depth -= 1;
      if (depth === 0) { end = index; break; }
    }
    if (end === -1) break;
    output = output.slice(0, match.index) + output.slice(end + 1);
    pattern.lastIndex = match.index;
  }
  return output;
}

function latexToPlainText(text) {
  const body = text.split(/\\begin\{document\}/)[1] || text;
  return body
    .replace(/\\begin\{(?:equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|figure\*?|table\*?|tabular\*?)\}[\s\S]*?\\end\{(?:equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|figure\*?|table\*?|tabular\*?)\}/g, "\n")
    .replace(/\\(?:section|subsection|subsubsection)\*?\{([^}]*)\}/g, "\n## $1\n")
    .replace(/\\(?:title|author|date)\{([^}]*)\}/g, "\n$1\n")
    .replace(/\\begin\{abstract\}/g, "\n## Abstract\n")
    .replace(/\\end\{abstract\}/g, "\n")
    .replace(/\\(?:input|include)\{[^}]+\}/g, "\n")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 30000);
}

module.exports = { normalizeArchivePath, cleanLatexInline, extractLatexCaption, extractLatexTitle, extractLatexTitleLines, latexToPlainText };
