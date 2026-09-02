const test = require("node:test");
const assert = require("node:assert/strict");
const { selectPosterAssets, recoverCoreMechanismFormula, mergeNumberedFigureArtwork, needsFigureBackfill, attachPdfPageReferences } = require("./poster-asset-selector");

test("selects only recommended poster assets and retains explanatory text", () => {
  const result = selectPosterAssets({
    theory: "The objective balances task loss and regularization.",
    method: "The architecture prunes hidden layers adaptively.",
    results: "The selected comparison shows lower cost with retained accuracy.",
    formulas: ["a=b", "x=y", "L=L_task+L_reg", "z=1"],
    figures: [
      { name: "Figure 1", caption: "Architecture overview", assets: [{ url: "/one.png" }] },
      { name: "Figure 2", caption: "Ablation study", assets: [{ url: "/two.png" }] },
      { name: "Figure 3", caption: "Appendix examples", assets: [] }
    ],
    tables: [{ name: "Table 1", caption: "Main performance comparison", image: { url: "/main-table.png" } }, { name: "Table 2", caption: "Extra settings", image: { url: "/settings-table.png" } }],
    assetRecommendations: [
      { type: "formula", reference: "Formula 3", purpose: "Training objective", insight: "This equation shows the two optimized terms." },
      { type: "figure", reference: "Figure 2", purpose: "Component evidence", insight: "The ablation isolates the useful component." },
      { type: "table", reference: "Table 1", purpose: "Main result", insight: "The method reduces cost while retaining accuracy." }
    ]
  }, { paperType: "empirical", policy: { maxFormulas: 1, maxFigures: 1, maxTables: 1 } });

  assert.deepEqual(result.formulas, ["L=L_task+L_reg"]);
  assert.equal(result.figures[0].name, "Figure 2");
  assert.equal(result.tables[0].name, "Table 1");
  assert.match(result.annotations.formulas[0].insight, /two optimized terms/);
  assert.match(result.figures[0]._posterAnalysis.insight, /ablation isolates/);
  assert.equal(result.figures[0]._posterAnalysis.placement, "results");
  assert.deepEqual(result.stats.figures, { selected: 1, available: 2 });
});

test("uses conservative type limits and deterministic fallbacks without recommendations", () => {
  const result = selectPosterAssets({
    method: "A compact method explanation.",
    results: "A compact result explanation.",
    formulas: ["f_1", "f_2", "f_3"],
    figures: [{ name: "Figure 1", caption: "Architecture overview", assets: [{ url: "/architecture.png" }] }, { name: "Figure 2", caption: "Appendix", assets: [{ url: "/appendix.png" }] }],
    tables: [{ name: "Table 1", caption: "Performance comparison", image: { url: "/performance.png" } }, { name: "Table 2", caption: "Settings", image: { url: "/settings.png" } }]
  }, { policy: { maxFormulas: 2, maxFigures: 1, maxTables: 1 } });
  assert.equal(result.formulas.length, 0);
  assert.equal(result.figures.length, 1);
  assert.equal(result.tables.length, 1);
  assert.equal(result.figures[0].name, "Figure 1");
  assert.ok(result.figures[0]._posterAnalysis.insight);
});

test("rejects author fragments even when a formula is requested by the plan", () => {
  const result = selectPosterAssets({
    method: "The paper studies hallucination categories through manual annotation.",
    theory: "The study analyzes root causes but introduces no mathematical mechanism.",
    formulas: [", Yanlin Wang"]
  }, { paperType: "empirical", policy: { maxFormulas: 2, requireMechanismFormula: true } });
  assert.deepEqual(result.formulas, []);
  assert.equal(result.stats.formulaDecision.required, false);
});

test("empirical studies retain a mitigation result figure beside the main table", () => {
  const result = selectPosterAssets({
    method: "The study builds a taxonomy through manual annotation.",
    results: "RAG mitigation improves Pass@1 but can introduce retrieval noise.",
    figures: [
      { name: "Figure 1", caption: "Hallucination taxonomy", assets: [{ url: "/taxonomy.png" }] },
      { name: "Figure 3", caption: "Distribution of hallucination categories", assets: [{ url: "/distribution.png" }] },
      { name: "Figure 12", caption: "Before-and-after RAG mitigation results", assets: [{ url: "/mitigation.png" }] }
    ],
    tables: [{ name: "Table 1", caption: "Pass@1 mitigation comparison", image: { url: "/table.png" } }]
  }, { paperType: "empirical", policy: { maxFigures: 2, maxTables: 1 } });
  assert.ok(result.figures.some((figure) => figure.name === "Figure 12"));
  assert.equal(result.figures.find((figure) => figure.name === "Figure 12")._posterAnalysis.placement, "results");
});

test("never selects an LLM figure placeholder as original paper artwork", () => {
  const result = selectPosterAssets({
    method: "CodeCoT uses a four-stage workflow.",
    figures: [
      { name: "Figure 2", caption: "CodeCoT workflow", source: "Original paper figure placeholder", assets: [] }
    ],
    assetRecommendations: [
      { type: "figure", reference: "Figure 2", section: "method", purpose: "Method overview" }
    ]
  }, { paperType: "method", policy: { maxFigures: 1 } });
  assert.deepEqual(result.figures, []);
  assert.deepEqual(result.stats.figures, { selected: 0, available: 0 });
});

test("does not promote a complexity bound as a core mechanism formula", () => {
  const result = selectPosterAssets({
    theory: "The latent bottleneck is the core theoretical mechanism.",
    formulas: ["O(LM^{2})", "O(MN + LN^{2})"],
    assetRecommendations: [
      { type: "formula", reference: "Formula 1", purpose: "Core mechanism", insight: "Complexity bound." }
    ]
  });
  assert.deepEqual(result.formulas, []);
  assert.deepEqual(result.stats.formulas, { selected: 0, available: 2 });
});

test("reserves an original result curve when a paper has no table", () => {
  const result = selectPosterAssets({
    method: "The codec truncates latent values before entropy coding.",
    results: "The selected range balances bitrate and accuracy.",
    figures: [
      { name: "Figure 1", caption: "Architecture overview", assets: [{ url: "/method.png" }] },
      { name: "Figure 2", caption: "Model pipeline", assets: [{ url: "/pipeline.png" }] },
      { name: "Figure 5", caption: "Rate-distortion curves and ablation results", assets: [{ url: "/curve.png" }] }
    ],
    tables: []
  }, { policy: { maxFigures: 2, maxTables: 1 } });

  assert.equal(result.figures.length, 2);
  assert.ok(result.figures.some((figure) => figure.name === "Figure 5"));
  assert.equal(result.figures.find((figure) => figure.name === "Figure 5")._posterAnalysis.placement, "results");
});

test("honors an Agent recommendation that assigns a figure to results", () => {
  const result = selectPosterAssets({
    figures: [{ name: "Figure 3", caption: "Qualitative examples", assets: [{ url: "/examples.png" }] }],
    tables: [],
    assetRecommendations: [{ type: "figure", reference: "Figure 3", section: "results", purpose: "Qualitative result" }]
  }, { policy: { maxFigures: 1 } });

  assert.equal(result.figures[0]._posterAnalysis.placement, "results");
});

test("method papers retain an architecture figure beside a result curve", () => {
  const result = selectPosterAssets({
    figures: [
      { name: "Figure 1", caption: "Overall model architecture", assets: [{ url: "/architecture.png" }] },
      { name: "Figure 2", caption: "Feature alignment principle", assets: [{ url: "/principle.png" }] },
      { name: "Figure 6", caption: "Ablation performance curves", assets: [{ url: "/ablation.png" }] }
    ],
    tables: [],
    assetRecommendations: [
      { type: "figure", reference: "Figure 2", section: "theory", purpose: "Alignment principle" }
    ]
  }, { paperType: "method", policy: { maxFigures: 2, maxTables: 1 } });

  assert.deepEqual(result.figures.map((figure) => figure.name), ["Figure 1", "Figure 6"]);
  assert.equal(result.figures[0]._posterAnalysis.placement, "method");
  assert.equal(result.figures[1]._posterAnalysis.placement, "results");
});

test("method overview prefers the complete CodeCoT workflow over a recommended detail figure", () => {
  const result = selectPosterAssets({
    method: "CodeCoT is a four-stage pipeline with prompting, test generation, code generation, and self-examination.",
    results: "The main benchmark table reports pass@1.",
    figures: [
      { name: "Figure 2", caption: "CodeCoT workflow with four components", assets: [{ url: "/workflow.png" }] },
      { name: "Figure 3", caption: "An illustration of the Self-Examination detail", assets: [{ url: "/self-exam.png" }] }
    ],
    tables: [{ name: "Table 1", caption: "Main pass@1 comparison", image: { url: "/results.png" } }],
    assetRecommendations: [
      { type: "figure", reference: "Figure 3", section: "method", purpose: "Self-examination mechanism" }
    ]
  }, { paperType: "method", policy: { maxFigures: 1, maxTables: 1 } });
  assert.deepEqual(result.figures.map((figure) => figure.name), ["Figure 2"]);
});

test("MapCoder keeps the full pipeline overview instead of appendix agent prompts", () => {
  const result = selectPosterAssets({
    method: "MapCoder is a four-agent pipeline for retrieval, planning, coding, and debugging.",
    results: "The main Pass@1 table reports benchmark improvements.",
    figures: [
      { name: "Figure 1", caption: "Overview of MapCoder and its full pipeline with dynamic traversal", assets: [{ url: "/mapcoder-overview.png" }] },
      { name: "Figure 3", caption: "Prompt for Debugging Agent", assets: [{ url: "/debug-prompt.png" }] },
      { name: "Figure 9", caption: "Prompt for Planning Agent", assets: [{ url: "/planning-prompt.png" }] }
    ],
    tables: [{ name: "Table 2", caption: "Main Pass@1 results", image: { url: "/results.png" } }],
    assetRecommendations: [
      { type: "figure", reference: "Figure 9", section: "method", purpose: "Planning Agent prompt" },
      { type: "figure", reference: "Figure 3", section: "method", purpose: "Debugging Agent prompt" }
    ]
  }, { paperType: "method", policy: { maxFigures: 2, maxTables: 1 } });

  assert.deepEqual(result.figures.map((figure) => figure.name), ["Figure 1"]);
  assert.equal(result.figures[0]._posterAnalysis.placement, "method");
});

test("MapCoder shows one Figure 1 when LaTeX and PDF provide the same overview", () => {
  const result = selectPosterAssets({
    method: "MapCoder is a four-agent pipeline for retrieval, planning, coding, and debugging.",
    figures: [
      { name: "Figure 1", caption: "Overview of MapCoder and its full pipeline", source: "LaTeX source", assets: [{ url: "/latex-overview.png" }] },
      { name: "Figure 1", caption: "Overview of MapCoder and its full pipeline", source: "Uploaded PDF, page 2", assets: [{ url: "/pdf-overview.png" }] },
      { name: "Figure 5", caption: "Pass@1 performance by difficulty", source: "Uploaded PDF, page 7", assets: [{ url: "/results.png" }] }
    ]
  }, { paperType: "method", policy: { maxFigures: 2, maxTables: 0 } });

  assert.equal(result.figures.filter((figure) => figure.name === "Figure 1").length, 1);
  assert.deepEqual(result.figures.map((figure) => figure.name), ["Figure 1", "Figure 5"]);
});

test("MapCoder repairs an empirical misclassification before selecting figures", () => {
  const result = selectPosterAssets({
    title: "MapCoder: Multi-Agent Code Generation for Competitive Problem Solving",
    method: "MapCoder is a multi-agent code generation framework with a retrieval, planning, coding, and debugging pipeline.",
    figures: [
      { name: "Figure 1", caption: "Overview of MapCoder and its full pipeline with dynamic traversal", assets: [{ url: "/mapcoder-overview.png" }] },
      { name: "Figure 3", caption: "Prompt for Debugging Agent", assets: [{ url: "/debug-prompt.png" }] },
      { name: "Figure 9", caption: "Prompt for Planning Agent", assets: [{ url: "/planning-prompt.png" }] }
    ],
    assetRecommendations: [
      { type: "figure", reference: "Figure 9", section: "method", purpose: "Planning Agent prompt" },
      { type: "figure", reference: "Figure 3", section: "method", purpose: "Debugging Agent prompt" }
    ]
  }, { paperType: "empirical", policy: { maxFigures: 2 } });

  assert.deepEqual(result.figures.map((figure) => figure.name), ["Figure 1"]);
});

test("formula selection removes two variants of the same GAN minimax objective", () => {
  const result = selectPosterAssets({
    theory: "The conditional adversarial objective adds y to the generator and discriminator.",
    formulas: [
      "min_G max_D V(D,G) = E_x[log D(x)] + E_z[log(1-D(G(z)))]",
      "min_G max_D V(D,G) = E_x[log D(x|y)] + E_z[log(1-D(G(z|y)))]",
      "L_C = E[log P(C=c|X_real)] + E[log P(C=c|X_fake)]"
    ]
  }, { policy: { maxFormulas: 2 } });
  assert.equal(result.formulas.length, 2);
  assert.match(String(result.formulas[1]), /L_C/);
});

test("prioritizes RAG marginalization equations as key mechanism formulas", () => {
  const result = selectPosterAssets({
    theory: "RAG marginalizes latent retrieved documents using sequence-level and token-level formulations.",
    formulas: [
      "p_eta(z|x) proportional exp(d(z)^T q(x))",
      "p_{RAG-Sequence}(y|x) = sum_z p_eta(z|x) p_theta(y|x,z)",
      "p_{RAG-Token}(y|x) = prod_i sum_z p_eta(z|x) p_theta(y_i|x,z)"
    ]
  }, { policy: { maxFormulas: 2 } });
  assert.deepEqual(result.formulas, [
    "p_{RAG-Sequence}(y|x) = sum_z p_eta(z|x) p_theta(y|x,z)",
    "p_{RAG-Token}(y|x) = prod_i sum_z p_eta(z|x) p_theta(y_i|x,z)"
  ]);
});

test("keeps a RAG mechanism equation even when paper type and visual limits are unfavorable", () => {
  const analysis = {
    theory: "Differentiable retrieval maximizes marginal likelihood over retrieved documents.",
    method: "The retriever and generator are optimized jointly.",
    formulas: [
      "p_{RAG-Sequence}(y|x) = \\sum_z p_\\eta(z|x) p_\\theta(y|x,z)",
      "p_{RAG-Token}(y|x) = \\prod_i \\sum_z p_\\eta(z|x) p_\\theta(y_i|x,z,y_{<i})"
    ],
    formulaImages: [], figures: [], tables: []
  };
  const selected = selectPosterAssets(analysis, {
    paperType: "empirical",
    policy: { maxFormulas: 0, maxFigures: 0, maxTables: 0 }
  });
  assert.equal(selected.stats.formulaDecision.required, true);
  assert.equal(selected.formulas.length, 1);
  assert.match(selected.formulas[0], /RAG-(?:Sequence|Token)/i);
});

test("recovers a core formula from the immutable source set after an intermediate stage drops it", () => {
  const formula = "p_{RAG-Sequence}(y|x) = \\sum_z p_\\eta(z|x) p_\\theta(y|x,z)";
  const analysis = {
    theory: "Training maximizes marginal likelihood over retrieved documents.",
    method: "A retriever and generator are optimized jointly.",
    formulas: [],
    sourceFormulas: [formula],
    formulaImages: [], figures: [], tables: []
  };
  const recovered = recoverCoreMechanismFormula(analysis, {
    formulas: [], formulaImages: [], figures: [], tables: [], annotations: {}, stats: {}
  }, { paperType: "method" });
  assert.deepEqual(recovered.formulas, [formula]);
  assert.equal(recovered.stats.formulaDecision.recovered, true);
});

test("keeps a mechanism formula crop even when the generic visual limit is zero", () => {
  const result = selectPosterAssets({
    theory: "The model marginalizes a latent document distribution to obtain the output probability.",
    formulaImages: [{
      name: "Formula on page 3",
      caption: "p_RAG-Sequence(y|x) ≈ sum_z p_eta(z|x) p_theta(y|x,z)",
      image: { url: "data:image/png;base64,formula" }
    }]
  }, { paperType: "method", policy: { maxFormulas: 0, requireMechanismFormula: true } });
  assert.equal(result.stats.formulaDecision.required, true);
  assert.equal(result.formulaImages.length, 1);
});

test("PDF fallback artwork is merged only when the figure number agrees", () => {
  const primary = [
    { name: "Figure 1", caption: "Inference time, model size, and IoU", source: "LaTeX source", assets: [] },
    { name: "Figure 2", caption: "Method overview", source: "LaTeX source", assets: [] }
  ];
  const fallback = [
    { name: "Figure 2", caption: "Method overview", source: "Uploaded PDF, page 2", assets: [{ url: "data:image/png;base64,figure2" }] }
  ];
  const merged = mergeNumberedFigureArtwork(primary, fallback);

  assert.deepEqual(merged[0].assets, []);
  assert.equal(merged[1].assets[0].url, "data:image/png;base64,figure2");
  assert.match(merged[1].source, /page 2/);
});

test("PDF fallback can append a figure that LaTeX extraction omitted entirely", () => {
  const primary = [
    { name: "Figure 7", caption: "Ablation results", source: "LaTeX source", assets: [{ url: "/figure7.png" }] }
  ];
  const fallback = [
    { name: "Figure 1", caption: "Overview of MapCoder", source: "Uploaded PDF, page 2", assets: [{ url: "/figure1.png" }] },
    { name: "Figure 7", caption: "Ablation results", source: "Uploaded PDF, page 8", assets: [{ url: "/figure7-crop.png" }] }
  ];
  const merged = mergeNumberedFigureArtwork(primary, fallback, { includeMissing: true });

  assert.deepEqual(merged.map((figure) => figure.name), ["Figure 7", "Figure 1"]);
  assert.equal(merged[1].assets[0].url, "/figure1.png");
});

test("PDF figure references trigger backfill when LaTeX omits the overview", () => {
  const sourceText = "Figure 1: Overview of MapCoder. Figure 7 reports an ablation.";
  assert.equal(needsFigureBackfill(sourceText, [
    { name: "Figure 7", assets: [{ url: "/figure7.png" }] }
  ]), true);
  assert.equal(needsFigureBackfill(sourceText, [
    { name: "Figure 1", assets: [{ url: "/figure1.png" }] },
    { name: "Figure 7", assets: [{ url: "/figure7.png" }] }
  ]), false);
});

test("asset explanations remain complete instead of ending with generated ellipses", () => {
  const explanation = `Complete explanation ${"with grounded detail ".repeat(30)}and a final conclusion.`;
  const result = selectPosterAssets({
    theory: `The likelihood objective is the core mechanism. ${explanation}`,
    formulas: ["L = E[log p(x)]"]
  }, { policy: { maxFormulas: 1 } });
  assert.equal(result.annotations.formulas[0].insight, `The likelihood objective is the core mechanism. ${explanation}`.replace(/\s+/g, " ").trim());
  assert.equal(result.annotations.formulas[0].insight.endsWith("..."), false);
});

test("selects the Agent-recommended method-defining PDF formula image", () => {
  const result = selectPosterAssets({
    theory: "The projection discriminator is defined by an inner product between label and feature embeddings.",
    formulas: [],
    formulaImages: [
      { name: "Equation (1)", caption: "standard adversarial loss" },
      { name: "Equation (2)", caption: "log likelihood ratio decomposition" },
      { name: "Equation (3)", caption: "f(x,y) = y^T V phi(x) + psi(phi(x))" }
    ],
    assetRecommendations: [
      { type: "formula", reference: "Equation (3)", section: "theory", purpose: "Projection mechanism" }
    ]
  }, { policy: { maxFormulas: 1 } });
  assert.equal(result.formulaImages.length, 1);
  assert.equal(result.formulaImages[0].name, "Equation (3)");
  assert.deepEqual(result.stats.formulas, { selected: 1, available: 3 });
});

test("keeps only recommended core formula images when secondary equations are available", () => {
  const result = selectPosterAssets({
    theory: "The projection discriminator uses a label-feature inner product.",
    formulaImages: [
      { name: "Equation (1)", caption: "generic adversarial objective" },
      { name: "Equation (2)", caption: "intermediate likelihood ratio" },
      { name: "Equation (3)", caption: "projection discriminator definition" }
    ],
    assetRecommendations: [
      { type: "formula", reference: "Equation (3)", section: "theory", purpose: "Core mechanism" }
    ]
  }, { policy: { maxFormulas: 2 } });
  assert.deepEqual(result.formulaImages.map((item) => item.name), ["Equation (3)"]);
});

test("VLD-RAG keeps the modality-fusion equation instead of a basic embedding definition", () => {
  const result = selectPosterAssets({
    theory: "Modality-consistent fusion combines sparse and dense retrieval scores and penalizes disagreement.",
    formulaImages: [
      { name: "Equation (1)", caption: "For each page image, compute a dense embedding v_i = f_theta(p_i)." },
      { name: "Equation (8)", caption: "The fusion score s(i) = alpha s_sparse(i) + (1-alpha) s_dense(i) - lambda Delta(i)." }
    ]
  }, { paperType: "method", policy: { maxFormulas: 2 } });
  assert.deepEqual(result.formulaImages.map((item) => item.name), ["Equation (8)"]);
});

test("a main result table leaves the only figure slot for the method overview", () => {
  const result = selectPosterAssets({
    method: "VLD-RAG is an agentic hybrid retrieval framework.",
    results: "Table 1 reports retrieval performance.",
    figures: [
      { name: "Figure 1", caption: "Overview of the VLD-RAG framework and retrieval pipeline", assets: [{ url: "/framework.png" }] },
      { name: "Figure 2", caption: "Top-K retrieval performance curves", assets: [{ url: "/results.png" }] }
    ],
    tables: [{ name: "Table 1", caption: "Main retrieval comparison", image: { url: "/table.png" } }],
    assetRecommendations: [
      { type: "figure", reference: "Figure 2", section: "results", purpose: "Result trend" }
    ]
  }, { paperType: "method", policy: { maxFigures: 1, maxTables: 1 } });
  assert.deepEqual(result.figures.map((item) => item.name), ["Figure 1"]);
  assert.equal(result.figures[0]._posterAnalysis.placement, "method");
});

test("primary result context can outrank a secondary recommended table", () => {
  const result = selectPosterAssets({
    summary: "The projection discriminator improves class-conditional ImageNet generation.",
    results: "Projection improves Inception score and intra FID on ImageNet against concat and AC-GANs.",
    tables: [
      { name: "Table 1", caption: "Inception score and intra FID on ImageNet", image: { url: "/main.png" } },
      { name: "Table 2", caption: "MS-SSIM for the secondary super-resolution application", image: { url: "/secondary.png" } }
    ],
    assetRecommendations: [
      { type: "table", reference: "Table 2", section: "results", purpose: "Secondary application" }
    ]
  }, { policy: { maxTables: 1 } });
  assert.equal(result.tables[0].name, "Table 1");
});

test("a main benchmark table outranks a recommended component ablation table", () => {
  const result = selectPosterAssets({
    results: "The framework achieves the best benchmark performance; ablations separately measure component effects.",
    tables: [
      { name: "Table 1", caption: "Main performance comparison against benchmark baselines", image: { url: "/main.png" } },
      { name: "Table 2", caption: "Contribution of different components in the ablation", image: { url: "/ablation.png" } }
    ],
    assetRecommendations: [
      { type: "table", reference: "Table 2", section: "results", purpose: "Component evidence" }
    ]
  }, { paperType: "method", policy: { maxTables: 1 } });
  assert.equal(result.tables[0].name, "Table 1");
});

test("a primary ImageNet table outranks a recommended downstream table", () => {
  const result = selectPosterAssets({
    summary: "The projection discriminator improves class-conditional generation on ImageNet.",
    results: "Projection improves image quality and diversity while also supporting super-resolution.",
    tables: [
      { name: "Table 1", caption: "Inception score and intra FIDs on ImageNet", image: { url: "/main.png" } },
      { name: "Table 2", caption: "Inception accuracy and MS-SSIM on different super-resolution methods", image: { url: "/downstream.png" } }
    ],
    assetRecommendations: [
      { type: "table", reference: "Table 2", section: "results", purpose: "Super-resolution comparison" }
    ]
  }, { policy: { maxTables: 1 } });
  assert.equal(result.tables[0].name, "Table 1");
});

test("a results table prevents an extra qualitative gallery from crowding the method panel", () => {
  const result = selectPosterAssets({
    method: "Projection replaces concatenation with an inner product between condition and feature embeddings.",
    results: "The main table reports ImageNet inception score and intra FID.",
    figures: [
      { name: "Figure 1", caption: "Discriminator architecture comparison", assets: [{ url: "/architecture.png" }] },
      { name: "Figure 2", caption: "Generated samples and category morphing", assets: [{ url: "/gallery.png" }] }
    ],
    tables: [{ name: "Table 1", caption: "Inception score and intra FID on ImageNet", image: { url: "/results.png" } }],
    assetRecommendations: [
      { type: "figure", reference: "Figure 1", section: "method", purpose: "Projection mechanism" },
      { type: "figure", reference: "Figure 2", section: "method", purpose: "Generated examples" }
    ]
  }, { paperType: "method", policy: { maxFigures: 2, maxTables: 1 } });
  assert.deepEqual(result.figures.map((figure) => figure.name), ["Figure 1"]);
});

test("template sample figures and tables are not selected as research evidence", () => {
  const result = selectPosterAssets({
    method: "The document defines conference submission formatting.",
    results: "Authors must satisfy a nine-page limit.",
    figures: [{ name: "Figure 1", caption: "Sample figure caption.", assets: [{ url: "/sample.png" }] }],
    tables: [{ name: "Table 1", caption: "Sample table title", image: { url: "/sample-table.png" } }]
  }, { paperType: "method", policy: { maxFigures: 1, maxTables: 1 } });
  assert.deepEqual(result.figures, []);
  assert.deepEqual(result.tables, []);
});

test("guidelines retain sample artwork as formatting reference examples", () => {
  const result = selectPosterAssets({
    method: "The document defines conference submission formatting.",
    results: "Authors must follow the required visual conventions.",
    figures: [{ name: "Figure 1", caption: "Sample figure caption.", assets: [{ url: "/sample.png" }] }],
    tables: [{ name: "Table 1", caption: "Sample table title", image: { url: "/sample-table.png" } }]
  }, { paperType: "guideline", policy: { maxFigures: 1, maxTables: 1 } });
  assert.equal(result.figures[0].name, "Figure 1");
  assert.equal(result.tables[0].name, "Table 1");
});

test("a figure explanation is repaired when it contradicts the original caption", () => {
  const result = selectPosterAssets({
    method: "The taxonomy contains several hallucination categories.",
    figures: [{
      name: "Figure 3",
      caption: "Example: Functional Requirement Violation.",
      assets: [{ url: "/example.png" }]
    }],
    assetRecommendations: [{
      type: "figure",
      reference: "Figure 3",
      section: "method",
      purpose: "Distribution of hallucination categories",
      insight: "Shows category frequencies across the complete dataset."
    }]
  }, { paperType: "empirical", policy: { maxFigures: 1 } });
  assert.match(result.figures[0]._posterAnalysis.purpose, /Concrete example/i);
  assert.match(result.figures[0]._posterAnalysis.insight, /functional requirement violation example/i);
  assert.doesNotMatch(result.figures[0]._posterAnalysis.insight, /frequenc|distribution/i);
});

test("LaTeX artwork inherits PDF page references for interactive evidence", () => {
  const result = attachPdfPageReferences(
    [{ name: "Figure 2", caption: "Framework overview", source: "overview.png", assets: [{ url: "/overview.png" }] }],
    [{ name: "Table 2", caption: "Main results", source: "table environment in LaTeX source", image: { url: "/table.png" } }],
    { figures: { 2: 4 }, tables: { 2: 12 } }
  );
  assert.match(result.figures[0].source, /Uploaded PDF, page 4/);
  assert.match(result.tables[0].source, /Uploaded PDF, page 12/);
  assert.equal(result.figures[0].pageNumber, 4);
  assert.equal(result.tables[0].pageNumber, 12);
});

test("an incomplete LaTeX caption is enriched from the matching PDF caption", () => {
  const result = attachPdfPageReferences(
    [{ name: "Figure 4", caption: "Relative NDCG@5 performance gain w.r.t.", source: "figure.pdf", assets: [{ url: "/figure.pdf" }] }],
    [],
    {
      figures: { 4: 8 }, tables: {},
      figureCaptions: {
        4: "Relative NDCG@5 performance gain w.r.t. the default ColPali (1024 patches). TabFQuAD finetuning measures the targeted-data effect."
      },
      tableCaptions: {}
    }
  );
  assert.match(result.figures[0].caption, /default ColPali \(1024 patches\)/);
  assert.match(result.figures[0].caption, /targeted-data effect/);
  assert.equal(result.figures[0].pageNumber, 8);
});

test("a complete source caption is not replaced by a much longer PDF prose merge", () => {
  const result = attachPdfPageReferences(
    [{ name: "Figure 1", caption: "Overview of the complete framework and its three processing stages.", source: "overview.pdf", assets: [{ url: "/overview.pdf" }] }],
    [],
    {
      figures: { 1: 4 }, tables: {},
      figureCaptions: {
        1: "Overview of the complete framework and its three processing stages. The next section discusses unrelated implementation details and benchmark settings."
      },
      tableCaptions: {}
    }
  );
  assert.equal(result.figures[0].caption, "Overview of the complete framework and its three processing stages.");
});
