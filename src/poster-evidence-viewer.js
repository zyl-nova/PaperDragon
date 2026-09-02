(function registerPosterEvidenceViewer(global, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.PosterEvidenceViewer = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, () => {
  const SECTION_EVIDENCE_KEYS = Object.freeze({
    problem: ["problem", "summary"],
    motivation: ["problem", "summary"],
    method: ["method"],
    theory: ["theory", "method"],
    results: ["results", "experiments"],
    contribution: ["contributions", "summary"]
  });
  const SECTION_TARGETS = Object.freeze({
    problem: "#problemText",
    motivation: "#motivationText",
    method: "#methodText",
    theory: "#formulaList .poster-section-lead",
    results: "#resultText",
    contribution: "#contributionText"
  });

  function cleanText(value, limit = 1200) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.slice(0, limit);
  }

  function cleanEvidenceQuote(value) {
    return cleanText(value, 1800)
      .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\/10\.\d{4,9}\/[\w.()/:;-]+\s*/i, "")
      .replace(/^org\/10\.\d{4,9}\/[\w.()/:;-]+\s*/i, "")
      .replace(/^(?:arxiv:\S+\s*)?(?:\[[^\]]{1,12}\]|[A-Za-z.]{1,8}\])\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s*/i, "")
      .trim();
  }

  function hasMergedSectionBoundary(value) {
    const quote = cleanText(value, 1800);
    return /[a-z0-9,)]\s+(?:In recent years|Recently,|Abstract\b|Introduction\b|Related Work\b|Methodology\b|Experiments?\b)\s+(?:In |We |The |Recent)/i.test(quote);
  }

  function pageFromLocation(value) {
    const text = cleanText(value, 240);
    const match = text.match(/(?:page|p\.?)[\s:#-]*(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function normalizeEvidenceItem(item) {
    if (!item || typeof item !== "object") return null;
    const quote = cleanEvidenceQuote(item.quote);
    const location = cleanText(item.location || item.source, 300) || "Paper context";
    if (/^(?:[A-Za-z][A-Za-z0-9_-]{0,12}|\d{1,3})[.)]$/.test(quote)) return null;
    if (hasMergedSectionBoundary(quote)) return null;
    const words = quote.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [];
    if (quote && (quote.length < 22 || words.length < 3)) return null;
    if (/\b(?:one|two|three|four|five|six|seven|eight|nine|\d+)\s+(?:tion|ment|ness|ity)\b/i.test(quote)) return null;
    if (!quote && !location) return null;
    return { quote, location, page: pageFromLocation(location) };
  }

  function evidenceForSection(evidence, section) {
    const keys = SECTION_EVIDENCE_KEYS[section] || [section];
    const seen = new Set();
    const items = [];
    for (const key of keys) {
      for (const raw of Array.isArray(evidence?.[key]) ? evidence[key] : []) {
        const item = normalizeEvidenceItem(raw);
        const signature = `${item?.quote}|${item?.location}`.toLowerCase();
        if (!item || seen.has(signature)) continue;
        seen.add(signature);
        items.push(item);
        if (items.length >= 4) return items;
      }
    }
    return items;
  }

  function setEvidenceData(node, payload) {
    if (!node || !payload?.items?.length) return false;
    node.classList.add("poster-evidence-trigger");
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `View source evidence for ${payload.title}`);
    node.dataset.evidenceTitle = cleanText(payload.title, 180);
    node.dataset.evidenceKind = cleanText(payload.kind || "claim", 40);
    node.dataset.evidenceItems = JSON.stringify(payload.items);
    node.querySelectorAll(":scope > .poster-evidence-cue").forEach((cue) => cue.remove());
    return true;
  }

  function annotatePoster(root, analysis = {}) {
    if (!root) return { sections: 0, assets: 0 };
    const evidence = analysis?._agent?.evidence || analysis?.evidence || {};
    let sections = 0;
    let assets = 0;

    for (const card of root.querySelectorAll("[data-poster-section]")) {
      const section = card.dataset.posterSection;
      const items = evidenceForSection(evidence, section);
      const title = card.querySelector("h3")?.textContent || section;
      const target = card.querySelector(SECTION_TARGETS[section] || "p, ul");
      if (setEvidenceData(target, { title, kind: "claim", items })) sections += 1;
    }

    for (const figure of root.querySelectorAll("figure.paper-figure")) {
      const caption = figure.querySelector("figcaption");
      const title = caption?.querySelector("strong")?.textContent || "Paper artwork";
      const source = [...(caption?.querySelectorAll("small") || [])]
        .map((node) => node.textContent.replace(/^Source:\s*/i, "").trim())
        .find(Boolean) || "Original paper artwork";
      const description = [...(caption?.querySelectorAll("span") || [])]
        .map((node) => node.textContent.trim()).find(Boolean) || title;
      const item = normalizeEvidenceItem({ quote: description, location: source });
      if (item && setEvidenceData(figure, { title, kind: "asset", items: [item] })) assets += 1;
    }

    return { sections, assets };
  }

  function standaloneScript() {
    return String.raw`(() => {
  const selector = ".poster-evidence-trigger";
  const escapeHtml = (value) => String(value || "").replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const readItems = (trigger) => {
    try { return JSON.parse(trigger.dataset.evidenceItems || "[]"); } catch { return []; }
  };
  const ensureViewer = () => {
    let viewer = document.querySelector(".poster-evidence-viewer");
    if (viewer) return viewer;
    viewer = document.createElement("div");
    viewer.className = "poster-evidence-viewer";
    viewer.hidden = true;
    viewer.innerHTML = '<div class="poster-evidence-backdrop" data-evidence-close></div><section class="poster-evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="posterEvidenceTitle"><button class="poster-evidence-close" type="button" data-evidence-close aria-label="Close evidence viewer">&times;</button><header><div><span class="poster-evidence-eyebrow">SOURCE EVIDENCE</span><h2 id="posterEvidenceTitle"></h2></div><div class="poster-evidence-header-actions"><a class="poster-evidence-paper-link" target="_blank" rel="noopener noreferrer" hidden>Open paper</a></div></header><div class="poster-evidence-feedback" role="status" aria-live="polite"></div><div class="poster-evidence-body"></div></section>';
    document.body.append(viewer);
    viewer.addEventListener("click", async (event) => {
      if (event.target.closest("[data-evidence-close]")) return closeViewer(viewer);
      const zoom = event.target.closest("[data-evidence-zoom]");
      if (zoom) return updateImageScale(viewer, zoom.dataset.evidenceZoom);
      const copy = event.target.closest("[data-evidence-copy]");
      if (copy) await copyEvidence(viewer, Number(copy.dataset.evidenceCopy), copy);
    });
    return viewer;
  };
  let previousFocus = null;
  const focusable = (viewer) => [...viewer.querySelectorAll('a[href]:not([hidden]), button:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((node) => !node.hidden);
  const setFeedback = (viewer, message) => {
    const feedback = viewer.querySelector(".poster-evidence-feedback");
    if (feedback) feedback.textContent = message || "";
  };
  const updateImageScale = (viewer, action) => {
    const image = viewer.querySelector(".poster-evidence-original img");
    if (!image) return;
    const current = Number(image.dataset.scale || 1);
    const next = action === "reset" ? 1 : Math.min(3, Math.max(0.5, current + (action === "in" ? 0.25 : -0.25)));
    image.dataset.scale = String(next);
    image.style.transform = "scale(" + next + ")";
    viewer.querySelector(".poster-evidence-scale").textContent = Math.round(next * 100) + "%";
    setFeedback(viewer, "Image zoom " + Math.round(next * 100) + " percent.");
  };
  const writeClipboard = async (value) => {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(value); return true; } catch {}
    }
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand?.("copy") || false;
    input.remove();
    return copied;
  };
  const copyEvidence = async (viewer, index, button) => {
    const item = viewer._evidenceItems?.[index];
    if (!item) return;
    const prefix = item.page ? "Page " + item.page + " - " : "";
    const copied = await writeClipboard(prefix + (item.location || "Paper context") + "\n" + (item.quote || ""));
    setFeedback(viewer, copied ? "Evidence copied." : "Copy failed. Select the quote manually.");
    if (copied) {
      const original = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(() => { button.textContent = original; }, 1400);
    }
  };
  const paperPageUrl = (value, page) => {
    let url = String(value || "").trim();
    if (!url) return "";
    const arxiv = url.match(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/([^?#/]+)(?:\.pdf)?/i);
    if (arxiv) url = "https://arxiv.org/pdf/" + arxiv[1] + ".pdf";
    if (page && (/^blob:/i.test(url) || /(?:\.pdf(?:[?#]|$)|\/pdf\/)/i.test(url))) {
      url = url.replace(/#.*$/, "") + "#page=" + Number(page);
    }
    return url;
  };
  const closeViewer = (viewer = document.querySelector(".poster-evidence-viewer")) => {
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    document.body.classList.remove("evidence-viewer-open");
    setFeedback(viewer, "");
    if (window.parent !== window) window.parent.postMessage({ type: "paper-evidence-viewer", open: false }, "*");
    previousFocus?.focus?.();
  };
  const openViewer = (trigger) => {
    const items = readItems(trigger);
    if (!items.length) return;
    previousFocus = trigger;
    const viewer = ensureViewer();
    viewer._evidenceItems = items;
    const title = trigger.dataset.evidenceTitle || "Paper evidence";
    viewer.querySelector("#posterEvidenceTitle").textContent = title;
    const pages = [...new Set(items.map((item) => item.page).filter(Boolean))];
    const evidenceHtml = items.map((item, index) => '<article class="poster-evidence-item">' +
      '<div class="poster-evidence-location">' + (item.page ? '<b>Page ' + Number(item.page) + '</b>' : '') + '<span>' + escapeHtml(item.location || "Paper context") + '</span><button type="button" class="poster-evidence-copy" data-evidence-copy="' + index + '">Copy quote</button></div>' +
      (item.quote ? '<blockquote>' + escapeHtml(item.quote) + '</blockquote>' : '') + '</article>').join("");
    const image = ["asset", "formula"].includes(trigger.dataset.evidenceKind)
      ? trigger.querySelector("img")
      : null;
    const imageHtml = image?.src ? '<figure class="poster-evidence-original"><div class="poster-evidence-original-toolbar"><span>Original artwork</span><div><button type="button" data-evidence-zoom="out" aria-label="Zoom out" title="Zoom out">-</button><button type="button" data-evidence-zoom="reset" aria-label="Reset zoom" title="Reset zoom"><span class="poster-evidence-scale">100%</span></button><button type="button" data-evidence-zoom="in" aria-label="Zoom in" title="Zoom in">+</button><a href="' + escapeHtml(image.src) + '" download="paper-artwork" aria-label="Download original image" title="Download original image">&#8595;</a></div></div><div class="poster-evidence-image-viewport"><img data-scale="1" src="' + escapeHtml(image.src) + '" alt="' + escapeHtml(image.alt || title) + '"></div><figcaption>High-resolution original artwork</figcaption></figure>' : '';
    viewer.querySelector(".poster-evidence-body").innerHTML = (pages.length ? '<div class="poster-evidence-pages">Paper page ' + pages.join(", ") + '</div>' : '') + imageHtml + '<div class="poster-evidence-quotes">' + evidenceHtml + '</div>';
    const sourceLink = document.querySelector("#posterPaperLink[href]");
    const hasUploadedPdf = document.querySelector(".poster-export")?.dataset.uploadedPdfAvailable === "true";
    const paperLink = viewer.querySelector(".poster-evidence-paper-link");
    paperLink.hidden = !sourceLink?.href && !hasUploadedPdf;
    paperLink.onclick = null;
    if (sourceLink?.href) {
      paperLink.href = paperPageUrl(sourceLink.href, pages[0]);
    } else if (hasUploadedPdf) {
      paperLink.href = "#";
      paperLink.onclick = (event) => {
        event.preventDefault();
        if (window.parent !== window) {
          window.parent.postMessage({ type: "paper-evidence-open-paper", page: pages[0] || null }, "*");
        } else {
          setFeedback(viewer, "The uploaded PDF is available from the workspace preview.");
        }
      };
    }
    setFeedback(viewer, "");
    viewer.hidden = false;
    document.body.classList.add("evidence-viewer-open");
    if (window.parent !== window) window.parent.postMessage({ type: "paper-evidence-viewer", open: true }, "*");
    viewer.querySelector(".poster-evidence-close").focus();
  };
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(selector);
    if (!trigger || event.target.closest("a, button, details, summary") || window.getSelection()?.toString()) return;
    openViewer(trigger);
  });
  document.addEventListener("keydown", (event) => {
    const viewer = document.querySelector(".poster-evidence-viewer");
    if (event.key === "Escape") return closeViewer(viewer);
    if (viewer && !viewer.hidden && event.key === "Tab") {
      const nodes = focusable(viewer);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (viewer && !viewer.hidden && ["+", "=", "-", "0"].includes(event.key)) {
      if (/^(?:INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "")) return;
      event.preventDefault();
      return updateImageScale(viewer, event.key === "-" ? "out" : event.key === "0" ? "reset" : "in");
    }
    if (!["Enter", " "].includes(event.key)) return;
    const trigger = event.target.closest(selector);
    if (!trigger) return;
    event.preventDefault();
    openViewer(trigger);
  });
})();`;
  }

  return { annotatePoster, evidenceForSection, pageFromLocation, setEvidenceData, standaloneScript, hasMergedSectionBoundary };
});
