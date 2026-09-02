---
name: paper-type-classifier
description: Classify an academic paper as method, theory, empirical, survey, system, or dataset/benchmark and identify its evidence priorities. Use before building a reading plan or deciding which sections and assets deserve emphasis.
---

# Classify Paper Type

1. Inspect the abstract, headings, contribution statements, formulas, experiments, and asset references.
2. Choose one primary type. Retain secondary signals instead of claiming certainty when evidence is mixed.
3. Return the type, confidence, detected characteristics, and reading priorities defined by `schema.json`.
4. Prefer observable paper signals. Do not infer a type only from the title.

## Type Rules

- `method`: proposes an algorithm, architecture, model, objective, or training procedure.
- `theory`: centers definitions, assumptions, theorems, proofs, or formal guarantees.
- `empirical`: centers measurements, comparisons, observations, or controlled studies.
- `survey`: organizes prior work into a taxonomy, review, or meta-analysis.
- `system`: centers implementation, architecture, deployment, throughput, latency, or scalability.
- `dataset`: introduces a dataset, benchmark, task, annotation process, or evaluation protocol.

When multiple types are plausible, choose the type that best explains the paper's main claimed contribution.
