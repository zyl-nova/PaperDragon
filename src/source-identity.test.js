const test = require("node:test");
const assert = require("node:assert/strict");
const identity = require("./source-identity");

test("binds the complete PDF title and DOI to one source identity", () => {
  const source = identity.create({
    sourceType: "pdf",
    title: "Code Optimization Chain-of-Thought: Structured Understanding and Self-Checking",
    doi: "10.1145/3690407.3690479"
  }, "# Code Optimization Chain-of-Thought: Structured Understanding and Self-Checking\n\n## Page 1\nhttps://doi.org/10.1145/3690407.3690479");
  assert.equal(source.consistent, true);
  assert.equal(source.title, "Code Optimization Chain-of-Thought: Structured Understanding and Self-Checking");
  assert.equal(source.paperUrl, "https://doi.org/10.1145/3690407.3690479");
});

test("rejects the observed stale-title and new-link cross-paper mixture", () => {
  const mixed = identity.create({
    sourceType: "pdf",
    title: "Code Optimization Chain-of-Thought: Structured Understanding and Self-Checking",
    doi: "10.1145/3690407.3690479"
  }, "# Formatting Instructions for ICLR 2024 Conference Submissions\n\n## Page 1\nSubmission instructions.");
  assert.equal(mixed.consistent, false);
  assert.deepEqual(mixed.conflicts, ["title"]);
  assert.throws(() => identity.assertConsistent(mixed), /Conflicting title metadata/);
});

test("repairs stale title metadata from the newly extracted paper without another upload", () => {
  const repaired = identity.reconcile({
    sourceType: "pdf",
    title: "Formatting Instructions for ICLR 2024 Conference Submissions",
    doi: "10.1145/3690407.3690479"
  }, "# Code Optimization Chain-of-Thought: Structured Understanding and Self-Checking\n\n## Page 1\nhttps://doi.org/10.1145/3690407.3690479");
  assert.equal(repaired.consistent, true);
  assert.equal(repaired.repaired, true);
  assert.deepEqual(repaired.repairedFields, ["title"]);
  assert.equal(repaired.title, "Code Optimization Chain-of-Thought: Structured Understanding and Self-Checking");
  assert.equal(repaired.paperUrl, "https://doi.org/10.1145/3690407.3690479");
});

test("repairs conflicting embedded DOI from the current PDF first page", () => {
  const repaired = identity.reconcile({
    sourceType: "pdf",
    title: "Current Paper",
    doi: "10.1000/stale"
  }, "# Current Paper\n\n## Page 1\nhttps://doi.org/10.1000/current");
  assert.equal(repaired.consistent, true);
  assert.deepEqual(repaired.repairedFields, ["doi"]);
  assert.equal(repaired.paperUrl, "https://doi.org/10.1000/current");
});

test("rejects arXiv enrichment from a different paper while accepting title formatting differences", () => {
  const profile = {
    sourceType: "pdf",
    title: "Pix2Vox: Context-aware 3D Reconstruction from Single and Multi-view Images",
    detectedArxivId: "1901.11153v2"
  };
  assert.equal(identity.enrichmentMatches(profile, {
    id: "1901.11153",
    title: "Pix2Vox: Context-aware 3D Reconstruction from Single and Multi-view Images"
  }), true);
  assert.equal(identity.enrichmentMatches(profile, {
    id: "1901.11153v2",
    title: "Formatting Instructions for ICLR Conference Submissions"
  }), false);
  assert.equal(identity.enrichmentMatches(profile, {
    id: "2401.00001",
    title: profile.title
  }), false);
});

test("different paper text cannot match merely because a DOI was reused", () => {
  const profile = { title: "Paper A", doi: "10.1145/3690407.3690479" };
  const first = identity.create(profile, "# Paper A\nFirst paper content.");
  const second = identity.create(profile, "# Paper A\nEntirely different paper content.");
  assert.equal(identity.matches(first, second), false);
});

test("DOI extraction is limited to the first PDF page", () => {
  const source = identity.create({ sourceType: "pdf", title: "A Paper" }, "# A Paper\n## Page 1\nNo DOI here.\n## Page 2\nReference https://doi.org/10.1000/reference-only");
  assert.equal(source.doi, "");
  assert.equal(source.paperUrl, "");
});

test("arXiv source identity does not promote a cited DOI to the paper link", () => {
  const source = identity.create({ sourceType: "arxiv", arxivId: "2401.01234", title: "A Paper" }, "# A Paper\nIntroduction cites https://doi.org/10.1000/another-paper.");
  assert.equal(source.doi, "");
  assert.equal(source.paperUrl, "https://arxiv.org/abs/2401.01234");
});

test("template placeholder DOI is rejected in favor of the current arXiv paper", () => {
  const source = identity.create({
    sourceType: "pdf",
    title: "CodeCoR: An LLM-Based Self-Reflective Multi-Agent Framework for Code Generation",
    detectedArxivId: "2501.07811v1",
    doi: "10.1145/nnnnnnn.nnnnnnn"
  }, "# CodeCoR: An LLM-Based Self-Reflective Multi-Agent Framework for Code Generation\n\n## Page 1\nhttps://doi.org/10.1145/nnnnnnn.nnnnnnn");
  assert.equal(source.doi, "");
  assert.equal(source.paperUrl, "https://arxiv.org/abs/2501.07811v1");
});

test("preserves alphanumeric model names while repairing concatenated years", () => {
  assert.equal(identity.cleanTitle("Pix2Vox: Context-aware Reconstruction"), "Pix2Vox: Context-aware Reconstruction");
  assert.equal(identity.cleanTitle("ICLR 2024Conference Submissions"), "ICLR 2024 Conference Submissions");
});

test("uses enriched LaTeX text as the canonical identity representation", () => {
  const pdfText = "# A Unified Paper\n\n## Page 1\nPDF text layer with wrapped words.";
  const latexText = "# A Unified Paper\n\nExpanded LaTeX source with equations and sections.";
  const selected = identity.canonicalText(latexText, pdfText);
  const analyzed = identity.create({ sourceType: "arxiv", arxivId: "2601.00001", title: "A Unified Paper" }, latexText);
  const previewed = identity.create({ sourceType: "arxiv", arxivId: "2601.00001", title: "A Unified Paper" }, selected);
  assert.equal(selected, latexText);
  assert.equal(identity.matches(analyzed, previewed), true);
  assert.notEqual(identity.hashText(pdfText), identity.hashText(latexText));
});

test("falls back to PDF text when no enriched source is available", () => {
  assert.equal(identity.canonicalText("", "# PDF Paper"), "# PDF Paper");
});
