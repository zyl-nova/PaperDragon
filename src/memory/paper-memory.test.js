const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaperMemoryStore, fingerprintPaper } = require("./paper-memory");

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
}

test("paper memory persists structured notes independently per paper", () => {
  const store = createPaperMemoryStore(fakeStorage());
  let memory = store.open({ text: "# Method\nSparse attention.", sourceProfile: { sourceType: "text" } });
  memory = store.addAnnotation(memory, "Compare this assumption with the baseline.");
  memory = store.addQuestion(memory, "Does the ablation isolate attention?");
  memory = store.capture(memory, {
    text: "# Method\nSparse attention.",
    sourceProfile: { sourceType: "text" },
    analysis: {
      title: "Sparse Model",
      method: "The method uses sparse attention.",
      _agent: {
        evidence: { method: [{ quote: "Sparse attention", location: "Method" }] },
        verification: { missingContent: ["Dataset details remain missing."] }
      }
    }
  });

  const restored = store.open({ text: "# Method\nSparse attention.", sourceProfile: { sourceType: "text" } });
  assert.equal(restored.metadata.title, "Sparse Model");
  assert.equal(restored.annotations.length, 1);
  assert.equal(restored.evidence[0].location, "Method");
  assert.equal(restored.questions.filter((item) => item.status === "open").length, 2);
  assert.match(store.toAgentContext(restored).sectionSummaries.method.summary, /sparse attention/i);
  const cleaned = store.deleteQuestion(restored, restored.questions[0].id);
  assert.equal(cleaned.questions.length, 1);
});

test("arXiv memory identity remains stable when extracted text changes", () => {
  assert.equal(
    fingerprintPaper("first extraction", { arxivId: "1706.03762" }),
    fingerprintPaper("second extraction", { arxivId: "1706.03762" })
  );
});
