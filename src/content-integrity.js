(function registerPaperContentIntegrity(global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PaperContentIntegrity = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, () => {
  const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const ROMAN_VALUES = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

  function cleanPhaseTitle(value) {
    return String(value || "")
      .replace(/\\(?:textbf|emph|section|subsection)\{([^}]*)\}/g, "$1")
      .replace(/[{}*_#]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[.;:,\-\s]+$/g, "")
      .trim()
      .slice(0, 80);
  }

  function phaseNumber(value) {
    const token = String(value || "").toLowerCase();
    return /^\d+$/.test(token) ? Number(token) : Number(ROMAN_VALUES[token] || 0);
  }

  function extractOrderedPhases(sourceText) {
    const phases = new Map();
    const pattern = /\bphase\s*[-–—:]?\s*(i{1,3}|iv|v|vi{0,3}|ix|x|\d{1,2})\s*[:.\-–—]\s*([^\n\r]{2,100})/gi;
    for (const match of String(sourceText || "").matchAll(pattern)) {
      const number = phaseNumber(match[1]);
      const title = cleanPhaseTitle(match[2].split(/(?<=[a-z)])\.(?:\s|$)/i)[0]);
      if (number > 0 && number <= 10 && title && !phases.has(number)) phases.set(number, title);
    }
    const ordered = [...phases].sort((left, right) => left[0] - right[0]);
    if (ordered.length < 3 || ordered.some(([number], index) => number !== index + 1)) return [];
    return ordered.map(([number, title]) => ({ number, title }));
  }

  function joinList(values) {
    if (values.length < 2) return values[0] || "";
    return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
  }

  function repairPhaseNarrative(value, sourceText) {
    const text = String(value || "").trim();
    const phases = extractOrderedPhases(sourceText);
    if (!text || !phases.length) return text;
    const countWord = NUMBER_WORDS[phases.length] || String(phases.length);
    const sequence = joinList(phases.map((phase) => phase.title));
    const clause = /\b((?:the\s+)?(?:pipeline|process|workflow|framework|method)[^.]{0,90}?\b(?:proceeds|operates|runs|unfolds|consists)\s+(?:in|through|of)\s+)(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)([- ]phases?\s*:\s*)([^.]*?)(?=,\s*where\b|[.;])/i;
    let repaired = text.replace(clause, (_match, lead, suffix) => `${lead}${countWord}${suffix}${sequence}`);
    repaired = repaired.replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?=-phase\b)/gi, countWord);
    repaired = repaired.replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?=\s+phases?\b)/gi, countWord);
    return repaired;
  }

  return { extractOrderedPhases, repairPhaseNarrative };
});
