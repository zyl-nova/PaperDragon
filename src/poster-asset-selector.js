(function registerPosterAssetSelector(global) {
  const DEFAULT_LIMITS = { maxFormulas: 2, maxFigures: 2, maxTables: 1 };
  const IMPORTANT_WORDS = [
    "overview", "architecture", "framework", "pipeline", "method", "main", "result",
    "comparison", "performance", "ablation", "analysis", "mitigation", "distribution", "frequency",
    "模型", "方法", "结果", "对比", "消融", "缓解", "分布", "频率"
  ];
  const RESULT_FIGURE_PATTERN = /\b(?:result|experiment|performance|comparison|ablation|evaluation|benchmark|curve|plot|accuracy|bleu|psnr|ssim|bitrate|rate distortion|latency|throughput|scaling|distribution|frequency|proportion|prevalence|mitigation|before[- ]and[- ]after|pass@\d+)\b|结果|实验|性能|对比|消融|评估|曲线|准确率|分布|频率|占比|缓解/i;
  const STRONG_RESULT_FIGURE_PATTERN = /\b(?:result|experiment|performance|ablation|evaluation|benchmark|curve|plot|accuracy|distribution|frequency|proportion|prevalence|mitigation|before[- ]and[- ]after|pass@\d+)\b|结果|实验|性能|消融|评估|曲线|准确率|分布|频率|占比|缓解/i;
  const METHOD_FIGURE_PATTERN = /\b(?:architecture|framework|pipeline|workflow|method overview|model overview|system overview|overall model|network structure|module design|encoding pipeline|decoding pipeline)\b|架构|框架|流程|方法总览|模型总览|网络结构|模块设计/i;
  const METHOD_DETAIL_FIGURE_PATTERN = /\b(?:prompt(?:ing)?|prompt template|instruction template|agent prompt|example problem|worked example|case study|single agent|single component|appendix prompt)\b|提示词|提示模板|单个代理|局部示例|附录示例/i;
  const CORE_FORMULA_PATTERN = /\b(?:rag[- ]?(?:sequence|token)|marginali[sz](?:e|ed|es|ation|ing)?|likelihood|objective|probability|distribution|latent variable|loss|update rule|posterior|retriever|generator|fusion|consistency|hybrid score|ranking score)\b|目标函数|概率|分布|边缘化|损失|更新规则|融合|一致性/i;
  const MAIN_RESULT_TABLE_PATTERN = /\b(?:main|overall|end[- ]to[- ]end|headline|state[- ]of[- ]the[- ]art|benchmark|performance|comparison|pass@\d+)\b|主要结果|总体结果|性能对比|基准/i;
  const ABLATION_TABLE_PATTERN = /\b(?:ablation|contribution of|component contribution|effect of each|without (?:the )?\w+)\b|消融|组件贡献/i;

  function selectPosterAssets(analysis = {}, options = {}) {
    const policy = { ...DEFAULT_LIMITS, ...(options.policy || {}) };
    const requestedPaperType = String(options.paperType || "method").toLowerCase();
    const paperType = resolveAssetPaperType(requestedPaperType, analysis);
    const selectionContext = { allowTemplateSamples: paperType === "guideline" };
    const recommendations = normalizeRecommendations(analysis.assetRecommendations);
    const formulaDecision = assessMechanismFormula(analysis, paperType, policy.requireMechanismFormula);
    const formulaLimit = formulaDecision.required
      ? Math.max(1, Number(policy.maxFormulas ?? DEFAULT_LIMITS.maxFormulas))
      : 0;
    const formulas = selectType("formula", analysis.formulas, recommendations, formulaLimit, analysis, selectionContext);
    const formulaImages = formulas.length
      ? []
      : selectFormulaImages(analysis.formulaImages, recommendations, formulaLimit, analysis);
    const figures = selectFigures(analysis.figures, recommendations, policy.maxFigures, analysis, {
      hasResultTable: array(analysis.tables).length > 0,
      requireResultEvidence: array(analysis.tables).length === 0 || ["empirical", "survey"].includes(paperType),
      methodPaper: ["method", "system"].includes(paperType),
      requireMethodEvidence: ["method", "system"].includes(paperType)
        && Number(policy.maxFigures ?? DEFAULT_LIMITS.maxFigures) >= 2,
      ...selectionContext
    });
    const tables = selectType("table", analysis.tables, recommendations, policy.maxTables, analysis, selectionContext);
    return {
      formulas: formulas.map((entry) => entry.item),
      formulaImages: formulaImages.map((entry) => entry.item),
      figures: figures.map((entry) => attachAnalysis(entry.item, entry.annotation)),
      tables: tables.map((entry) => attachAnalysis(entry.item, entry.annotation)),
      annotations: { formulas: formulas.map((entry) => entry.annotation) },
      stats: {
        formulaDecision,
        formulas: {
          selected: formulas.length || formulaImages.length,
          available: array(analysis.formulas).length || array(analysis.formulaImages).length
        },
        figures: { selected: figures.length, available: array(analysis.figures).filter((item) => hasOriginalArtwork("figure", item)).length },
        tables: { selected: tables.length, available: array(analysis.tables).filter((item) => hasOriginalArtwork("table", item)).length }
      }
    };
  }

  function resolveAssetPaperType(paperType, analysis = {}) {
    if (paperType !== "empirical") return paperType;
    const methodText = normalize(`${analysis.title || ""} ${analysis.summary || ""} ${analysis.method || ""}`);
    const frameworkSignal = /\b(?:is|introduces?|proposes?|presents?|develops?|designs?)\b.{0,120}\b(?:multi-agent |agentic |unified )?(?:prompting )?(?:framework|pipeline|architecture|method|model|system|algorithm)\b/i.test(methodText)
      || /\b(?:framework|pipeline|architecture)\b.{0,120}\b(?:consists? of|comprises?|stages?|agents?|modules?|workflow)\b/i.test(methodText);
    const studySignal = /\b(?:empirical study|research questions?|manual(?:ly)? annotat|annotation protocol|taxonomy study|controlled study)\b/i.test(methodText);
    return frameworkSignal && !studySignal ? "method" : paperType;
  }

  function recoverCoreMechanismFormula(analysis = {}, selection = {}, options = {}) {
    if (array(selection.formulas).length || array(selection.formulaImages).length) return selection;
    const sourceFormulas = array(analysis.sourceFormulas);
    if (!sourceFormulas.length) return selection;
    const paperType = String(options.paperType || "method").toLowerCase();
    const recoveryAnalysis = { ...analysis, formulas: sourceFormulas };
    const formulaDecision = assessMechanismFormula(recoveryAnalysis, paperType, true);
    if (!formulaDecision.required) return selection;
    const recommendations = normalizeRecommendations(analysis.assetRecommendations);
    const recovered = selectType("formula", sourceFormulas, recommendations, 1, recoveryAnalysis, {
      allowTemplateSamples: false
    });
    if (!recovered.length) return selection;
    return {
      ...selection,
      formulas: recovered.map((entry) => entry.item),
      formulaImages: [],
      annotations: {
        ...(selection.annotations || {}),
        formulas: recovered.map((entry) => entry.annotation)
      },
      stats: {
        ...(selection.stats || {}),
        formulaDecision: { ...formulaDecision, recovered: true },
        formulas: { selected: recovered.length, available: sourceFormulas.length }
      }
    };
  }

  function assessMechanismFormula(analysis, paperType, plannedRequirement = false) {
    const candidates = [
      ...array(analysis.formulas).filter(isReliableFormulaCandidate),
      ...array(analysis.formulaImages).filter(isReliableFormulaCandidate)
    ].filter((item) => !isComplexityOnlyFormula(item));
    const mechanismText = normalize(`${analysis.theory || ""} ${analysis.method || ""}`);
    const mechanismSignal = /\b(?:objective|likelihood|probability|distribution|marginali[sz](?:e|ed|es|ation|ing)?|latent variable|loss|posterior|transition|optimization|update rule|attention|projection|entropy|fusion|score)\b|目标函数|概率|分布|边缘化|隐变量|损失|后验|优化|更新规则|注意力|投影|熵|融合|得分/i.test(mechanismText);
    const candidateSignal = candidates.some((item, index) => {
      const text = assetText("formula", item, index);
      const raw = typeof item === "string" ? item : `${item?.name || ""} ${item?.caption || ""}`;
      return CORE_FORMULA_PATTERN.test(text)
        || /[=≈≃∝]/.test(raw)
        || tokenOverlap(text, mechanismText) >= 2;
    });
    const eligiblePaper = paperType !== "guideline";
    const required = Boolean(
      candidates.length
      && eligiblePaper
      && (candidateSignal || plannedRequirement)
      && (mechanismSignal || plannedRequirement)
    );
    return {
      required,
      available: candidates.length,
      reason: required
        ? "A source-grounded equation directly expresses the mechanism described in the method or theory."
        : candidates.length
          ? "Extracted equations do not clearly improve the mechanism explanation."
          : "No reliable source-grounded equation was extracted."
    };
  }

  function selectFormulaImages(value, recommendations, limit, analysis) {
    const ranked = selectType("formula", value, recommendations, array(value).length, analysis);
    const recommended = ranked.filter((entry) => entry.annotation?.recommendedByAgent);
    if (recommended.length) {
      return recommended.slice(0, Math.max(0, Number(limit ?? DEFAULT_LIMITS.maxFormulas)));
    }
    const mechanismImages = ranked.filter((entry) => isMechanismFormulaImage(entry.item));
    return (mechanismImages.length ? mechanismImages : ranked)
      .slice(0, Math.max(0, Number(limit ?? DEFAULT_LIMITS.maxFormulas)));
  }

  function selectFigures(value, recommendations, limit, analysis, options = {}) {
    const items = array(value);
    const configuredLimit = Math.max(0, Math.min(items.length, Number(limit ?? DEFAULT_LIMITS.maxFigures)));
    if (!configuredLimit) return [];
    const ranked = selectType("figure", items, recommendations, items.length, analysis, options);
    const required = [];
    const methodCandidates = ranked
      .filter(isMethodFigureEntry)
      .sort((left, right) => methodOverviewPriority(right) - methodOverviewPriority(left) || right.score - left.score);
    const overviewCandidate = methodCandidates[0];
    const recommendedMethodDetail = methodCandidates.some((entry) =>
      entry.annotation?.recommendedByAgent
      && entry.annotation?.placement === "method"
      && methodOverviewPriority(entry) < methodOverviewPriority(overviewCandidate)
    );
    if (options.requireMethodEvidence
      || (configuredLimit === 1 && options.methodPaper && options.hasResultTable && (overviewCandidate || recommendedMethodDetail))) {
      const methodCandidate = overviewCandidate;
      if (methodCandidate) required.push(methodCandidate);
    }
    if (options.requireResultEvidence) {
      const resultCandidate = ranked.find(isResultFigureEntry);
      if (resultCandidate) required.push(resultCandidate);
    }
    const requiredIndexes = new Set(required.map((entry) => entry.index));
    const hasRequiredMethodFigure = required.some(isMethodFigureEntry);
    const hasOverviewCandidate = methodCandidates.some((entry) =>
      METHOD_FIGURE_PATTERN.test(assetText("figure", entry?.item, entry?.index || 0))
    );
    const optional = ranked.filter((entry) => {
      if (requiredIndexes.has(entry.index)) return false;
      if (isMethodDetailFigureEntry(entry) && (options.methodPaper || hasOverviewCandidate)) return false;
      if (!options.hasResultTable || !hasRequiredMethodFigure) return true;
      return entry.annotation?.recommendedByAgent
        && ["results", "theory"].includes(entry.annotation?.placement);
    });
    return dedupeEntries([...required, ...optional]).slice(0, configuredLimit);
  }

  function isResultFigureEntry(entry) {
    return entry?.annotation?.placement === "results"
      || RESULT_FIGURE_PATTERN.test(assetText("figure", entry?.item, entry?.index || 0));
  }

  function isMethodFigureEntry(entry) {
    const text = assetText("figure", entry?.item, entry?.index || 0);
    const overview = METHOD_FIGURE_PATTERN.test(text);
    if (METHOD_DETAIL_FIGURE_PATTERN.test(text) && !overview) return false;
    return overview || (entry?.annotation?.placement === "method" && entry?.annotation?.recommendedByAgent);
  }

  function isMethodDetailFigureEntry(entry) {
    const text = assetText("figure", entry?.item, entry?.index || 0);
    return METHOD_DETAIL_FIGURE_PATTERN.test(text) && !METHOD_FIGURE_PATTERN.test(text);
  }

  function methodOverviewPriority(entry) {
    const text = assetText("figure", entry?.item, entry?.index || 0);
    const overview = METHOD_FIGURE_PATTERN.test(text) ? 40 : 0;
    const fullPipeline = /\b(?:overall|overview|complete|end[- ]to[- ]end|four[- ]stage|workflow|pipeline|architecture|framework)\b|总体|总览|完整流程/i.test(text) ? 24 : 0;
    const detailPenalty = /\b(?:detail|self[- ]examination|single component|module detail|example)\b|局部|细节|单个模块/i.test(text) ? 10 : 0;
    const promptPenalty = METHOD_DETAIL_FIGURE_PATTERN.test(text) ? 48 : 0;
    return overview + fullPipeline - detailPenalty - promptPenalty;
  }

  function dedupeEntries(entries) {
    const seenIndexes = new Set();
    const seenFigureNumbers = new Set();
    return entries.filter((entry) => {
      if (seenIndexes.has(entry.index)) return false;
      seenIndexes.add(entry.index);
      const number = figureNumber(entry.item);
      if (number && seenFigureNumbers.has(number)) return false;
      if (number) seenFigureNumbers.add(number);
      return true;
    });
  }

  function selectType(type, value, recommendations, limit, analysis, options = {}) {
    const filtered = array(value).filter((item) =>
      (!isTemplateSampleAsset(type, item) || (options.allowTemplateSamples && hasOriginalArtwork(type, item)))
      && (!["figure", "table"].includes(type) || hasOriginalArtwork(type, item))
      && (type !== "formula" || (isReliableFormulaCandidate(item) && !isComplexityOnlyFormula(item)))
    );
    const items = type === "formula" && filtered.every((item) => typeof item === "string")
      ? dedupeFormulaFamilies(filtered)
      : filtered;
    const configuredLimit = limit ?? DEFAULT_LIMITS[`max${capitalize(type)}s`] ?? 0;
    const safeLimit = Math.max(0, Math.min(items.length, Number(configuredLimit)));
    const hasMainResultTable = type === "table" && items.some((item, index) =>
      MAIN_RESULT_TABLE_PATTERN.test(assetText(type, item, index))
    );
    return items.map((item, index) => {
      const recommendation = findRecommendation(type, item, index, recommendations);
      const text = assetText(type, item, index);
      const importance = IMPORTANT_WORDS.reduce((score, word) => score + (text.includes(word) ? 4 : 0), 0);
      const provenance = type === "figure" && array(item?.assets).length ? 5 : type === "table" && (item?.image?.url || item?.pdfCrop?.url) ? 5 : 0;
      const appendixPenalty = /appendix|supplement|附录/.test(text) ? 8 : 0;
      const secondaryEvidencePenalty = type === "table" && /secondary|additional application|附加实验|次要/.test(text) ? 12 : 0;
      const primaryEvidenceBonus = type === "table" ? Math.max(0, 18 - index * 6) : 0;
      const mainResultBonus = type === "table" && MAIN_RESULT_TABLE_PATTERN.test(text) ? 24 : 0;
      const ablationPenalty = type === "table" && hasMainResultTable && ABLATION_TABLE_PATTERN.test(text) ? 18 : 0;
      const recommendationBonus = recommendation
        ? (type === "formula" ? 18 : type === "table" ? 4 : 12) - recommendation.order * 0.1
        : 0;
      const contextRelevance = type === "table"
        ? tokenOverlap(text, analysis.summary || "") * 4
          + tokenOverlap(text, `${analysis.results || ""} ${analysis.experiments || ""}`)
        : tokenOverlap(text, type === "formula"
          ? `${analysis.theory || ""} ${analysis.method || ""}`
          : `${analysis.method || ""} ${analysis.results || ""}`) * 2;
      const mechanismBonus = type === "formula"
        ? (CORE_FORMULA_PATTERN.test(text) ? 18 : 0)
          + Math.min(12, tokenOverlap(text, `${analysis.theory || ""} ${analysis.method || ""}`) * 3)
        : 0;
      return {
        item,
        index,
        score: recommendationBonus
          + importance + provenance + primaryEvidenceBonus + mainResultBonus + contextRelevance + mechanismBonus
          - appendixPenalty - secondaryEvidencePenalty - ablationPenalty - index * 0.01,
        annotation: buildAnnotation(type, item, recommendation, analysis)
      };
    }).sort((left, right) => right.score - left.score).slice(0, safeLimit);
  }

  function dedupeFormulaFamilies(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = formulaFamilyKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function formulaFamilyKey(value) {
    const source = String(value || "")
      .replace(/\\(?:left|right)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/\bmin\b[\s\S]{0,20}\bmax\b[\s\S]{0,30}V\s*\(\s*D\s*,\s*G\s*\)/i.test(source)) return "gan-minimax-objective";
    const lhs = source.split("=")[0]
      .replace(/[^A-Za-z0-9_\\{}]/g, "")
      .toLowerCase();
    return lhs || normalize(source);
  }

  function isComplexityOnlyFormula(item) {
    const value = String(item || "").trim();
    return /^(?:O|Θ|Ω)\s*\([^)]*\)$/i.test(value);
  }

  function isReliableFormulaCandidate(item) {
    if (item && typeof item === "object") {
      return Boolean(item.image?.url || item.pdfCrop?.url || item.caption || item.name);
    }
    const value = String(item || "").trim();
    if (value.length < 3 || /\\(?:author|affiliation|institution|email|orcid|thanks)\b/i.test(value)) return false;
    if (/^[,;:'`.\s\p{L}-]+$/u.test(value)) return false;
    return /[=<>≈≃∝±×÷+*/^_|]|\\(?:sum|prod|int|frac|sqrt|min|max|log|exp|argmin|argmax|mathbb|mathbf|mathrm|operatorname)\b/i.test(value)
      || /[A-Za-z]_[{A-Za-z0-9]|[A-Za-z]\s*\([^)]*[|,][^)]*\)/.test(value);
  }

  function isMechanismFormulaImage(item) {
    const text = normalize(`${item?.name || ""} ${item?.caption || ""}`);
    if (CORE_FORMULA_PATTERN.test(text)) return true;
    if (/\b(?:score|objective|likelihood|probability|loss|posterior|attention|projection)\b/.test(text)
      && /[=≈≃∝]/.test(String(item?.caption || ""))) return true;
    return false;
  }

  function isTemplateSampleAsset(type, item) {
    if (!["figure", "table"].includes(type)) return false;
    const text = normalize(`${item?.name || ""} ${item?.caption || ""}`);
    return /\bsample (?:figure|table)(?: caption| title)?\b/.test(text)
      || /\b(?:replace this|placeholder) (?:figure|table)\b/.test(text);
  }

  function hasOriginalArtwork(type, item) {
    if (type === "figure") return array(item?.assets).some((asset) => asset?.url);
    if (type === "table") return Boolean(item?.image?.url || item?.pdfCrop?.url);
    return false;
  }

  function findRecommendation(type, item, index, recommendations) {
    const identity = assetText(type, item, index);
    return recommendations.find((recommendation) => {
      if (recommendation.type !== type) return false;
      const reference = normalize(recommendation.reference);
      if (!reference) return false;
      if (identity.includes(reference) || reference.includes(identity)) return true;
      const number = reference.match(/\d+/)?.[0];
      return Boolean(number && Number(number) === index + 1 && reference.includes(type));
    });
  }

  function buildAnnotation(type, item, recommendation, analysis) {
    const fallback = type === "formula"
      ? analysis.theory || analysis.method
      : type === "table"
        ? analysis.results || analysis.experiments
        : recommendation?.section === "theory"
          ? analysis.theory || analysis.method
        : /result|performance|comparison|结果|对比/.test(assetText(type, item, 0))
          ? analysis.results || analysis.experiments
          : analysis.method || analysis.summary;
    const annotation = {
      reference: recommendation?.reference || displayName(type, item),
      purpose: recommendation?.purpose || defaultPurpose(type),
      insight: compactAnnotationText(recommendation?.insight || fallback || "Selected as key source evidence for the poster."),
      placement: normalizePlacement(recommendation?.section, type, item),
      recommendedByAgent: Boolean(recommendation)
    };
    return type === "figure" ? groundFigureAnnotation(item, annotation) : annotation;
  }

  function groundFigureAnnotation(item, annotation) {
    const caption = completeText(item?.caption || "");
    if (!caption || tokenOverlap(`${annotation.purpose} ${annotation.insight}`, caption) > 0) return annotation;
    const cleaned = caption.replace(/^(?:figure\s*\d+[a-z]?\s*[:.-]?|example\s*:)\s*/i, "").replace(/[.。]+$/, "");
    if (!cleaned) return annotation;
    const example = /^example\s*:/i.test(caption);
    return {
      ...annotation,
      purpose: example ? `Concrete example of ${cleaned}` : `Original-paper evidence for ${cleaned}`,
      insight: example
        ? `This figure shows a concrete ${cleaned.toLowerCase()} example from the paper.`
        : `This figure directly illustrates ${cleaned}.`
    };
  }

  function attachAnalysis(item, annotation) {
    return typeof item === "string" ? { name: item, source: "Paper text", _posterAnalysis: annotation } : { ...item, _posterAnalysis: annotation };
  }

  function normalizeRecommendations(value) {
    return array(value).map((item, order) => ({
      type: String(item?.type || "").toLowerCase(),
      reference: String(item?.reference || ""),
      section: String(item?.section || "").toLowerCase(),
      purpose: String(item?.purpose || ""),
      insight: String(item?.insight || ""),
      order
    })).filter((item) => ["formula", "figure", "table"].includes(item.type) && item.reference);
  }

  function assetText(type, item, index) {
    if (type === "formula") return normalize(`formula ${index + 1} equation ${index + 1} ${item?.name || ""} ${item?.caption || item || ""}`);
    return normalize(`${type} ${index + 1} ${item?.name || item || ""} ${item?.caption || ""} ${item?.source || ""}`);
  }

  function displayName(type, item) {
    return String(item?.name || item?.caption || `Selected ${type}`);
  }

  function defaultPurpose(type) {
    if (type === "formula") return "Core mechanism";
    if (type === "table") return "Main experimental evidence";
    return "Method or result overview";
  }

  function normalizePlacement(section, type, item) {
    if (type === "figure" && STRONG_RESULT_FIGURE_PATTERN.test(assetText(type, item, 0))) return "results";
    if (section === "results") return "results";
    if (section === "method") return "method";
    if (section === "theory") return "theory";
    return type === "table" ? "results" : type === "figure" ? "method" : "theory";
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  }

  function tokenOverlap(left, right) {
    const ignored = new Set(["the", "and", "with", "from", "that", "this", "into", "model", "method", "figure", "table", "equation"]);
    const leftTokens = new Set(normalize(left).split(" ").filter((token) => token.length >= 4 && !ignored.has(token)));
    const rightTokens = new Set(normalize(right).split(" ").filter((token) => token.length >= 4 && !ignored.has(token)));
    return [...leftTokens].filter((token) => rightTokens.has(token)).length;
  }

  function completeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function compactAnnotationText(value) {
    const text = completeText(value);
    const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g) || [];
    return completeText(sentences.slice(0, 2).join(" ")) || text;
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function figureNumber(item) {
    const match = `${item?.name || ""} ${item?.caption || ""}`.match(/\b(?:figure|fig\.)\s*(\d+[a-z]?)\b/i);
    return match ? match[1].toLowerCase() : "";
  }

  function mergeNumberedFigureArtwork(primaryFigures, fallbackFigures, options = {}) {
    const primary = array(primaryFigures);
    const fallback = array(fallbackFigures);
    if (!primary.length) return fallback;
    const fallbackByNumber = new Map();
    for (const figure of fallback) {
      const number = figureNumber(figure);
      if (number && !fallbackByNumber.has(number)) fallbackByNumber.set(number, figure);
    }
    const merged = primary.map((figure) => {
      if (array(figure?.assets).length) return figure;
      const number = figureNumber(figure);
      const match = number ? fallbackByNumber.get(number) : null;
      return array(match?.assets).length
        ? { ...figure, assets: match.assets, source: `${figure.source || "Original paper figure"}; PDF crop fallback from ${match.source || "uploaded PDF"}` }
        : figure;
    });
    if (!options.includeMissing) return merged;
    const primaryNumbers = new Set(primary.map(figureNumber).filter(Boolean));
    return [...merged, ...fallback.filter((figure) => {
      const number = figureNumber(figure);
      return number && !primaryNumbers.has(number) && array(figure?.assets).length;
    })];
  }

  function needsFigureBackfill(pdfText, figures) {
    const expectedNumbers = new Set(
      [...String(pdfText || "").matchAll(/\b(?:figure|fig\.)\s*(\d+[a-z]?)\b/gi)]
        .map((match) => match[1].toLowerCase())
    );
    const parsed = array(figures);
    const parsedNumbers = new Set(parsed.map(figureNumber).filter(Boolean));
    return parsed.some((figure) => !array(figure?.assets).length)
      || [...expectedNumbers].some((number) => !parsedNumbers.has(number));
  }

  function attachPdfPageReferences(figures, tables, pageMap = {}) {
    const withPage = (item, kind) => {
      const match = `${item?.name || ""} ${item?.caption || ""}`.match(new RegExp(`\\b${kind}\\s*(\\d+[a-z]?)\\b`, "i"));
      const number = match?.[1]?.toLowerCase() || "";
      const page = number ? Number(pageMap?.[`${kind}s`]?.[number] || 0) : 0;
      const pdfCaption = number ? String(pageMap?.[`${kind}Captions`]?.[number] || "").trim() : "";
      const caption = chooseCompleteCaption(item?.caption, pdfCaption);
      if (!page || /(?:page|p\.?)\s*[:#-]?\s*\d+/i.test(String(item?.source || ""))) {
        return caption !== item?.caption ? { ...item, caption } : item;
      }
      const source = String(item?.source || (kind === "figure" ? "LaTeX source" : "Original paper artwork")).trim();
      return { ...item, caption, source: `${source}; Uploaded PDF, page ${page}`, pageNumber: page };
    };
    return {
      figures: array(figures).map((item) => withPage(item, "figure")),
      tables: array(tables).map((item) => withPage(item, "table"))
    };
  }

  function chooseCompleteCaption(primary, pdfCaption) {
    const current = String(primary || "").replace(/\s+/g, " ").trim();
    const candidate = String(pdfCaption || "").replace(/\s+/g, " ").trim();
    if (!candidate || candidate.length <= current.length + 8) return current;
    if (!current) return candidate;
    const currentWords = current.match(/[\p{L}\p{N}]+/gu) || [];
    const endsIncomplete = /\b(?:of|for|with|without|to|from|versus|vs\.?|w\.r\.t\.)$/i.test(current);
    const currentLooksComplete = !endsIncomplete && (/[.!?)]$/.test(current) || currentWords.length >= 8);
    if (currentLooksComplete && candidate.length > current.length * 1.35) return current;
    const tokens = (value) => new Set(normalize(value).split(" ").filter((token) => token.length >= 4));
    const currentTokens = tokens(current);
    const candidateTokens = tokens(candidate);
    const overlap = [...currentTokens].filter((token) => candidateTokens.has(token)).length;
    const required = Math.max(2, Math.min(5, Math.ceil(currentTokens.size * 0.45)));
    return overlap >= required ? candidate : current;
  }

  const api = { selectPosterAssets, recoverCoreMechanismFormula, mergeNumberedFigureArtwork, needsFigureBackfill, attachPdfPageReferences };
  global.PosterAssetSelector = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
