const test = require("node:test");
const assert = require("node:assert/strict");
const { renderInlineMath, normalizeFormula, toPlainMath, toReadableMathHtml, extractInlineMath, preservesInlineMath, repairMissingInlineMath } = require("./inline-math");

test("renders complexity notation inline without depending on MathJax", () => {
  const html = renderInlineMath("The model has O(MN + LN^2) complexity <without clipping>.");
  assert.match(html, /poster-inline-math/);
  assert.match(html, /O\(MN <wbr>\+ LN<sup>2<\/sup>\)/);
  assert.match(html, /&lt;without clipping&gt;/);
});

test("detects and renders an unwrapped minimax equation inside a theory paragraph", () => {
  const html = renderInlineMath("The objective is the minimax game: min_G max_D V(D,G) = E_{x~p_data(x)}[log D(x|y)] + E_{z~p_z(z)}[log(1 - D(G(z|y)))].");
  assert.match(html, /poster-inline-math/);
  assert.match(html, /math-operator">min<\/span><sub>G<\/sub>/);
  assert.match(html, /math-operator">max<\/span><sub>D<\/sub>/);
  assert.match(html, /math-expectation">𝔼<\/span><sub>x∼p_data\(x\)<\/sub>/);
  assert.match(html, /D\(x∣y\)/);
  assert.doesNotMatch(html, /<sub>[^<]*<sub>/);
});

test("adds safe wrap opportunities to long readable formulas", () => {
  const html = toReadableMathHtml("min_G max_D V(D,G) = E_x[log D(x)] + E_z[log(1-D(G(z)))]");
  assert.match(html, /<wbr>=/);
  assert.match(html, /<wbr>\+/);
});

test("improves common conditional-model notation without changing paragraph structure", () => {
  const html = renderInlineMath("The model samples c ~ p_c, produces X_fake = G(c, z), predicts P(S|X) and P(C|X), and optimizes L_S.");
  assert.match(html, /c ∼ p<sub>c<\/sub>/);
  assert.match(html, /X<sub>fake<\/sub> <wbr>= G\(c, z\)/);
  assert.match(html, /P\(S∣X\)/);
  assert.match(html, /P\(C∣X\)/);
  assert.match(html, /L<sub>S<\/sub>/);
});

test("normalizes common unicode math glyphs for MathJax", () => {
  assert.equal(normalizeFormula("$N² ≤ M³$"), "N^{2} \\leq  M^{3}");
});

test("converts common LaTeX complexity notation to readable inline text", () => {
  assert.equal(toPlainMath("\\mathcal{O}(MN + LN^{2})"), "O(MN + LN²)");
});

test("detects when an automatic rewrite drops an existing formula", () => {
  const original = "The mechanism has O(MN + LN^2) complexity.";
  assert.deepEqual(extractInlineMath(original), ["O(MN + LN^2)"]);
  assert.equal(preservesInlineMath(original, "The mechanism has O(MN + LN^2) complexity and scales well."), true);
  assert.equal(preservesInlineMath(original, "The mechanism has a complexity where M is the input size."), false);
});

test("repairs a missing complexity slot from source-grounded formulas", () => {
  const text = "The latent bottleneck yields complexity where M is input size and N is latent size.";
  const repaired = repairMissingInlineMath(text, ["\\mathcal{O}(MN + LN^{2})"]);
  assert.match(repaired, /complexity \\\(O\(MN \+ LN\^\{2\}\)\\\), where/);
  assert.deepEqual(extractInlineMath(repaired), ["O(MN + LN^{2})"]);
});

test("does not invent a formula without source evidence", () => {
  const text = "The method has lower complexity where N is the latent size.";
  assert.equal(repairMissingInlineMath(text, ["x = y"]), text);
});

test("selects the source complexity expression matching variables named in the theory", () => {
  const text = "The mechanism has complexity where M is input size, N is latent size, and L is layer count.";
  const repaired = repairMissingInlineMath(text, ["O(LM2), O(LN2), and O(MN + LN2)"]);
  assert.match(repaired, /O\(MN \+ LN\^\{2\}\)/);
});

test("repairs an empty from-to comparison instead of leaving blank formula slots", () => {
  const text = "Cross-attention reduces complexity from to, where M is input size, N is latent size, and L is layer count.";
  const repaired = repairMissingInlineMath(text, ["O(MN + LN2)"]);
  assert.match(repaired, /complexity to \\\(O\(MN \+ LN\^\{2\}\)\\\), where/);
  assert.doesNotMatch(repaired, /from\s+to/);
});
