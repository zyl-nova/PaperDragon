(function registerPaperMemory(global) {
  const STORAGE_KEY = "paper-reading-agent.memory.v1";
  const FIELD_SECTIONS = {
    overview: ["summary"],
    problem: ["problem", "motivation"],
    method: ["method"],
    theory: ["theory"],
    experiments: ["experiments"],
    results: ["results", "methodSupportsProblem", "experimentsValidateClaims"],
    contribution: ["contributions", "innovation", "logicReview"]
  };

  function createPaperMemoryStore(storage = global?.localStorage) {
    const readAll = () => {
      try {
        const value = JSON.parse(storage?.getItem(STORAGE_KEY) || "{}");
        return value && typeof value === "object" ? value : {};
      } catch {
        return {};
      }
    };
    const writeAll = (value) => storage?.setItem(STORAGE_KEY, JSON.stringify(value));

    function open({ text, sourceProfile = {} }) {
      const id = fingerprintPaper(text, sourceProfile);
      const all = readAll();
      return normalizeRecord(all[id], id, text, sourceProfile);
    }

    function save(record) {
      const normalized = normalizeRecord(record, record?.id, "", record?.metadata || {});
      normalized.updatedAt = new Date().toISOString();
      const all = readAll();
      all[normalized.id] = normalized;
      writeAll(all);
      return normalized;
    }

    function capture(record, { text, sourceProfile = {}, analysis = {} }) {
      const memory = normalizeRecord(record, fingerprintPaper(text, sourceProfile), text, sourceProfile);
      memory.metadata = {
        ...memory.metadata,
        title: cleanText(analysis.title, 240) || memory.metadata.title,
        sourceType: sourceProfile.sourceType || memory.metadata.sourceType || "text",
        arxivId: sourceProfile.arxivId || memory.metadata.arxivId || "",
        fileName: sourceProfile.fileName || memory.metadata.fileName || "",
        pageCount: Number(sourceProfile.pageCount || memory.metadata.pageCount || 0),
        sourceChars: String(text || "").length,
        analyzedAt: new Date().toISOString()
      };
      memory.sections = buildSectionNotes(analysis, analysis._agent?.evidence || {});
      memory.evidence = flattenEvidence(analysis._agent?.evidence || {});
      memory.analysis = snapshotAnalysis(analysis);
      memory.questions = mergeAutomaticQuestions(memory.questions, analysis._agent?.verification?.missingContent || []);
      return save(memory);
    }

    function addAnnotation(record, text) {
      const value = cleanText(text, 2000);
      if (!value) return record;
      record.annotations.push({ id: makeId("note"), text: value, createdAt: new Date().toISOString() });
      return save(record);
    }

    function deleteAnnotation(record, id) {
      record.annotations = record.annotations.filter((item) => item.id !== id);
      return save(record);
    }

    function addQuestion(record, text) {
      const value = cleanText(text, 1000);
      if (!value) return record;
      record.questions.push({ id: makeId("question"), text: value, status: "open", source: "user", createdAt: new Date().toISOString() });
      return save(record);
    }

    function toggleQuestion(record, id) {
      record.questions = record.questions.map((item) => item.id === id
        ? { ...item, status: item.status === "resolved" ? "open" : "resolved" }
        : item);
      return save(record);
    }

    function deleteQuestion(record, id) {
      record.questions = record.questions.filter((item) => item.id !== id);
      return save(record);
    }

    function toAgentContext(record) {
      if (!record) return null;
      return {
        paperId: record.id,
        metadata: record.metadata,
        sectionSummaries: Object.fromEntries(Object.entries(record.sections).map(([key, value]) => [key, {
          summary: value.summary,
          evidenceLocations: value.evidenceLocations
        }])),
        annotations: record.annotations.slice(-12).map((item) => item.text),
        unresolvedQuestions: record.questions.filter((item) => item.status === "open").slice(-12).map((item) => item.text),
        priorAnalysis: record.analysis
      };
    }

    return { open, save, capture, addAnnotation, deleteAnnotation, addQuestion, toggleQuestion, deleteQuestion, toAgentContext };
  }

  function fingerprintPaper(text, sourceProfile = {}) {
    if (sourceProfile.arxivId) return `arxiv:${String(sourceProfile.arxivId).toLowerCase()}`;
    const normalized = String(text || "").replace(/\s+/g, " ").trim().slice(0, 50000);
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `paper:${(hash >>> 0).toString(16).padStart(8, "0")}:${normalized.length}`;
  }

  function normalizeRecord(value, id, text, sourceProfile) {
    const record = value && typeof value === "object" ? value : {};
    return {
      version: 1,
      id: String(id || record.id || fingerprintPaper(text, sourceProfile)),
      metadata: record.metadata && typeof record.metadata === "object" ? record.metadata : {
        title: "",
        sourceType: sourceProfile?.sourceType || "text",
        arxivId: sourceProfile?.arxivId || "",
        fileName: sourceProfile?.fileName || "",
        pageCount: Number(sourceProfile?.pageCount || 0),
        sourceChars: String(text || "").length
      },
      sections: record.sections && typeof record.sections === "object" ? record.sections : {},
      evidence: Array.isArray(record.evidence) ? record.evidence : [],
      annotations: Array.isArray(record.annotations) ? record.annotations : [],
      questions: Array.isArray(record.questions) ? record.questions : [],
      analysis: record.analysis && typeof record.analysis === "object" ? record.analysis : {},
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt || new Date().toISOString()
    };
  }

  function buildSectionNotes(analysis, evidence) {
    return Object.fromEntries(Object.entries(FIELD_SECTIONS).map(([section, fields]) => {
      const summary = fields.map((field) => cleanText(analysis[field], 1000)).filter(Boolean).join(" ");
      const evidenceItems = Array.isArray(evidence[section === "overview" ? "summary" : section])
        ? evidence[section === "overview" ? "summary" : section]
        : [];
      return [section, {
        summary,
        evidenceLocations: [...new Set(evidenceItems.map((item) => cleanText(item.location, 160)).filter(Boolean))]
      }];
    }));
  }

  function flattenEvidence(evidence) {
    return Object.entries(evidence).flatMap(([section, items]) =>
      (Array.isArray(items) ? items : []).slice(0, 8).map((item) => ({
        section,
        quote: cleanText(item.quote, 400),
        location: cleanText(item.location, 160)
      }))
    ).filter((item) => item.quote).slice(0, 60);
  }

  function snapshotAnalysis(analysis) {
    const fields = ["title", "summary", "problem", "motivation", "method", "theory", "experiments", "results", "contributions", "innovation", "logicReview"];
    return Object.fromEntries(fields.map((field) => [field, cleanText(analysis[field], 1600)]).filter(([, value]) => value));
  }

  function mergeAutomaticQuestions(existing, missingContent) {
    const questions = Array.isArray(existing) ? [...existing] : [];
    const known = new Set(questions.map((item) => item.text.toLowerCase()));
    for (const item of missingContent) {
      const text = cleanText(item, 600);
      if (!text || known.has(text.toLowerCase())) continue;
      questions.push({ id: makeId("question"), text, status: "open", source: "agent", createdAt: new Date().toISOString() });
      known.add(text.toLowerCase());
    }
    return questions;
  }

  function cleanText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const api = { createPaperMemoryStore, fingerprintPaper, normalizeRecord, buildSectionNotes, flattenEvidence };
  global.PaperMemory = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
