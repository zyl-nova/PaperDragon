const test = require("node:test");
const assert = require("node:assert/strict");
const integrity = require("./content-integrity");

const CODECOR_PHASES = `
Phase-I: Prompt Generation
Phase-II: Test Case Generation
Phase-III: Code Generation
Phase-IV: Result Checking
Phase-V: Code Repairing
`;

test("extracts a complete ordered phase sequence from the paper source", () => {
  assert.deepEqual(integrity.extractOrderedPhases(CODECOR_PHASES), [
    { number: 1, title: "Prompt Generation" },
    { number: 2, title: "Test Case Generation" },
    { number: 3, title: "Code Generation" },
    { number: 4, title: "Result Checking" },
    { number: 5, title: "Code Repairing" }
  ]);
});

test("repairs an incomplete four-phase method narrative from five source phases", () => {
  const repaired = integrity.repairPhaseNarrative(
    "The pipeline proceeds in four phases: prompt generation, test case generation, code generation, and result checking, where each phase prunes weak outputs.",
    CODECOR_PHASES
  );
  assert.match(repaired, /proceeds in five phases/i);
  assert.match(repaired, /Code Repairing/i);
  assert.doesNotMatch(repaired, /four phases/i);
});

test("does not invent phase structure when the source has no complete sequence", () => {
  const original = "The framework uses four phases for analysis.";
  assert.equal(integrity.repairPhaseNarrative(original, "Phase-I: Read\nPhase-III: Write"), original);
});
