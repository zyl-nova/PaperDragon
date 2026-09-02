(function registerPosterExportTools(global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PosterExportTools = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, () => {
  function posterSentences(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return [];
    const decimalSafe = normalized
      .replace(/(\d)\.(\d)/g, "$1\uE000$2")
      .replace(/\b(e)\.\s*(g)\./gi, "$1\uE001$2\uE001")
      .replace(/\b(i)\.\s*(e)\./gi, "$1\uE001$2\uE001")
      .replace(/\b(et)\s+(al)\./gi, "$1 $2\uE001")
      .replace(/\b(v)\.\s*(s)\./gi, "$1\uE001$2\uE001")
      .replace(/\bvs\./gi, "vs\uE001")
      .replace(/\bw\.r\.t\./gi, "w\uE001r\uE001t\uE001");
    const sentences = decimalSafe.match(/[^.!?\u3002\uff01\uff1f]+[.!?\u3002\uff01\uff1f]?/g) || [decimalSafe];
    return sentences
      .map((sentence) => sentence.replace(/[\uE000\uE001]/g, ".").trim())
      .filter(Boolean);
  }

  function finishPosterPoint(text) {
    const point = String(text || "").replace(/[\s,\uFF0C;\uFF1B:\uFF1A-]+$/g, "").trim();
    if (!point || /[.!?\u3002\uff01\uff1f]$/.test(point)) return point;
    return `${point}${/[\u3400-\u9fff]/.test(point) ? "\u3002" : "."}`;
  }

  function cleanPosterTitle(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\b((?:19|20)\d{2})([A-Z][a-z]{2,})/g, "$1 $2")
      .replace(/\s+(?:abstract|introduction|keywords?)\s*$/i, "")
      .trim();
  }

  function resolvePosterTitle(sourceTitle, textTitle, modelTitle) {
    const candidates = [sourceTitle, textTitle, modelTitle].map(cleanPosterTitle);
    return candidates.find((title) => title.length >= 5 && !/^(?:untitled|page\s+\d+|main source file)$/i.test(title))
      || "Untitled Paper Poster";
  }

  function splitPosterTitle(value, singleLineLimit = 55) {
    const title = cleanPosterTitle(value);
    if (!title || title.length <= singleLineLimit) return title ? [title] : [];
    const minimum = Math.floor(title.length * 0.3);
    const maximum = Math.ceil(title.length * 0.7);
    const candidates = [];
    for (let index = minimum; index <= maximum; index += 1) {
      const char = title[index];
      if (char === " " || /[:：–—]/.test(title[index - 1] || "")) {
        const left = title.slice(0, index).trim();
        const right = title.slice(index).trim();
        if (left && right) {
          const punctuationBonus = /[:：–—]$/.test(left) ? 10 : 0;
          candidates.push({ left, right, score: Math.abs(left.length - right.length) - punctuationBonus });
        }
      }
    }
    const selected = candidates.sort((a, b) => a.score - b.score)[0];
    return selected ? [selected.left, selected.right] : [title];
  }

  function compactPosterPoints(text, maxItems = 3, maxChars = 520) {
    const points = [];
    let usedChars = 0;
    for (const sentence of posterSentences(text)) {
      if (points.some((point) => point.toLowerCase() === sentence.toLowerCase())) continue;
      if (points.length && usedChars >= maxChars) break;
      // maxChars is a soft panel budget. A complete scientific claim is more
      // important than forcing the final sentence to fit by cutting its tail.
      const point = finishPosterPoint(sentence);
      points.push(point);
      usedChars += point.length;
      if (points.length >= maxItems) break;
    }
    return points;
  }

  function posterEmphasisMatches(text, maxMatches = 3) {
    const value = String(text || "");
    const candidates = [];
    const addMatches = (pattern, kind, priority, accept = () => true) => {
      for (const match of value.matchAll(pattern)) {
        const matchedText = match[0];
        if (!accept(matchedText, match.index || 0)) continue;
        candidates.push({
          start: match.index || 0,
          end: (match.index || 0) + matchedText.length,
          text: matchedText,
          kind,
          priority
        });
      }
    };

    addMatches(
      /\b\d+(?:\.\d+)?\s*(?:%|BLEU|F1|mAP|AUC|FLOPs?|parameters?|GPUs?|days?|hours?)\b/gi,
      "metric",
      3
    );
    addMatches(
      /\b(?:(?:scaled|multi|cross|masked|sparse|global|local)\s+)?(?:[A-Za-z]+-){1,3}[A-Za-z]+(?:\s+(?:attention|model|mechanism|architecture|encoding|network|training|inference|learning|method|objective|criterion))?\b/gi,
      "term",
      2
    );
    const capitalizedStopWords = new Set(["The", "This", "These", "Those", "Their", "Our", "We", "It", "Training", "Model", "Method", "Results", "Figure", "Table"]);
    addMatches(
      /\b[A-Z][A-Za-z0-9]{3,}\b/g,
      "term",
      2,
      (matchedText) => !capitalizedStopWords.has(matchedText)
    );

    const selected = [];
    for (const candidate of candidates.sort((a, b) => b.priority - a.priority || a.start - b.start || b.end - a.end)) {
      if (selected.some((item) => candidate.start < item.end && candidate.end > item.start)) continue;
      selected.push(candidate);
      if (selected.length >= maxMatches) break;
    }
    return selected.sort((a, b) => a.start - b.start);
  }

  function appendEmphasizedPosterPoint(item, point) {
    const matches = posterEmphasisMatches(point);
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) item.append(point.slice(cursor, match.start));
      const emphasis = item.ownerDocument.createElement("strong");
      emphasis.className = `poster-key-term ${match.kind === "metric" ? "poster-key-metric" : ""}`.trim();
      emphasis.textContent = point.slice(match.start, match.end);
      item.append(emphasis);
      cursor = match.end;
    }
    if (cursor < point.length) item.append(point.slice(cursor));
  }

  function replaceWithPosterList(root, selector, options = {}) {
    const target = root.querySelector(selector);
    if (!target) return;
    const points = compactPosterPoints(target.textContent, options.maxItems, options.maxChars);
    if (!points.length) return;
    const list = root.ownerDocument.createElement("ul");
    list.id = target.id;
    list.className = "poster-key-points";
    for (const point of points) {
      const item = root.ownerDocument.createElement("li");
      appendEmphasizedPosterPoint(item, point);
      list.append(item);
    }
    target.replaceWith(list);
  }

  function mergePosterPanels(root, targetId, sourceId, title, subsectionTitle) {
    const target = root.querySelector(`[data-poster-section="${targetId}"]`);
    const source = root.querySelector(`[data-poster-section="${sourceId}"]`);
    if (!target || !source) return;
    const heading = target.querySelector("h3");
    if (heading) heading.textContent = title;
    const subsection = root.ownerDocument.createElement("div");
    subsection.className = "poster-merged-subsection";
    const label = root.ownerDocument.createElement("strong");
    label.className = "poster-subsection-title";
    label.textContent = subsectionTitle;
    subsection.append(label);
    for (const child of [...source.children]) {
      if (child.tagName !== "H3") subsection.append(child);
    }
    target.append(subsection);
    source.remove();
  }

  function preparePosterForExport(exportPosterNode) {
    exportPosterNode.classList.add("poster-export");
    // Evidence cues are UI chrome. Remove them before compacting text, then the
    // export pipeline annotates the finished nodes again.
    stripPosterEvidenceCues(exportPosterNode);
    exportPosterNode.querySelectorAll(".poster-evidence-trigger").forEach((node) => {
      node.classList.remove("poster-evidence-trigger");
      node.removeAttribute("tabindex");
      node.removeAttribute("role");
      node.removeAttribute("aria-label");
      delete node.dataset.evidenceTitle;
      delete node.dataset.evidenceKind;
      delete node.dataset.evidenceItems;
    });
    // MathJax's visible SVG is self-contained. Its hidden assistive MathML can
    // be reparsed as an open namespace and swallow following poster panels.
    exportPosterNode.querySelectorAll("mjx-assistive-mml").forEach((node) => node.remove());
    exportPosterNode.querySelectorAll(".poster-card").forEach((card) => {
      card.style.removeProperty("order");
      if (!card.getAttribute("style")) card.removeAttribute("style");
    });

    const heroSummary = exportPosterNode.querySelector(".poster-hero > div > p:not(.tag)");
    if (heroSummary) heroSummary.textContent = compactPosterPoints(heroSummary.textContent, 2, 300).join(" ");
    exportPosterNode.querySelector(".poster-hero .tag")?.remove();

    for (const [selector, maxItems, maxChars] of [
      ["#problemText", 2, 330],
      ["#motivationText", 3, 2000],
      ["#methodText", 3, 560],
      ["#resultText", 4, 720],
      ["#contributionText", 4, 680]
    ]) {
      replaceWithPosterList(exportPosterNode, selector, { maxItems, maxChars });
    }

    const theoryLead = exportPosterNode.querySelector("#formulaList .poster-section-lead");
    if (theoryLead) theoryLead.textContent = compactPosterPoints(theoryLead.textContent, 2, 360).join(" ");
    exportPosterNode.querySelectorAll(".asset-selection-summary, .formula-source, .agent-audit, .score-card").forEach((node) => node.remove());
    exportPosterNode.querySelector('[data-poster-section="logic"]')?.remove();
    exportPosterNode.querySelector('[data-poster-section="quality"]')?.remove();
    exportPosterNode.querySelectorAll("[data-poster-section][hidden]").forEach((node) => node.remove());

    mergePosterPanels(exportPosterNode, "problem", "motivation", "Problem & Motivation", "Motivation");
  }

  function stripPosterEvidenceCues(root) {
    root?.querySelectorAll?.(".poster-evidence-cue").forEach((node) => node.remove());
  }

  return { cleanPosterTitle, resolvePosterTitle, compactPosterPoints, posterEmphasisMatches, splitPosterTitle, preparePosterForExport, stripPosterEvidenceCues };
});
