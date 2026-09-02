const ANALYSIS_FIELDS = [
  "title", "summary", "problem", "motivation", "method", "theory", "experiments", "results",
  "contributions", "innovation", "logicReview", "methodSupportsProblem", "experimentsValidateClaims"
];

function buildTaskAnalysisPrompt(task, paperContext, observation = {}, memory = null) {
  const fieldSchema = task.fields.map((field) => `    "${field}": "poster-ready answer"`).join(",\n");
  return `Execute one task in a larger paper-reading plan and return only valid JSON.

CURRENT TASK:
- id: ${task.id}
- goal: ${task.goal}
- output fields: ${task.fields.join(", ")}
- task priority: ${task.priority || "standard"}
- required evidence: ${(task.requiredEvidence || []).join(", ") || "task-relevant source evidence"}
- retrieval round: ${Number(observation.round || 1)}
${observation.previousIssue ? `- previous issue: ${observation.previousIssue}` : ""}

ACTIVE SECTION-WRITING SKILL:
${task.skillGuidance ? `- instruction: ${task.skillGuidance.instruction}\n- paper-type advice: ${task.skillGuidance.typeAdvice}\n- maximum sentences per field: ${task.skillGuidance.maxSentences}` : "Use concise evidence-grounded academic writing."}

RULES:
- Use only evidence present in PAPER EVIDENCE. Never invent metrics, datasets, formulas, or claims.
- Work only on CURRENT TASK. Do not analyze unrelated parts of the paper.
- Each analytical claim must be concise and poster-ready.
- Lead with the conclusion, then add only the strongest supporting evidence or qualifier.
- Summary must name the central approach and finish its headline result with a complete comparison target.
- Use complete sentences within the requested sentence limit. Do not trail off, use ellipses, or copy long source passages.
- Synthesize problem, motivation, and contribution from evidence. Never return a figure/table caption, heading, isolated clause, or line-broken source fragment as an answer.
- Problem must state the prior limitation and its consequence. Motivation must explain why solving it matters.
- Contributions must identify what the paper proposes, introduces, designs, or demonstrates as its supported novelty. An accuracy, score, improvement, or other experimental outcome belongs in results and cannot be the contribution by itself.
- When the source explicitly lists several contributions, cover the framework, its defining mechanisms, and its supported validation in two or three complete sentences rather than returning only the first bullet.
- Results must prioritize the primary comparison and include its strongest grounded number. Include an ablation conclusion when the paper uses ablation to validate the proposed mechanisms.
- logicReview must state whether the evidence supports the argument and preserve an explicit limitation, cost, or validity threat when one is available.
- If evidence is missing, say "not found in provided context".
- Preserve the paper's language when practical.
- Evidence quotes must be exact short verbatim fragments from PAPER EVIDENCE. They are checked programmatically.
- Recommend an asset only when CURRENT TASK genuinely benefits from one. Use an exact identifier present in PAPER EVIDENCE, such as "Figure 2", "Table 1", or "Equation (3)".
- Each asset recommendation must explain what a reader should learn from it. Do not recommend every available asset.
- For method evidence, prefer the figure that directly exposes the proposed architecture or mechanism over sample galleries or downstream applications.
- Preserve named component and agent responsibilities exactly. Never transfer an action from one named role to another; for example, distinguish a component that designs tests from one that only executes them.
- Method fields must describe the pipeline and component interactions. Put benchmark scores, superiority claims, and ablation outcomes in results rather than using them as a method step.
- For result evidence, prefer the paper's primary benchmark, headline comparison, learning curve, or main quantitative table. Treat secondary applications, qualitative galleries, and appendix evidence as fallbacks unless they support the paper's main claim more directly.
- A core formula must express the proposed mechanism, objective, update rule, or theorem. Do not present a standalone time/space complexity bound as the paper's core formula; use a concise theory explanation instead when no method-defining equation is present.
- When several equations are available, recommend the equation that defines the proposed method itself, not a standard background loss or an intermediate derivation. Use the exact equation number from PAPER EVIDENCE.
- Explain formula meaning only when requested by CURRENT TASK; deterministic extraction preserves exact notation separately.
- PRIOR READING MEMORY is navigation context, not paper evidence. It may guide attention or identify an unresolved question, but it cannot support a claim or an evidence quote.

JSON SCHEMA:
{
  "status": "complete or insufficient_evidence",
  "fields": {
${fieldSchema}
  },
  "evidence": [{"quote":"short source quote","location":"section heading"}],
  "assetRecommendations": [{"type":"formula, figure, or table","reference":"exact source identifier","section":"method, theory, or results","purpose":"role in the argument","insight":"one concise interpretation for the poster"}]
}

PAPER EVIDENCE:
${paperContext}

PRIOR READING MEMORY:
${memory?.available ? JSON.stringify(memory) : "No prior memory available."}`;
}

function buildVerificationPrompt(analysis, paperContext, audit = {}, evidence = {}, sourceProfile = {}) {
  const compactAnalysis = Object.fromEntries(ANALYSIS_FIELDS.map((field) => [field, analysis[field] || ""]));
  return `Act as a strict paper-analysis verifier. Return only valid JSON.

Check whether the draft is supported by PAPER CONTEXT. Use the deterministic audit and grounded evidence map. Focus on evidence grounding, formula and figure provenance, missing qualifiers, method/problem fit, experiment/claim fit, and omitted key content. Do not rewrite fields that are already supported. Never add a number that is absent from PAPER CONTEXT.
Also compare every named agent or component against the source description and reject any draft that swaps their responsibilities.

JSON SCHEMA:
{
  "verdict": "pass" or "revise",
  "summary": "brief verification summary",
  "confidence": 0.0,
  "checks": [
    {"id":"evidence-grounding","name":"evidence grounding","ok":true,"severity":"high","detail":"brief reason","fields":[]},
    {"id":"asset-provenance","name":"formula and figure provenance","ok":true,"severity":"high","detail":"brief reason","fields":[]},
    {"id":"method-support","name":"method supports problem","ok":true,"severity":"high","detail":"brief reason","fields":[]},
    {"id":"experiment-support","name":"experiments validate claims","ok":true,"severity":"high","detail":"brief reason","fields":[]},
    {"id":"missing-content","name":"key content completeness","ok":true,"severity":"medium","detail":"brief reason","fields":[]}
  ],
  "missingContent": ["field or topic that remains missing"],
  "unsupportedClaims": ["unsupported draft claim"],
  "corrections": {"fieldName":"replacement text only for unsupported or materially incomplete fields"}
}

DRAFT:
${JSON.stringify(compactAnalysis)}

SOURCE PROFILE:
${JSON.stringify(sourceProfile)}

DETERMINISTIC AUDIT:
${JSON.stringify(audit)}

GROUNDED EVIDENCE MAP:
${JSON.stringify(evidence)}

PAPER CONTEXT:
${paperContext}`;
}

module.exports = { ANALYSIS_FIELDS, buildTaskAnalysisPrompt, buildVerificationPrompt };
