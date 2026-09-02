(function registerPosterInteractionTool(global) {
  const SECTION_SPECS = [
    { section: "problem", selector: "#problemText", fields: ["problem", "summary"], title: "Problem" },
    { section: "motivation", selector: "#motivationText", fields: ["motivation", "problem"], title: "Motivation" },
    { section: "method", selector: "#methodText", fields: ["method", "methodSupportsProblem"], title: "Method Overview" },
    { section: "theory", selector: "#formulaList .poster-section-lead", fields: ["theory", "method"], title: "Key Mechanism" },
    { section: "results", selector: "#resultText", fields: ["results", "experiments", "experimentsValidateClaims"], title: "Main Experimental Results" },
    { section: "contribution", selector: "#contributionText", fields: ["contributions", "innovation", "logicReview"], title: "Contributions" }
  ];
  const STOP_WORDS = new Set([
    "about", "after", "again", "against", "also", "because", "been", "being", "between", "both", "could",
    "from", "have", "into", "more", "most", "only", "other", "paper", "proposed", "such", "than", "that",
    "their", "there", "these", "this", "those", "through", "using", "very", "where", "which", "while", "with",
    "would", "method", "model", "result", "results", "approach", "framework"
  ]);

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  }

  function tokens(value) {
    return [...new Set(normalize(value).split(" ").filter((token) => token.length >= 4 && !STOP_WORDS.has(token)))];
  }

  function splitSourcePages(sourceText) {
    const source = String(sourceText || "").replace(/\r/g, "");
    const marker = /^##\s*Page\s+(\d+)\s*$/gim;
    const matches = [...source.matchAll(marker)];
    if (!matches.length) return [{ page: null, text: source }];
    return matches.map((match, index) => ({
      page: Number(match[1]),
      text: source.slice(match.index + match[0].length, matches[index + 1]?.index ?? source.length)
    }));
  }

  function sourceSentences(sourceText) {
    return splitSourcePages(sourceText).flatMap(({ page, text }) => {
      const cleaned = text
        .replace(/^#{1,6}\s+.*$/gm, " ")
        .replace(/\s+/g, " ")
        .trim();
      const values = cleaned.match(/[^.!?。！？]+[.!?。！？]?/g) || [];
      return values.map((value) => ({ page, quote: value.trim() }))
        .filter((item) => item.quote.length >= 36 && item.quote.length <= 700)
        .filter((item) => !hasMergedSectionBoundary(item.quote))
        .filter((item) => !/^(?:figure|fig\.|table)\s*\d+/i.test(item.quote))
        .filter((item) => !/\b(?:references|bibliography)\b/i.test(item.quote));
    });
  }

  function hasMergedSectionBoundary(value) {
    const quote = String(value || "").replace(/\s+/g, " ").trim();
    return /[a-z0-9,)]\s+(?:In recent years|Recently,|Abstract\b|Introduction\b|Related Work\b|Methodology\b|Experiments?\b)\s+(?:In |We |The |Recent)/i.test(quote);
  }

  function coreSectionQuery(analysis, spec) {
    const primary = String(analysis?.[spec.fields[0]] || "").replace(/\s+/g, " ").trim();
    const sentences = primary.match(/[^.!?。！？]+[.!?。！？]?/g) || [primary];
    const core = sentences.slice(0, 2).join(" ").trim();
    if (core.length >= 80) return core.slice(0, 900);
    return spec.fields.map((field) => analysis?.[field] || "").join(" ").slice(0, 900);
  }

  function findGroundedExcerpts(sourceText, query, limit = 2) {
    const queryTokens = tokens(query);
    if (!queryTokens.length) return [];
    return sourceSentences(sourceText)
      .map((item) => {
        const sentenceTokens = new Set(tokens(item.quote));
        const overlap = queryTokens.filter((token) => sentenceTokens.has(token));
        const phraseBonus = queryTokens.some((token) => token.length >= 8 && normalize(item.quote).includes(token)) ? 2 : 0;
        return { ...item, overlapCount: overlap.length, score: overlap.length * 3 + phraseBonus };
      })
      .filter((item) => item.overlapCount >= 2 && item.score >= 6)
      .sort((left, right) => right.score - left.score || left.quote.length - right.quote.length)
      .filter((item, index, items) => items.findIndex((other) => normalize(other.quote) === normalize(item.quote)) === index)
      .slice(0, limit)
      .map((item) => ({
        quote: item.quote,
        location: item.page ? `Uploaded PDF, page ${item.page}` : "Original paper text",
        page: item.page
      }));
  }

  function evidenceRelevance(item, query) {
    if (hasMergedSectionBoundary(item?.quote)) return 0;
    const queryTokens = tokens(query);
    if (!queryTokens.length) return 0;
    const quoteTokens = new Set(tokens(item?.quote || ""));
    const shared = queryTokens.filter((token) => quoteTokens.has(token)).length;
    return shared / Math.max(1, Math.min(queryTokens.length, quoteTokens.size));
  }

  function sectionEvidence(viewer, analysis, sourceText, spec) {
    const query = coreSectionQuery(analysis, spec);
    const existing = viewer.evidenceForSection(
      analysis?._agent?.evidence || analysis?.evidence || {},
      spec.section
    );
    const relevant = existing
      .map((item) => ({ item, relevance: evidenceRelevance(item, query) }))
      .filter((entry) => entry.relevance >= 0.28)
      .sort((left, right) => right.relevance - left.relevance)
      .map((entry) => entry.item)
      .slice(0, 3);
    if (relevant.length) return relevant;
    return findGroundedExcerpts(sourceText, query, 3);
  }

  function formulaEvidence(formula, formulaImage, index) {
    if (formulaImage) {
      const location = String(formulaImage.source || "Uploaded PDF").trim();
      const page = Number(location.match(/(?:page|p\.?)\s*(\d+)/i)?.[1]) || null;
      return {
        title: formulaImage.name || `Formula ${index + 1}`,
        items: [{
          quote: String(formulaImage.caption || formulaImage.name || "Formula from the original paper").trim(),
          location,
          page
        }]
      };
    }
    return {
      title: `Selected formula ${index + 1}`,
      items: [{ quote: String(formula || "").trim(), location: "Original LaTeX source", page: null }]
    };
  }

  function enhancePosterInteractions({ root, analysis = {}, sourceText = "" } = {}) {
    const viewer = global.PosterEvidenceViewer;
    if (!root || !viewer?.setEvidenceData) throw new Error("Poster evidence viewer is unavailable.");
    viewer.annotatePoster(root, analysis);

    let sectionCount = 0;
    for (const spec of SECTION_SPECS) {
      const target = root.querySelector(spec.selector);
      if (!target) continue;
      const items = sectionEvidence(viewer, analysis, sourceText, spec);
      if (viewer.setEvidenceData(target, { title: spec.title, kind: "claim", items })) sectionCount += 1;
    }

    const formulas = Array.isArray(analysis.formulas) ? analysis.formulas : [];
    const formulaImages = Array.isArray(analysis.formulaImages) ? analysis.formulaImages : [];
    let formulaCount = 0;
    [...root.querySelectorAll("#formulaList .formula")].forEach((node, index) => {
      const payload = formulaEvidence(formulas[index], formulaImages[index], index);
      if (viewer.setEvidenceData(node, { ...payload, kind: "formula" })) formulaCount += 1;
    });

    return {
      sections: sectionCount,
      formulas: formulaCount,
      assets: root.querySelectorAll("figure.paper-figure.poster-evidence-trigger").length,
      total: root.querySelectorAll(".poster-evidence-trigger").length
    };
  }

  global.PaperToolAlgorithms ||= {};
  global.PaperToolAlgorithms.splitPosterSourcePages = splitSourcePages;
  global.PaperToolAlgorithms.findPosterGroundedExcerpts = findGroundedExcerpts;
  global.PaperToolAlgorithms.posterEvidenceRelevance = evidenceRelevance;
  global.PaperToolAlgorithms.posterCoreSectionQuery = coreSectionQuery;
  global.PaperToolAlgorithms.posterEvidenceHasMergedSection = hasMergedSectionBoundary;
  global.PaperToolAlgorithms.enhancePosterInteractions = enhancePosterInteractions;
  global.PaperToolDefinitions ||= {};
  global.PaperToolDefinitions.posterInteractions = () => ({
    name: "poster.interactions",
    description: "Bind poster claims, formulas, figures, and tables to source evidence",
    stage: "reporting",
    runtime: "browser",
    inputTypes: [],
    run: enhancePosterInteractions,
    summarize: (result) => `${result.total} interactive evidence target(s): ${result.sections} sections, ${result.formulas} formulas, ${result.assets} visual assets.`
  });
})(typeof window !== "undefined" ? window : globalThis);
