const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeEvidenceItems } = require("./paper-agent");

test("repairs a partial evidence quote and recovers its PDF page", () => {
  const paper = `# Paper\n## Page 1\nIntroduction text.\n## Page 2\nA number of width problems arise when LaTeX cannot properly hyphenate a line.`;
  assert.deepEqual(normalizeEvidenceItems([{
    quote: "A number of width problems arise when LaTeX cannot properly hyphenate a",
    location: "task-relevant retrieved source"
  }], paper), [{
    quote: "A number of width problems arise when LaTeX cannot properly hyphenate a line.",
    location: "Uploaded PDF, page 2"
  }]);
});

test("preserves a specific model-provided location and appends its recovered page", () => {
  const paper = `## Page 4\nThe method reaches 80.5 percent accuracy.`;
  assert.equal(normalizeEvidenceItems([{
    quote: "The method reaches 80.5 percent accuracy.",
    location: "Results section"
  }], paper)[0].location, "Results section, page 4");
});

test("drops isolated PDF word fragments from supporting evidence", () => {
  assert.deepEqual(normalizeEvidenceItems([
    { quote: "V.", location: "Section V" },
    { quote: "A.", location: "Appendix" },
    { quote: "1.", location: "Section 3.2" },
    { quote: "2.", location: "Page 4" },
    { quote: "Test cases.", location: "Page 3" },
    { quote: "iclr.", location: "Submission" },
    { quote: "ctan.", location: "Final instructions" },
    { quote: "Tweaking the style files may be grounds for rejection.", location: "Style" }
  ]), [{
    quote: "Tweaking the style files may be grounds for rejection.",
    location: "Style"
  }]);
});

test("removes a leaked DOI prefix while retaining the supporting sentence", () => {
  assert.deepEqual(normalizeEvidenceItems([{
    quote: "org/10.1145/3690407.3690479 Although traditional optimization requires specialized knowledge.",
    location: "1 Introduction"
  }]), [{
    quote: "Although traditional optimization requires specialized knowledge.",
    location: "1 Introduction"
  }]);
});

test("removes a leaked arXiv running header from an evidence sentence", () => {
  assert.deepEqual(normalizeEvidenceItems([{
    quote: "CL] 12 Apr 2021more specific, diverse and factual language than a parametric baseline.",
    location: "Abstract, page 1"
  }]), [{
    quote: "more specific, diverse and factual language than a parametric baseline.",
    location: "Abstract, page 1"
  }]);
});

test("recovers the complete source sentence from a contaminated PDF evidence fragment", () => {
  const paper = `## Page 1
For example, AgentCoder achieves 96.3% and 91.8% pass@1 with an overall token overhead of 56.9K and 66.3K, while the state-of-the-art obtains 90.2% and 78.9% pass@1 with an overall token overhead of 138.2K and 206.5K.
In recent years, natural language processing has been transformed by large language models.`;
  const result = normalizeEvidenceItems([{
    quote: "For example, AgentCoder achieves 96.3% and 91.8% pass@1 with an overall token overhead of 56.9K and 66.3K, while the state-of-the-art obtains 90.2% and 78.9% pass@1 with an overall token overhead In recent years, natural language processing has been transformed by large language models.",
    location: "Abstract"
  }], paper);
  assert.equal(result[0].quote, "For example, AgentCoder achieves 96.3% and 91.8% pass@1 with an overall token overhead of 56.9K and 66.3K, while the state-of-the-art obtains 90.2% and 78.9% pass@1 with an overall token overhead of 138.2K and 206.5K.");
  assert.equal(result[0].location, "Abstract, page 1");
});

test("drops evidence that visibly merges two paper sections", () => {
  const result = normalizeEvidenceItems([{
    quote: "The approach reduces inference cost Introduction We now describe the proposed architecture.",
    location: "Abstract"
  }]);
  assert.deepEqual(result, []);
});
