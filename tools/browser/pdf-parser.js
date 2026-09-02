(function registerPdfParserDefinition(global) {
  const FIGURE_CAPTION = /^(?:figure|fig\.)\s*(\d+[a-z]?)\s*[:.\-]\s*(.*)/i;
  const TABLE_CAPTION = /^table\s*(\d+[a-z]?)\s*[:.\-]\s*(.*)/i;
  let visionCropState = "unknown";
  let visionCropCalls = { figure: 0, table: 0, formula: 0 };

  function detectArxivId(fileName, text) {
    const modernPattern = "(\\d{4}\\.\\d{4,5})(v\\d+)?";
    const legacyPattern = "([a-z-]+(?:\\.[A-Z]{2})?\\/\\d{7})(v\\d+)?";
    const nameMatch = String(fileName || "").match(new RegExp(`(?:^|[^\\w])(?:${modernPattern}|${legacyPattern})(?:[^\\w]|$)`, "i"));
    if (nameMatch) return `${nameMatch[1] || nameMatch[3]}${nameMatch[2] || nameMatch[4] || ""}`;
    const textMatch = String(text || "").match(new RegExp(`arxiv\\s*(?::|\\.org\\/(?:abs|pdf)\\/)?\\s*(?:${modernPattern}|${legacyPattern})`, "i"));
    if (textMatch) return `${textMatch[1] || textMatch[3]}${textMatch[2] || textMatch[4] || ""}`;
    // Rotated arXiv watermarks can be emitted backwards by PDF text extraction.
    const reversedText = [...String(text || "")].reverse().join("");
    const reversedMatch = reversedText.match(new RegExp(`arxiv\\s*:\\s*(?:${modernPattern}|${legacyPattern})`, "i"));
    return reversedMatch ? `${reversedMatch[1] || reversedMatch[3]}${reversedMatch[2] || reversedMatch[4] || ""}` : "";
  }

  function detectPaperUrl(text, arxivId = "") {
    const source = String(text || "");
    const doiMatch = source.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[A-Z0-9][A-Z0-9._;()/:+-]*)/i);
    if (doiMatch) {
      const doi = doiMatch[1].replace(/[.,;:)}\]]+$/g, "");
      if (!isPlaceholderDoi(doi)) return { doi, paperUrl: `https://doi.org/${doi}` };
    }
    return arxivId
      ? { doi: "", paperUrl: `https://arxiv.org/abs/${arxivId}` }
      : { doi: "", paperUrl: "" };
  }

  function isPlaceholderDoi(value) {
    const suffix = String(value || "").toLowerCase().split("/").slice(1).join("/");
    return !suffix
      || /(?:^|[._/()-])(?:n{4,}|x{4,}|tbd|todo|placeholder)(?:$|[._/()-])/i.test(suffix)
      || /(?:n{6,}|x{6,})/i.test(suffix);
  }

  function buildAssetPageMap(pageRegions = {}) {
    const collect = (regions) => Object.fromEntries((Array.isArray(regions) ? regions : [])
      .filter((region) => region?.number && Number(region?.pageNumber) > 0)
      .map((region) => [String(region.number).toLowerCase(), Number(region.pageNumber)]));
    const collectCaptions = (regions) => Object.fromEntries((Array.isArray(regions) ? regions : [])
      .filter((region) => region?.number && String(region?.caption || "").trim())
      .map((region) => [String(region.number).toLowerCase(), String(region.caption).replace(/\s+/g, " ").trim()]));
    return {
      figures: collect(pageRegions.figures),
      tables: collect(pageRegions.tables),
      figureCaptions: collectCaptions(pageRegions.figures),
      tableCaptions: collectCaptions(pageRegions.tables)
    };
  }

  function detectPrimaryPaperIdentity({ metadataText = "", firstPageText = "", fileName = "" } = {}) {
    const primaryText = `${metadataText}\n${fileName}\n${firstPageText}`;
    const arxivId = detectArxivId(fileName, primaryText);
    return { arxivId, ...detectPaperUrl(primaryText, arxivId) };
  }

  function inferPdfTitle(metadata, firstPageLines, fileName, viewport = {}) {
    const info = metadata?.info || {};
    const metadataMap = metadata?.metadata?.getAll?.() || {};
    const metadataTitle = cleanPdfTitle(info.Title || metadataMap["dc:title"] || metadataMap.title || "");
    const inferred = cleanPdfTitle(inferPdfTitleLines(firstPageLines, viewport));
    if (isUsablePdfTitle(metadataTitle) && !isTemplateMetadataTitle(metadataTitle)) return metadataTitle;
    if (isUsablePdfTitle(inferred)) return inferred;
    if (isUsablePdfTitle(metadataTitle)) return metadataTitle;
    return cleanPdfTitle(String(fileName || "").replace(/\.pdf$/i, "")) || "Untitled Paper Poster";
  }

  function isTemplateMetadataTitle(value) {
    return /\b(?:formatting instructions?|conference submissions?|submission template|sample paper|author guidelines?)\b/i.test(String(value || ""));
  }

  function looksLikePdfAuthorOrAffiliation(value) {
    const text = cleanPdfTitle(value);
    if (!text) return true;
    if (/@|\b(?:university|institute|laboratory|department|school of|college|correspondence|equal contribution)\b/i.test(text)) {
      return true;
    }
    const commaParts = text.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
    if (commaParts.length >= 3
      && commaParts.every((part) => part.length <= 42)
      && !/[:?!]/.test(text)) {
      return true;
    }
    const words = text.split(/\s+/).filter(Boolean);
    return words.length >= 2
      && words.length <= 10
      && words.filter((word) => /^[A-Z][a-z]+(?:[A-Z][a-z]+)+\d*$/.test(word)).length >= 2;
  }

  function inferPdfTitleLines(firstPageLines, viewport = {}) {
    const pageHeight = Number(viewport.height || 792);
    const candidates = (Array.isArray(firstPageLines) ? firstPageLines : [])
      .filter((line) => Number(line.y || 0) <= pageHeight * 0.32)
      .filter((line) => {
        const text = cleanPdfTitle(line.text);
        return text.length >= 4 && text.length <= 180
          && !/^(?:arxiv|doi|published|proceedings|conference|journal)\b/i.test(text)
          && !/@|\b(?:university|institute|laboratory|department)\b/i.test(text);
      })
      .sort((left, right) => Number(left.y || 0) - Number(right.y || 0));
    const maxHeight = Math.max(0, ...candidates.map((line) => Number(line.height || 0)));
    if (!maxHeight) return [];

    // Treat the title as one contiguous typographic block. Author names are often
    // only slightly smaller than the title, so a page-wide font threshold alone
    // incorrectly appends them to wrapped titles.
    const anchor = candidates.find((line) => Number(line.height || 0) >= maxHeight * 0.94);
    if (!anchor) return [];
    const titleLines = [anchor];
    let previous = anchor;
    for (const line of candidates.slice(candidates.indexOf(anchor) + 1)) {
      const height = Number(line.height || 0);
      const gap = Number(line.y || 0) - Number(previous.y || 0);
      const previousText = cleanPdfTitle(previous.text);
      const sameTitleStyle = height >= maxHeight * 0.87;
      const compactSubtitle = height >= maxHeight * 0.8 && /[:\-]$/.test(previousText);
      const continuous = gap > 0 && gap <= Math.max(maxHeight * 1.45, Number(previous.height || 0) * 1.65);
      if (!continuous || (!sameTitleStyle && !compactSubtitle) || looksLikePdfAuthorOrAffiliation(line.text)) break;
      titleLines.push(line);
      previous = line;
      if (titleLines.length === 4) break;
    }
    return candidates
      .filter((line) => titleLines.includes(line))
      .map((line) => cleanPdfTitle(line.text))
      .filter(Boolean);
  }

  function titleLinesMatch(lines, title) {
    const key = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const linesKey = key((Array.isArray(lines) ? lines : []).join(" "));
    const titleKey = key(title);
    return Boolean(linesKey && titleKey && (linesKey === titleKey || linesKey.includes(titleKey) || titleKey.includes(linesKey)));
  }

  function cleanPdfTitle(value) {
    const source = Array.isArray(value) ? value.join(" ") : value && typeof value === "object" ? Object.values(value).join(" ") : value;
    const cleaned = String(source || "")
      .replace(/[\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s+(?:abstract|introduction|keywords?)\s*$/i, "")
      .trim();
    return /^(?:abstract|introduction|keywords?)$/i.test(cleaned) ? "" : cleaned;
  }

  function isUsablePdfTitle(value) {
    const title = String(value || "").trim();
    return title.length >= 5 && !/^(?:untitled|microsoft word|document|arxiv(?::|\s))/i.test(title);
  }

  function groupTextItems(items, viewport) {
    const positioned = (items || []).filter((item) => String(item.str || "").trim()).map((item) => {
      const transform = global.pdfjsLib?.Util?.transform
        ? global.pdfjsLib.Util.transform(viewport.transform, item.transform)
        : [1, 0, 0, 1, Number(item.transform?.[4] || 0), viewport.height - Number(item.transform?.[5] || 0)];
      return {
        text: String(item.str || "").trim(), x: Number(transform[4] || 0), y: Number(transform[5] || 0),
        width: Math.max(1, Number(item.width || 0)),
        height: Math.max(5, Math.abs(Number(transform[3] || item.height || 10)))
      };
    }).sort((left, right) => left.y - right.y || left.x - right.x);

    const lines = [];
    for (const item of positioned) {
      const tolerance = Math.max(3, item.height * 0.45);
      let line = lines.find((entry) => Math.abs(entry.y - item.y) <= tolerance);
      if (!line) {
        line = { items: [], x: item.x, y: item.y, width: item.width, height: item.height };
        lines.push(line);
      }
      line.items.push(item);
      line.x = Math.min(line.x, item.x);
      line.y = Math.min(line.y, item.y);
      line.width = Math.max(line.width, item.x + item.width - line.x);
      line.height = Math.max(line.height, item.height);
    }
    return lines.sort((left, right) => left.y - right.y).flatMap((line) => {
      line.items.sort((left, right) => left.x - right.x);
      const segments = [];
      const pageWidth = Number(viewport.width || 612);
      const splitGap = Math.max(16, pageWidth * 0.028);
      for (const item of line.items) {
        const current = segments.at(-1);
        const currentRight = current?.items.at(-1)
          ? current.items.at(-1).x + current.items.at(-1).width
          : 0;
        const crossesPageGutter = current
          && current.items[0].x < pageWidth / 2
          && currentRight < pageWidth / 2 - pageWidth * 0.004
          && item.x > pageWidth / 2 + pageWidth * 0.004;
        if (!current || item.x - currentRight > splitGap || crossesPageGutter) segments.push({ items: [item] });
        else current.items.push(item);
      }
      return segments.map(({ items: segmentItems }) => {
        const x = Math.min(...segmentItems.map((item) => item.x));
        const right = Math.max(...segmentItems.map((item) => item.x + item.width));
        return {
          items: segmentItems,
          x,
          y: Math.min(...segmentItems.map((item) => item.y)),
          width: right - x,
          height: Math.max(...segmentItems.map((item) => item.height)),
          text: joinPdfTextItems(segmentItems)
        };
      });
    });
  }

  function joinPdfTextItems(items) {
    return (items || []).reduce((text, item, index) => {
      if (!index) return String(item.text || "");
      const previous = items[index - 1];
      const gap = Number(item.x || 0) - (Number(previous.x || 0) + Number(previous.width || 0));
      const scale = Math.max(5, Number(item.height || 0), Number(previous.height || 0));
      // PDF small-caps frequently split one word into multiple font runs. A
      // geometric gap, rather than a font-run boundary, is the reliable word separator.
      const separator = gap > Math.max(1.2, scale * 0.16) ? " " : "";
      return `${text}${separator}${String(item.text || "")}`;
    }, "").replace(/\s+/g, " ").trim();
  }

  function orderPdfLinesForReading(lines, viewport) {
    const source = Array.isArray(lines) ? lines : [];
    const pageWidth = Number(viewport?.width || 612);
    const pageHeight = Number(viewport?.height || 792);
    const left = [];
    const right = [];
    const spanning = [];
    for (const line of source) {
      const center = Number(line.x || 0) + Number(line.width || 0) / 2;
      const isSpanning = Number(line.width || 0) >= pageWidth * 0.58
        || (Number(line.x || 0) < pageWidth * 0.34 && Number(line.x || 0) + Number(line.width || 0) > pageWidth * 0.66);
      if (isSpanning) spanning.push(line);
      else if (center < pageWidth / 2) left.push(line);
      else right.push(line);
    }
    if (left.length < 4 || right.length < 4) return [...source].sort((a, b) => a.y - b.y || a.x - b.x);

    const firstColumnY = Math.min(...left.map((line) => line.y), ...right.map((line) => line.y));
    const top = spanning.filter((line) => line.y <= firstColumnY + pageHeight * 0.035);
    const rest = spanning.filter((line) => !top.includes(line));
    const byPosition = (a, b) => a.y - b.y || a.x - b.x;
    return [
      ...top.sort(byPosition),
      ...left.sort(byPosition),
      ...right.sort(byPosition),
      ...rest.sort(byPosition)
    ];
  }

  function inferColumnBounds(line, viewport) {
    const pageWidth = Number(viewport.width || 612);
    const margin = pageWidth * 0.045;
    const center = line.x + line.width / 2;
    if (line.width >= pageWidth * 0.62) return { left: margin, right: pageWidth - margin };
    const gutter = pageWidth * 0.025;
    return center < pageWidth / 2
      ? { left: margin, right: pageWidth / 2 - gutter }
      : { left: pageWidth / 2 + gutter, right: pageWidth - margin };
  }

  function collectPdfCaption(lines, captionIndex, viewport) {
    const caption = lines[captionIndex];
    const match = String(caption?.text || "").match(FIGURE_CAPTION) || String(caption?.text || "").match(TABLE_CAPTION);
    if (!caption || !match) return { text: "", bottom: Number(caption?.y || 0) + Number(caption?.height || 0) };
    const pageWidth = Number(viewport?.width || 612);
    const captionCenter = Number(caption.x || 0) + Number(caption.width || 0) / 2;
    const centeredAcrossGutter = Number(caption.width || 0) >= pageWidth * 0.30
      && Math.abs(captionCenter - pageWidth / 2) <= pageWidth * 0.12;
    const columnBounds = centeredAcrossGutter
      ? { left: pageWidth * 0.045, right: pageWidth * 0.955 }
      : inferColumnBounds(caption, viewport);
    const parts = [match[2] || caption.text];
    let bottom = Number(caption.y || 0) + Number(caption.height || 0);
    const candidates = (lines || [])
      .filter((line, index) => {
        if (index === captionIndex || Number(line.y || 0) <= Number(caption.y || 0)) return false;
        const center = Number(line.x || 0) + Number(line.width || 0) / 2;
        return center >= columnBounds.left && center <= columnBounds.right;
      })
      .sort((left, right) => left.y - right.y || left.x - right.x);
    for (const line of candidates.slice(0, 8)) {
      if (captionSentenceComplete(parts.at(-1))) break;
      const gap = Number(line.y || 0) - bottom;
      if (gap > Math.max(18, Number(caption.height || 10) * 1.8)) break;
      const center = Number(line.x || 0) + Number(line.width || 0) / 2;
      const text = String(line.text || "").replace(/\s+/g, " ").trim();
      const words = text.match(/[A-Za-z]{2,}/g) || [];
      const singleColumnAfterWideCaption = centeredAcrossGutter
        && Number(line.width || 0) < pageWidth * 0.43
        && Math.abs(center - captionCenter) > pageWidth * 0.16;
      if (Math.abs(center - captionCenter) > pageWidth * 0.3
        || singleColumnAfterWideCaption
        || FIGURE_CAPTION.test(text)
        || TABLE_CAPTION.test(text)
        || /^\d+(?:\.\d+)*\.?\s+[A-Z]/.test(text)
        || /(?:\(|\[)\d+[a-z]?(?:\)|\])\s*$/.test(text)
        || words.length < 2) break;
      parts.push(text);
      bottom = Number(line.y || 0) + Number(line.height || 0);
      if (parts.length >= 4) break;
    }
    const text = parts.join(" ")
      .replace(/([A-Za-z])-\s+([a-z])/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim();
    return { text, bottom };
  }

  function captionSentenceComplete(value) {
    const text = String(value || "").trim();
    if (/\b(?:w\.r\.t|e\.g|i\.e)\.$/i.test(text)) return false;
    return /[.!?]$/.test(text);
  }

  function measureTableRow(row) {
    const cells = row.lines.flatMap((line) => line.items?.some((item) => String(item.text || "").trim()) ? line.items : [line])
      .filter((cell) => String(cell.text || "").trim())
      .sort((left, right) => Number(left.x || 0) - Number(right.x || 0));
    const numericCells = cells.filter((cell) => /^[+\-]?(?:\d+(?:\.\d+)?|\.\d+)%?(?:\s*[†‡*])?$/.test(String(cell.text || "").trim())).length;
    const textNumbers = row.text.match(/(?:^|\s)[+\-]?(?:\d+(?:\.\d+)?|\.\d+)%?(?=\s|$)/g) || [];
    const largeGaps = cells.slice(1).filter((cell, index) => {
      const previous = cells[index];
      const previousRight = Number(previous.x || 0) + Number(previous.width || 0);
      return Number(cell.x || 0) - previousRight > Math.max(9, Number(row.height || 10) * 0.9);
    }).length;
    const separatedCells = row.lines.length >= 2 || largeGaps >= 1;
    const compactCells = cells.filter((cell) => String(cell.text || "").trim().length <= 34).length;
    const compactRatio = cells.length ? compactCells / cells.length : 0;
    const sectionHeading = /^\d+(?:\.\d+)+\.?\s+[A-Za-z]/.test(row.text);
    const proseWords = row.text.match(/[A-Za-z]{3,}/g) || [];
    const proseSentence = !separatedCells
      && proseWords.length >= 7
      && (/[.!?)]$/.test(row.text) || row.text.length >= 72);
    const data = !sectionHeading && !proseSentence && (
      numericCells >= 2
      || textNumbers.length >= 2
      || (numericCells >= 1 && separatedCells && compactRatio >= 0.5)
      || (textNumbers.length >= 1 && separatedCells && row.text.length < 100)
    );
    const header = !sectionHeading
      && separatedCells
      && cells.length >= 2
      && compactRatio >= 0.65
      && row.text.length < 120
      && !/[.!?]$/.test(row.text);
    const groupLabel = !sectionHeading
      && !proseSentence
      && !data
      && !header
      && row.text.length <= 72
      && (row.text.match(/[A-Za-z]{2,}/g) || []).length <= 9
      && /\b(?:LLMs?|models?|methods?|approaches?|agents?|datasets?|backbones?|zero[- ]shot|optimisation|optimization)\b/i.test(row.text);
    return { data, header, groupLabel };
  }

  function findTableBlock(rows, caption, direction, pageHeight, afterCaptionY) {
    const minY = direction === "before" ? Math.max(0, caption.y - pageHeight * 0.32) : afterCaptionY;
    const maxY = direction === "before" ? caption.y - 2 : Math.min(pageHeight, afterCaptionY + pageHeight * 0.28);
    const candidates = rows.filter((row) => row.y >= minY && row.y <= maxY && (row.isTableData || row.isTableHeader || row.isTableGroupLabel));
    const runs = [];
    for (const row of candidates) {
      const current = runs.at(-1);
      const gap = current ? row.y - current.at(-1).y - current.at(-1).height : Infinity;
      if (!current || gap > Math.max(18, Number(row.height || 10) * 1.9)) runs.push([row]);
      else current.push(row);
    }
    const valid = runs.filter((run) => {
      const dataRows = run.filter((row) => row.isTableData).length;
      const structuredTextRows = run.filter((row) => row.isTableHeader).length;
      return dataRows >= 1 && run.length >= 2
        || structuredTextRows >= 3;
    });
    if (!valid.length) return null;
    return direction === "before"
      ? valid.sort((left, right) => right.at(-1).y - left.at(-1).y)[0]
      : valid.sort((left, right) => left[0].y - right[0].y)[0];
  }

  function computePdfVisualRegion(lines, captionIndex, kind, viewport) {
    const caption = lines[captionIndex];
    const pageWidth = Number(viewport.width || 612);
    const pageHeight = Number(viewport.height || 792);
    const captionY = caption.y;
    const tableSignal = (line) => {
      const numbers = line.text.match(/(?:^|\s)[+-]?(?:\d+\.?\d*|\.\d+)%?/g) || [];
      const items = [...(line.items || [])].sort((left, right) => left.x - right.x);
      const largeGaps = items.slice(1).filter((item, index) => {
        const previous = items[index];
        return item.x - (previous.x + previous.width) > Math.max(8, Number(line.height || 10) * 0.9);
      }).length;
      const compactCells = items.length >= 3
        && largeGaps >= 2
        && items.filter((item) => String(item.text || "").trim().length <= 24).length >= Math.ceil(items.length * 0.7);
      return numbers.length >= 2
        || (numbers.length >= 1 && compactCells)
        || (compactCells && line.text.length < 90);
    };
    const visualRows = [];
    for (const line of [...lines].sort((left, right) => left.y - right.y || left.x - right.x)) {
      const tolerance = Math.max(3, Number(line.height || 10) * 0.55);
      let row = visualRows.find((entry) => Math.abs(entry.y - line.y) <= tolerance);
      if (!row) {
        row = { y: line.y, height: line.height, lines: [] };
        visualRows.push(row);
      }
      row.lines.push(line);
      row.y = Math.min(row.y, line.y);
      row.height = Math.max(row.height, line.height);
    }
    for (const row of visualRows) {
      row.lines.sort((left, right) => left.x - right.x);
      row.text = row.lines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
      row.x = Math.min(...row.lines.map((line) => line.x));
      row.right = Math.max(...row.lines.map((line) => line.x + line.width));
      const metrics = measureTableRow(row);
      row.isTableData = metrics.data;
      row.isTableHeader = metrics.header;
      row.isTableGroupLabel = metrics.groupLabel;
      row.isTable = metrics.data || metrics.header || metrics.groupLabel;
    }
    let bounds = inferColumnBounds(caption, viewport);
    const captionCenter = Number(caption.x || 0) + Number(caption.width || 0) / 2;
    const centeredAcrossPage = Math.abs(captionCenter - pageWidth / 2) <= pageWidth * 0.12
      && Number(caption.width || 0) >= pageWidth * 0.3;
    if (kind === "figure" && centeredAcrossPage) {
      const margin = pageWidth * 0.035;
      bounds = { left: margin, right: pageWidth - margin };
    }
    if (kind === "table") {
      const nearbyTableLines = lines.filter((line) => Math.abs(line.y - captionY) < pageHeight * 0.32 && tableSignal(line));
      const leftRows = nearbyTableLines.filter((line) => line.x + line.width / 2 < pageWidth / 2);
      const rightRows = nearbyTableLines.filter((line) => line.x + line.width / 2 > pageWidth / 2);
      const sharedRows = leftRows.filter((left) => rightRows.some((right) => Math.abs(left.y - right.y) <= Math.max(4, left.height * 0.7)));
      const spanningContent = nearbyTableLines.some((line) => line.width >= pageWidth * 0.58);
      if (spanningContent || sharedRows.length >= 2) {
        const margin = pageWidth * 0.035;
        bounds = { left: margin, right: pageWidth - margin };
      }
    }
    const inColumn = (line) => {
      const center = line.x + line.width / 2;
      return center >= bounds.left && center <= bounds.right;
    };
    const columnLines = lines.filter(inColumn);
    const columnRows = visualRows.filter((row) => row.lines.some(inColumn));
    const nearbyBefore = columnLines.filter((line) => line.y < captionY && line.y > captionY - pageHeight * 0.24);
    const nearbyAfter = columnLines.filter((line) => line.y > captionY && line.y < captionY + pageHeight * 0.24);
    let captionBottom = caption.y + caption.height;
    for (const row of columnRows.filter((entry) => entry.y > caption.y).slice(0, 6)) {
      if (row.y - captionBottom > 18 || row.isTable) break;
      const words = row.text.match(/[A-Za-z]{2,}/g) || [];
      if (!words.length || row.lines.length > 2) break;
      captionBottom = row.y + row.height;
    }

    if (kind === "table") {
      const beforeBlock = findTableBlock(columnRows, caption, "before", pageHeight, captionBottom + 2);
      const afterBlock = findTableBlock(columnRows, caption, "after", pageHeight, captionBottom + 2);
      const block = beforeBlock || afterBlock;
      if (block) {
        const blockLeft = Math.min(...block.map((row) => row.x));
        const blockRight = Math.max(...block.map((row) => row.right));
        const blockTop = Math.min(...block.map((row) => row.y));
        const blockBottom = Math.max(...block.map((row) => row.y + row.height));
        const padX = Math.max(7, pageWidth * 0.012);
        const rowHeight = Number(block[0]?.height || 10);
        const padTop = Math.max(11, rowHeight * 1.15);
        const padBottom = Math.max(6, rowHeight * 0.6);
        const spansGutter = block.some((row) => row.x < pageWidth * 0.45 && row.right > pageWidth * 0.55);
        const parallelCaption = lines.some((line) => line !== caption
          && TABLE_CAPTION.test(line.text)
          && Math.abs(line.y - caption.y) <= Math.max(16, caption.height * 1.5));
        const isCrossColumnTable = spansGutter && !parallelCaption;
        const tableBounds = isCrossColumnTable
          ? { left: pageWidth * 0.025, right: pageWidth * 0.975 }
          : bounds;
        const x = isCrossColumnTable ? tableBounds.left : Math.max(tableBounds.left, blockLeft - padX);
        const right = isCrossColumnTable ? tableBounds.right : Math.min(tableBounds.right, blockRight + padX);
        const blockIsAboveCaption = blockBottom <= caption.y;
        const paddedBottom = blockBottom + padBottom;
        const cropBottom = blockIsAboveCaption
          ? Math.min(paddedBottom, caption.y - Math.max(2, rowHeight * 0.18))
          : paddedBottom;
        return {
          x,
          y: Math.max(pageHeight * 0.02, blockTop - padTop),
          width: Math.max(40, right - x),
          height: Math.max(24, cropBottom - Math.max(pageHeight * 0.02, blockTop - padTop))
        };
      }
    }

    if (kind === "table") return null;

    const firstTableRowAfter = columnRows.find((row) => row.y > captionBottom && row.isTableData && row.y < captionY + pageHeight * 0.2);
    const lastTableRowBefore = [...columnRows].reverse().find((row) => row.y < captionY && row.isTableData && row.y > captionY - pageHeight * 0.2);
    const tableAbove = kind === "table" && !firstTableRowAfter && Boolean(lastTableRowBefore);

    if (kind === "figure" || tableAbove) {
      const endY = Math.max(1, caption.y - caption.height - 6);
      const previousVisualCaption = [...columnLines]
        .filter((line) => line.y < caption.y - Math.max(18, caption.height * 1.8)
          && (FIGURE_CAPTION.test(line.text) || TABLE_CAPTION.test(line.text)))
        .sort((left, right) => right.y - left.y)[0];
      const previousVisualIndex = previousVisualCaption ? lines.indexOf(previousVisualCaption) : -1;
      let previousVisualBoundary = 0;
      if (previousVisualIndex >= 0) {
        const previousCaption = collectPdfCaption(lines, previousVisualIndex, viewport);
        previousVisualBoundary = previousCaption.bottom + Math.max(7, previousVisualCaption.height * 0.65);
        if (TABLE_CAPTION.test(previousVisualCaption.text)) {
          const previousTableRegion = computePdfVisualRegion(lines, previousVisualIndex, "table", viewport);
          if (previousTableRegion) {
            previousVisualBoundary = Math.max(
              previousVisualBoundary,
              previousTableRegion.y + previousTableRegion.height + Math.max(7, previousVisualCaption.height * 0.65)
            );
          }
        }
      }
      const looksLikeCodeArtwork = (line) => {
        const text = String(line.text || "");
        const neighbors = columnLines.filter((entry) => Math.abs(entry.y - line.y) <= Math.max(34, line.height * 3.5));
        const codeSignals = neighbors.filter((entry) => /(?:>>>|\bdef\s+|\breturn\b|\bfor\s+\w+\s+in\b|\bimport\b|assert\s+|==|\[[^\]]*\]|\w+\([^)]*\)\s*(?:->|:))/i.test(entry.text)).length;
        return codeSignals >= 2 || /(?:>>>|\bdef\s+|\breturn\b|\bfor\s+\w+\s+in\b|assert\s+)/i.test(text);
      };
      const proseBoundary = [...columnLines].reverse().find((line) => {
        if (line.y >= endY - 55 || line.y < endY - pageHeight * 0.48) return false;
        const words = line.text.match(/[A-Za-z]{2,}/g) || [];
        return words.length >= 8 && /[.!?)]$/.test(line.text) && !looksLikeCodeArtwork(line);
      });
      const headerBoundary = [...columnLines].reverse().find((line) => (
        line.y < pageHeight * 0.045 && line.y < endY - 30
      ));
      const fallbackFigureSpan = kind === "figure" && centeredAcrossPage && captionY >= pageHeight * 0.7 ? 0.62 : 0.38;
      const inferredStart = headerBoundary
        ? headerBoundary.y + headerBoundary.height + 7
        : proseBoundary
          ? proseBoundary.y + proseBoundary.height + 7
          : endY - pageHeight * (kind === "figure" ? fallbackFigureSpan : 0.28);
      // Text inside diagrams is present in the PDF text layer. It must not be
      // mistaken for body prose and used as the top edge of a wide figure.
      const completeFigureFloor = kind === "figure"
        ? endY - pageHeight * (centeredAcrossPage ? 0.22 : 0.15)
        : inferredStart;
      const boundedStart = kind === "figure" ? Math.min(inferredStart, completeFigureFloor) : inferredStart;
      const startY = Math.max(pageHeight * 0.05, boundedStart, previousVisualBoundary);
      return {
        x: bounds.left,
        y: startY,
        width: bounds.right - bounds.left,
        height: Math.max(40, endY - startY)
      };
    }

    const firstContentRow = columnRows.find((row) => row.y >= captionBottom && row.isTable);
    const startY = firstContentRow ? Math.max(captionBottom + 2, firstContentRow.y - 6) : captionBottom + 4;
    let sawTableContent = false;
    let previousRowBottom = startY;
    const nextBoundary = columnRows.find((row) => {
      if (row.y < startY) return false;
      if (FIGURE_CAPTION.test(row.text) || TABLE_CAPTION.test(row.text)) return row.y > startY + 18;
      if (row.isTable) {
        sawTableContent = true;
        previousRowBottom = row.y + row.height;
        return false;
      }
      const words = row.text.match(/[A-Za-z]{2,}/g) || [];
      const prose = words.length >= 6 && (row.lines.length <= 2 || /[.!?]$/.test(row.text) || row.text.length >= 70);
      const sectionHeading = /^\d+(?:\.\d+)*\.?\s+[A-Za-z]/.test(row.text)
        || /^\d+(?:\.\d+)*\.?$/.test(row.lines[0]?.text || "") && row.lines.some((line) => /[A-Za-z]{3,}/.test(line.text));
      const separatedBlock = sawTableContent && row.y - previousRowBottom > Math.max(20, row.height * 1.8);
      return sawTableContent && row.y > startY + 20 && (prose || sectionHeading || separatedBlock);
    });
    const endY = Math.min(
      pageHeight - pageHeight * 0.025,
      nextBoundary ? nextBoundary.y - nextBoundary.height - 6 : startY + pageHeight * 0.32
    );
    const contentLines = columnLines.filter((line) => line.y >= startY && line.y <= endY && (tableSignal(line) || visualRows.find((row) => row.lines.includes(line))?.isTable));
    const contentLeft = contentLines.length ? Math.min(...contentLines.map((line) => line.x)) - 12 : bounds.left;
    const contentRight = contentLines.length
      ? Math.max(...contentLines.map((line) => line.x + line.width)) + 12
      : bounds.right;
    const x = Math.max(bounds.left, contentLeft);
    const right = Math.min(bounds.right, contentRight);
    return { x, y: startY, width: Math.max(40, right - x), height: Math.max(24, endY - startY) };
  }

  function extractPdfInlineMath(lines) {
    const formulas = [];
    const seen = new Set();
    for (const line of lines || []) {
      const matches = String(line.text || "").match(/(?:O|Ω|Θ)\s*\([^)]{1,80}\)/g) || [];
      for (const match of matches) {
        const normalized = match
          .replace(/\s+/g, " ")
          .replace(/([A-Za-z)])(\d+)(?=\s*[+\-)])/g, "$1^{$2}")
          .replace(/([A-Za-z)])(\d+)$/g, "$1^{$2}")
          .replace(/≤/g, "\\leq ")
          .trim();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        formulas.push(normalized);
      }
    }
    return formulas.slice(0, 8);
  }

  function looksLikeFormula(text, line, viewport, { requireNumber = true } = {}) {
    const value = String(text || "").trim();
    if (value.length < 5 || value.length > 240 || !/[=≈≃≤≥∑∏√∂∇]/.test(value)) return false;
    const words = value.match(/[A-Za-z]{5,}/g) || [];
    const proseWords = words.filter((word) => !/^(?:alpha|beta|gamma|delta|epsilon|lambda|sigma|theta|omega|softmax|sigmoid|attention|projection|embedding|feature)$/i.test(word));
    const mathMarks = value.match(/[=+\-*/^_(){}\[\]∑∏√∂∇≤≥]/g) || [];
    const numberedEquation = /(?:\(|\[)\d+[a-z]?(?:\)|\])\s*$/i.test(value);
    const pageWidth = Number(viewport?.width || 612);
    if (Number(line?.width || 0) > pageWidth * 0.94) return false;
    const startsLikeFragment = /^[a-z]{3,}\s/i.test(value) && !/^(?:arg|min|max|log|exp|softmax|sigmoid|relu)\b/i.test(value);
    const prosePunctuation = /[.!?]\s*(?:\(\d+[a-z]?\))?$/i.test(value);
    return (!requireNumber || numberedEquation)
      && mathMarks.length >= 2
      && proseWords.length <= 4
      && !startsLikeFragment
      && !prosePunctuation
      && !/https?:|copyright|figure|table/i.test(value);
  }

  function buildCoreUnnumberedFormulaCandidate(lines, lineIndex, viewport) {
    const anchor = lines[lineIndex];
    const value = String(anchor?.text || "").replace(/\s+/g, " ").trim();
    if (!value || /(?:\(|\[)\d+[a-z]?(?:\)|\])\s*$/i.test(value)) return null;
    if (!/[=≈≃∝≤≥]/.test(value) || !/[()|∑∏]|\b(?:log|exp|arg|min|max|softmax)\b/i.test(value)) return null;
    const pageWidth = Number(viewport?.width || 612);
    const bounds = inferColumnBounds(anchor, viewport);
    const priorContext = lines.filter((line) => line.y < anchor.y
      && anchor.y - (line.y + line.height) <= 88
      && line.x + line.width / 2 >= bounds.left
      && line.x + line.width / 2 <= bounds.right)
      .sort((left, right) => right.y - left.y)
      .slice(0, 4)
      .map((line) => line.text)
      .join(" ");
    const formalCue = /\b(?:formally|we define|concretely|marginali[sz]|probability|likelihood|objective|distribution|latent variable|transition probability)\b/i.test(priorContext);
    if (!formalCue) return null;

    const selected = [anchor];
    let bottom = anchor.y + anchor.height;
    for (const line of lines.filter((entry) => entry.y > anchor.y)
      .sort((left, right) => left.y - right.y || left.x - right.x)) {
      if (line.y - bottom > Math.max(20, anchor.height * 2.2)) break;
      const center = line.x + line.width / 2;
      if (center < bounds.left || center > bounds.right) continue;
      const fragment = String(line.text || "").replace(/\s+/g, " ").trim();
      const words = fragment.match(/[A-Za-z]{4,}/g) || [];
      const mathFragment = /[=≈≃∝+\-*/^_(){}\[\]|∑∏√∂∇≤≥]/.test(fragment)
        || (/^\d+$/.test(fragment) && fragment.length <= 3);
      if (!mathFragment || words.length > 5 || /[.!?]$/.test(fragment)) break;
      selected.push(line);
      bottom = Math.max(bottom, line.y + line.height);
    }
    const text = selected.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
    const left = Math.min(...selected.map((line) => line.x));
    const right = Math.max(...selected.map((line) => line.x + line.width));
    const top = Math.min(...selected.map((line) => line.y));
    const synthetic = { text, x: left, y: top, width: right - left, height: bottom - top };
    return looksLikeFormula(text, synthetic, viewport, { requireNumber: false })
      ? { ...synthetic, equationNumber: "", confidence: "core-unnumbered-equation" }
      : null;
  }

  function buildFormulaCandidate(lines, lineIndex, viewport) {
    const marker = lines[lineIndex];
    const equationNumber = String(marker?.text || "").match(/(?:\(|\[)(\d+[a-z]?)(?:\)|\])\s*$/i)?.[1] || "";
    if (!equationNumber) return null;
    const pageWidth = Number(viewport?.width || 612);
    const markerCenter = marker.x + marker.width / 2;
    const sameColumn = (line) => {
      const center = line.x + line.width / 2;
      return marker.width >= pageWidth * 0.58
        || Math.abs(center - markerCenter) < pageWidth * 0.42
        || (marker.x > pageWidth * 0.8 && line.x < pageWidth * 0.5 && line.x + line.width > pageWidth * 0.42);
    };
    const pieces = lines.filter((line, index) => index !== lineIndex
      && sameColumn(line)
      && line.x < marker.x
      && Math.abs(line.y - marker.y) <= Math.max(5, marker.height * 0.8));
    let selected = [marker, ...pieces];
    let text = selected.sort((a, b) => a.x - b.x).map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
    if (!/[=≈≃≤≥∑∏√∂∇]/.test(text)) {
      const previous = [...lines].reverse().find((line) => line.y < marker.y
        && marker.y - line.y <= Math.max(30, marker.height * 3)
        && sameColumn(line)
        && /[=≈≃≤≥∑∏√∂∇]/.test(line.text));
      if (previous) {
        selected = [previous, marker];
        text = `${previous.text} ${marker.text}`.replace(/\s+/g, " ").trim();
      }
    }
    if (/[=≈≃≤≥∑∏√∂∇]/.test(text)) {
      const selectedLeft = Math.min(...selected.map((line) => line.x));
      const selectedRight = Math.max(...selected.map((line) => line.x + line.width));
      const verticalRadius = Math.max(28, marker.height * 2.8);
      const fragments = lines.filter((line, index) => {
        if (index === lineIndex || selected.includes(line)) return false;
        if (!sameColumn(line) || Math.abs(line.y - marker.y) > verticalRadius) return false;
        const value = String(line.text || "").trim();
        const words = value.match(/[A-Za-z]{4,}/g) || [];
        const formulaFragment = /[=+\-*/^_(){}\[\]∑∏√∂∇≤≥]/.test(value) || (/\d/.test(value) && value.length <= 36);
        const horizontallyRelated = line.x < marker.x
          && line.x + line.width >= selectedLeft - 24
          && line.x <= selectedRight + 24;
        return formulaFragment && horizontallyRelated && words.length <= 4 && !/[.!?]$/.test(value);
      });
      selected = [...new Set([...selected, ...fragments])];
      text = [...selected.filter((line) => line !== marker).sort((a, b) => a.y - b.y || a.x - b.x), marker]
        .map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
    }
    const left = Math.min(...selected.map((line) => line.x));
    const right = Math.max(...selected.map((line) => line.x + line.width));
    const top = Math.min(...selected.map((line) => line.y));
    const bottom = Math.max(...selected.map((line) => line.y + line.height));
    const synthetic = { text, x: left, y: top, width: right - left, height: bottom - top };
    return looksLikeFormula(text, synthetic, viewport) ? { ...synthetic, equationNumber } : null;
  }

  function detectPageRegions(lines, viewport, pageNumber) {
    const figures = [];
    const tables = [];
    const formulas = [];
    const pageWidth = Number(viewport.width || 612);
    const pageHeight = Number(viewport.height || 792);
    const marginX = pageWidth * 0.045;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const figureMatch = line.text.match(FIGURE_CAPTION);
      const tableMatch = line.text.match(TABLE_CAPTION);
      if (figureMatch) {
        const region = stabilizePdfAssetRegion(
          computePdfVisualRegion(lines, lineIndex, "figure", viewport),
          viewport,
          "figure"
        );
        const fullCaption = collectPdfCaption(lines, lineIndex, viewport).text;
        figures.push({
          kind: "figure", number: figureMatch[1], caption: fullCaption || figureMatch[2] || line.text, pageNumber,
          ...region
        });
      } else if (tableMatch) {
        const region = stabilizePdfAssetRegion(
          computePdfVisualRegion(lines, lineIndex, "table", viewport),
          viewport,
          "table"
        );
        if (region) {
          const fullCaption = collectPdfCaption(lines, lineIndex, viewport).text;
          tables.push({
            kind: "table", number: tableMatch[1], caption: fullCaption || tableMatch[2] || line.text, pageNumber,
            ...region
          });
        }
      } else {
        const candidate = buildFormulaCandidate(lines, lineIndex, viewport)
          || buildCoreUnnumberedFormulaCandidate(lines, lineIndex, viewport);
        if (!candidate) continue;
        const inferredBounds = inferColumnBounds(candidate, viewport);
        const candidateLeft = Number(candidate.x || 0);
        const candidateRight = candidateLeft + Number(candidate.width || 0);
        const crossesGutter = candidateLeft < pageWidth * 0.46 && candidateRight > pageWidth * 0.54;
        const bounds = crossesGutter
          ? { left: marginX, right: pageWidth - marginX }
          : inferredBounds;
        const horizontalPadding = Math.max(7, Number(candidate.height || 10) * 0.65);
        const x = Math.max(bounds.left, candidateLeft - horizontalPadding);
        const nextLine = lines.filter((entry) => entry.y > candidate.y + candidate.height + 1)
          .filter((entry) => {
            const center = entry.x + entry.width / 2;
            return center >= bounds.left && center <= bounds.right;
          })
          .sort((left, right) => left.y - right.y)[0];
        const verticalPadding = Math.max(4, Math.min(7, candidate.height * 0.24));
        const top = Math.max(pageHeight * 0.025, candidate.y - verticalPadding);
        const naturalBottom = candidate.y + candidate.height + verticalPadding;
        const bottom = Math.min(naturalBottom, nextLine ? nextLine.y - nextLine.height - 3 : naturalBottom);
        formulas.push({
          kind: "formula", caption: candidate.text, equationNumber: candidate.equationNumber,
          confidence: candidate.confidence || "numbered-equation", pageNumber, x,
          y: top,
          width: Math.min(bounds.right - x, candidateRight - x + horizontalPadding),
          height: Math.max(candidate.height + verticalPadding, bottom - top)
        });
      }
    }
    return { figures, tables, formulas };
  }

  function stabilizePdfAssetRegion(region, viewport, kind) {
    if (!region) return region;
    const pageWidth = Number(viewport?.width || 612);
    const pageHeight = Number(viewport?.height || 792);
    const width = Math.max(1, Number(region.width || 0));
    const height = Math.max(1, Number(region.height || 0));
    const aspect = width / height;
    const minimumHeight = kind === "table" ? pageHeight * 0.075 : Math.max(pageHeight * 0.11, width / 6.5);
    if (height >= minimumHeight && aspect <= (kind === "table" ? 9 : 7.5)) return region;

    const bottom = Math.min(pageHeight * 0.975, Number(region.y || 0) + height);
    const targetHeight = Math.min(
      kind === "table" ? pageHeight * 0.3 : pageHeight * 0.38,
      Math.max(minimumHeight, height * 2.4)
    );
    const y = Math.max(pageHeight * 0.035, bottom - targetHeight);
    return {
      ...region,
      x: Math.max(pageWidth * 0.02, Number(region.x || 0)),
      y,
      width: Math.min(pageWidth * 0.96, width),
      height: bottom - y,
      extraction: "geometry-recovered caption crop"
    };
  }

  async function renderPageCanvas(page, scale = 2) {
    const viewport = page.getViewport({ scale });
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = Math.ceil(viewport.width);
    pageCanvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: pageCanvas.getContext("2d"), viewport }).promise;
    return { pageCanvas, scale };
  }

  function computeVisionCropContextBounds(pageWidth, pageHeight, region) {
    const haloX = region.kind === "figure"
      ? Math.max(72, Math.min(pageWidth * 0.42, Number(region.width || 0) * 0.9))
      : region.kind === "table"
        ? Math.max(90, pageWidth * 0.48)
        : Math.max(72, pageWidth * 0.36);
    const haloY = region.kind === "figure"
      ? Math.max(42, Math.min(pageHeight * 0.22, Number(region.height || 0) * 0.55))
      : region.kind === "table"
        ? Math.max(54, Math.min(pageHeight * 0.24, Number(region.height || 0) * 1.25))
        : Math.max(42, Math.min(pageHeight * 0.18, Number(region.height || 0) * 1.1));
    const context = {
      x: Math.max(0, Number(region.x || 0) - haloX),
      y: Math.max(0, Number(region.y || 0) - haloY),
      right: Math.min(pageWidth, Number(region.x || 0) + Number(region.width || 0) + haloX),
      bottom: Math.min(pageHeight, Number(region.y || 0) + Number(region.height || 0) + haloY)
    };
    context.width = context.right - context.x;
    context.height = context.bottom - context.y;
    return context;
  }

  function createVisionCropContext(pageCanvas, region, scale) {
    const pageWidth = pageCanvas.width / scale;
    const pageHeight = pageCanvas.height / scale;
    const context = computeVisionCropContextBounds(pageWidth, pageHeight, region);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(context.width * scale));
    canvas.height = Math.max(1, Math.ceil(context.height * scale));
    canvas.getContext("2d").drawImage(
      pageCanvas,
      Math.floor(context.x * scale), Math.floor(context.y * scale), canvas.width, canvas.height,
      0, 0, canvas.width, canvas.height
    );
    const candidateBox = {
      left: (Number(region.x || 0) - context.x) / context.width,
      top: (Number(region.y || 0) - context.y) / context.height,
      right: (Number(region.x || 0) + Number(region.width || 0) - context.x) / context.width,
      bottom: (Number(region.y || 0) + Number(region.height || 0) - context.y) / context.height
    };
    return { context, candidateBox, imageDataUrl: canvas.toDataURL("image/png") };
  }

  function applyVisionCropBox(region, context, bbox) {
    const values = [bbox?.left, bbox?.top, bbox?.right, bbox?.bottom].map(Number);
    if (!values.every(Number.isFinite)) return region;
    const [left, top, right, bottom] = values.map((value) => Math.max(0, Math.min(1, value)));
    if (right - left < 0.02 || bottom - top < 0.02) return region;
    const refined = {
      ...region,
      x: context.x + left * context.width,
      y: context.y + top * context.height,
      width: (right - left) * context.width,
      height: (bottom - top) * context.height
    };
    const intersectionWidth = Math.max(0, Math.min(refined.x + refined.width, region.x + region.width) - Math.max(refined.x, region.x));
    const intersectionHeight = Math.max(0, Math.min(refined.y + refined.height, region.y + region.height) - Math.max(refined.y, region.y));
    const overlap = intersectionWidth * intersectionHeight;
    const smallerArea = Math.min(refined.width * refined.height, Number(region.width || 0) * Number(region.height || 0));
    return smallerArea > 0 && overlap >= smallerArea * 0.18 ? refined : region;
  }

  function isSafeVisionRefinement(original, refined, inspection = {}) {
    if (!inspection.applied || inspection.complete === false || (inspection.clippedEdges || []).length) return false;
    const originalWidth = Math.max(1, Number(original.width || 0));
    const originalHeight = Math.max(1, Number(original.height || 0));
    const widthRatio = Number(refined.width || 0) / originalWidth;
    const heightRatio = Number(refined.height || 0) / originalHeight;
    const minimumWidthRatio = original.kind === "table" ? 0.72 : 0.62;
    const minimumHeightRatio = original.kind === "table" ? 0.52 : 0.62;
    return widthRatio >= minimumWidthRatio && heightRatio >= minimumHeightRatio;
  }

  async function refinePdfRegionWithVision(pageCanvas, region, scale, deps) {
    const kind = ["figure", "table", "formula"].includes(region.kind) ? region.kind : "figure";
    const usedCalls = Number(visionCropCalls[kind] || 0);
    if (visionCropState === "unavailable" || usedCalls >= 6) return region;
    const inspectionContext = createVisionCropContext(pageCanvas, region, scale);
    const attempts = Math.min(3, 6 - usedCalls);
    let best = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      visionCropCalls[kind] += 1;
      deps?.setStatus?.(`Vision-checking ${region.kind} crop on page ${region.pageNumber}, repair ${attempt}/${attempts}...`, "loading");
      try {
        const response = await fetch("/api/inspect-asset-crop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageDataUrl: inspectionContext.imageDataUrl,
            assetKind: region.kind,
            caption: region.caption || "",
            candidateBox: inspectionContext.candidateBox
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 400 && payload.code === "VISION_NOT_CONFIGURED") {
            visionCropState = "unavailable";
            break;
          }
          continue;
        }
        visionCropState = "available";
        if (!payload.inspection?.applied) continue;
        const candidate = applyVisionCropBox(region, inspectionContext.context, payload.inspection.bbox);
        if (!isSafeVisionRefinement(region, candidate, payload.inspection)) continue;
        const area = Number(candidate.width || 0) * Number(candidate.height || 0);
        const confidence = Number(payload.inspection.confidence || 0);
        if (!best || confidence > best.confidence + 0.02 || Math.abs(confidence - best.confidence) <= 0.02 && area < best.area) {
          best = { candidate, inspection: payload.inspection, area, confidence, attempt };
        }
      } catch (error) {
        console.warn(`Visual crop repair ${attempt} unavailable:`, error);
      }
    }
    if (!best) return region;
    return {
      ...best.candidate,
      visionInspection: { ...best.inspection, repairRounds: attempts, selectedRound: best.attempt },
      extraction: `vision-refined PDF crop (${attempts} quality-gated rounds)`
    };
  }

  function createRawCropCanvas(pageCanvas, region, scale) {
    const sx = Math.max(0, Math.floor(region.x * scale));
    const sy = Math.max(0, Math.floor(region.y * scale));
    const sw = Math.min(pageCanvas.width - sx, Math.max(1, Math.ceil(region.width * scale)));
    const sh = Math.min(pageCanvas.height - sy, Math.max(1, Math.ceil(region.height * scale)));
    const crop = document.createElement("canvas");
    crop.width = sw;
    crop.height = sh;
    crop.getContext("2d").drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return crop;
  }

  function inspectCropEdges(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const band = Math.max(2, Math.min(8, Math.round(Math.min(width, height) * 0.012)));
    const ink = (x, y) => {
      const offset = (y * width + x) * 4;
      return data[offset + 3] >= 20 && (data[offset] < 246 || data[offset + 1] < 246 || data[offset + 2] < 246);
    };
    const ratios = { top: 0, right: 0, bottom: 0, left: 0 };
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < band; y += 1) ratios.top += ink(x, y) ? 1 : 0;
      for (let y = height - band; y < height; y += 1) ratios.bottom += ink(x, y) ? 1 : 0;
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < band; x += 1) ratios.left += ink(x, y) ? 1 : 0;
      for (let x = width - band; x < width; x += 1) ratios.right += ink(x, y) ? 1 : 0;
    }
    ratios.top /= Math.max(1, width * band);
    ratios.bottom /= Math.max(1, width * band);
    ratios.left /= Math.max(1, height * band);
    ratios.right /= Math.max(1, height * band);
    return Object.entries(ratios).filter(([, ratio]) => ratio >= 0.006).map(([edge]) => edge);
  }

  function expandRegionAtEdges(region, edges, pageWidth, pageHeight) {
    const padX = Math.max(12, pageWidth * 0.035);
    const padY = Math.max(12, pageHeight * 0.025);
    const left = Math.max(0, Number(region.x || 0) - (edges.includes("left") ? padX : 0));
    const top = Math.max(0, Number(region.y || 0) - (edges.includes("top") ? padY : 0));
    const right = Math.min(pageWidth, Number(region.x || 0) + Number(region.width || 0) + (edges.includes("right") ? padX : 0));
    const bottom = Math.min(pageHeight, Number(region.y || 0) + Number(region.height || 0) + (edges.includes("bottom") ? padY : 0));
    return { ...region, x: left, y: top, width: right - left, height: bottom - top };
  }

  function cropRegion(pageCanvas, region, scale) {
    let repairedRegion = { ...region };
    let crop = createRawCropCanvas(pageCanvas, repairedRegion, scale);
    let clippedEdges = inspectCropEdges(crop);
    for (let repair = 0; repair < 3 && clippedEdges.length; repair += 1) {
      repairedRegion = expandRegionAtEdges(
        repairedRegion,
        clippedEdges,
        pageCanvas.width / scale,
        pageCanvas.height / scale
      );
      crop = createRawCropCanvas(pageCanvas, repairedRegion, scale);
      clippedEdges = inspectCropEdges(crop);
    }
    const trimmed = trimCanvasWhitespace(crop, Math.max(12, Math.round(10 * scale)));
    return {
      url: trimmed.toDataURL("image/png"),
      region: repairedRegion,
      clippedEdges,
      complete: clippedEdges.length === 0
    };
  }

  function preferCompleteCrop(refinedCrop, originalCrop) {
    if (refinedCrop?.complete) return { crop: refinedCrop, usedFallback: false };
    if (originalCrop?.complete) return { crop: originalCrop, usedFallback: true };
    return { crop: refinedCrop || originalCrop, usedFallback: false };
  }

  function trimCanvasWhitespace(canvas, padding) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = width;
    let right = -1;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] < 20 || (data[offset] > 248 && data[offset + 1] > 248 && data[offset + 2] > 248)) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return canvas;
    left = Math.max(0, left - padding);
    top = Math.max(0, top - padding);
    right = Math.min(width - 1, right + padding);
    bottom = Math.min(height - 1, bottom + padding);
    const trimmed = document.createElement("canvas");
    trimmed.width = right - left + 1;
    trimmed.height = bottom - top + 1;
    trimmed.getContext("2d").drawImage(canvas, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
    return trimmed;
  }

  function selectPdfAssetRegions(regions, limit, kind) {
    const items = (Array.isArray(regions) ? regions : []).map((region, index) => ({ region, index }));
    if (items.length <= limit) return items.map((entry) => entry.region);
    if (kind !== "figure") return items.slice(0, limit).map((entry) => entry.region);
    const semanticPattern = /\b(?:result|performance|evaluation|comparison|ablation|distribution|frequency|proportion|prevalence|mitigation|before[- ]and[- ]after|accuracy|pass@\d+|taxonomy|architecture|framework|pipeline|overview)\b|结果|性能|评估|对比|消融|分布|频率|占比|缓解|分类体系|架构|框架|流程/i;
    const headCount = Math.min(6, limit);
    const selected = items.slice(0, headCount);
    const selectedIndexes = new Set(selected.map((entry) => entry.index));
    const ranked = items.slice(headCount).sort((left, right) => {
      const leftText = `${left.region.caption || ""} ${left.region.number || ""}`;
      const rightText = `${right.region.caption || ""} ${right.region.number || ""}`;
      const leftScore = semanticPattern.test(leftText) ? 20 : 0;
      semanticPattern.lastIndex = 0;
      const rightScore = semanticPattern.test(rightText) ? 20 : 0;
      semanticPattern.lastIndex = 0;
      return rightScore - leftScore || left.index - right.index;
    });
    for (const entry of ranked) {
      if (selected.length >= limit) break;
      if (!selectedIndexes.has(entry.index)) selected.push(entry);
    }
    return selected.sort((left, right) => left.index - right.index).map((entry) => entry.region);
  }

  async function renderDetectedAssets(pdf, pageRegions, deps) {
    const output = { figures: [], tables: [], formulaImages: [] };
    const candidates = [
      ...selectPdfAssetRegions(pageRegions.figures, 10, "figure"),
      ...selectPdfAssetRegions(pageRegions.tables, 4, "table"),
      ...selectPdfAssetRegions(pageRegions.formulas, 6, "formula")
    ];
    const byPage = new Map();
    for (const region of candidates) {
      if (!byPage.has(region.pageNumber)) byPage.set(region.pageNumber, []);
      byPage.get(region.pageNumber).push(region);
    }
    for (const [pageNumber, regions] of byPage) {
      deps.setStatus(`Extracting PDF artwork: page ${pageNumber}`, "loading");
      const page = await pdf.getPage(pageNumber);
      const { pageCanvas, scale } = await renderPageCanvas(page, 3);
      for (const region of regions) {
        const refinedRegion = await refinePdfRegionWithVision(pageCanvas, region, scale, deps);
        const refinedCrop = cropRegion(pageCanvas, refinedRegion, scale);
        const originalCrop = refinedCrop.complete || refinedRegion === region
          ? null
          : cropRegion(pageCanvas, region, scale);
        const selectedCrop = preferCompleteCrop(refinedCrop, originalCrop);
        const crop = selectedCrop.crop;
        const acceptedRegion = selectedCrop.usedFallback
          ? { ...region, extraction: "caption-aware PDF crop (safe fallback after rejected vision refinement)" }
          : refinedRegion;
        if (!crop.complete) {
          console.warn(
            `Rejected incomplete ${region.kind} crop on page ${pageNumber}; clipped edges: ${crop.clippedEdges.join(", ")}`
          );
          continue;
        }
        const url = crop.url;
        if (region.kind === "figure") {
          output.figures.push({
            name: `Figure ${region.number}`, caption: region.caption, source: `Uploaded PDF, page ${pageNumber}`,
            assets: [{
              url, type: "image/png",
              extraction: acceptedRegion.extraction || "caption-aware PDF crop with edge validation",
              cropComplete: true,
              clippedEdges: []
            }]
          });
        } else if (region.kind === "table") {
          output.tables.push({
            name: `Table ${region.number}`, caption: region.caption, source: `Uploaded PDF, page ${pageNumber}`,
            image: { url, type: "image/png", extraction: acceptedRegion.extraction || "caption-aware PDF crop" },
            visionInspection: acceptedRegion.visionInspection || null,
            cropComplete: true,
            clippedEdges: []
          });
        } else {
          output.formulaImages.push({
            name: region.equationNumber ? `Equation (${region.equationNumber})` : `Formula on page ${pageNumber}`,
            caption: region.caption,
            equationNumber: region.equationNumber || "",
            confidence: region.confidence || "",
            source: `Uploaded PDF, page ${pageNumber}`,
            image: { url, type: "image/png" }
          });
        }
      }
    }
    return output;
  }

  global.PaperToolAlgorithms ||= {};
  global.PaperToolAlgorithms.detectArxivId = detectArxivId;
  global.PaperToolAlgorithms.detectPaperUrl = detectPaperUrl;
  global.PaperToolAlgorithms.isPlaceholderDoi = isPlaceholderDoi;
  global.PaperToolAlgorithms.buildPdfAssetPageMap = buildAssetPageMap;
  global.PaperToolAlgorithms.detectPrimaryPaperIdentity = detectPrimaryPaperIdentity;
  global.PaperToolAlgorithms.inferPdfTitle = inferPdfTitle;
  global.PaperToolAlgorithms.inferPdfTitleLines = inferPdfTitleLines;
  global.PaperToolAlgorithms.groupPdfTextItems = groupTextItems;
  global.PaperToolAlgorithms.orderPdfLinesForReading = orderPdfLinesForReading;
  global.PaperToolAlgorithms.detectPdfPageRegions = detectPageRegions;
  global.PaperToolAlgorithms.stabilizePdfAssetRegion = stabilizePdfAssetRegion;
  global.PaperToolAlgorithms.computePdfVisualRegion = computePdfVisualRegion;
  global.PaperToolAlgorithms.collectPdfCaption = collectPdfCaption;
  global.PaperToolAlgorithms.extractPdfInlineMath = extractPdfInlineMath;
  global.PaperToolAlgorithms.computeVisionCropContextBounds = computeVisionCropContextBounds;
  global.PaperToolAlgorithms.applyVisionCropBox = applyVisionCropBox;
  global.PaperToolAlgorithms.refinePdfRegionWithVision = refinePdfRegionWithVision;
  global.PaperToolAlgorithms.isSafeVisionRefinement = isSafeVisionRefinement;
  global.PaperToolAlgorithms.expandRegionAtEdges = expandRegionAtEdges;
  global.PaperToolAlgorithms.cropPdfAssetRegion = cropRegion;
  global.PaperToolAlgorithms.preferCompletePdfCrop = preferCompleteCrop;
  global.PaperToolAlgorithms.selectPdfAssetRegions = selectPdfAssetRegions;
  global.PaperToolDefinitions ||= {};
  global.PaperToolDefinitions.pdfParser = (deps) => ({
    name: "pdf.parse",
    description: "Parse PDF text, coordinates, figures, tables, and formula regions",
    stage: "ingestion", runtime: "browser", inputTypes: ["pdf"],
    run: async ({ file, forcePdfAssets = false }) => {
      visionCropCalls = { figure: 0, table: 0, formula: 0 };
      const pdfjsLib = await deps.waitForPdfJs();
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const metadata = await pdf.getMetadata().catch(() => ({}));
      const pages = [];
      let firstPageLines = [];
      let firstPageViewport = {};
      const inlineFormulas = [];
      const pageRegions = { figures: [], tables: [], formulas: [] };
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        deps.setStatus(`Parsing PDF: page ${pageNumber} / ${pdf.numPages}`, "loading");
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        const lines = groupTextItems(content.items, viewport);
        if (pageNumber === 1) {
          firstPageLines = lines;
          firstPageViewport = viewport;
        }
        inlineFormulas.push(...extractPdfInlineMath(lines));
        const text = orderPdfLinesForReading(lines, viewport).map((line) => line.text).join("\n");
        pages.push(`\n\n## Page ${pageNumber}\n${text}`);
        const regions = detectPageRegions(lines, viewport, pageNumber);
        pageRegions.figures.push(...regions.figures);
        pageRegions.tables.push(...regions.tables);
        pageRegions.formulas.push(...regions.formulas);
      }
      const title = inferPdfTitle(metadata, firstPageLines, file.name, firstPageViewport);
      const detectedTitleLines = inferPdfTitleLines(firstPageLines, firstPageViewport);
      const titleLines = titleLinesMatch(detectedTitleLines, title) ? detectedTitleLines : [];
      const text = `# ${title}${pages.join("")}`;
      const metadataText = JSON.stringify({ info: metadata?.info || {}, metadata: metadata?.metadata?.getAll?.() || {} });
      const identity = detectPrimaryPaperIdentity({
        metadataText,
        firstPageText: pages[0] || "",
        fileName: file.name
      });
      const arxivId = identity.arxivId;
      const shouldDeferPdfAssets = Boolean(arxivId) && !forcePdfAssets;
      const assets = shouldDeferPdfAssets
        ? { figures: [], tables: [], formulaImages: [] }
        : await renderDetectedAssets(pdf, pageRegions, deps);
      return {
        pageCount: pdf.numPages,
        title,
        titleLines,
        text,
        arxivId,
        doi: identity.doi,
        paperUrl: identity.paperUrl,
        assetPageMap: buildAssetPageMap(pageRegions),
        formulas: [...new Set(inlineFormulas)].slice(0, 8),
        pdfAssetsDeferred: shouldDeferPdfAssets,
        ...assets
      };
    },
    summarize: (result) => `${result.pageCount} pages, ${result.text.length} text chars, ${result.figures.length} figures, ${result.tables.length} tables, and ${result.formulaImages.length} formula regions extracted.`
  });
})(window);
