# Implementation Guide: Generic Onboarding + Agentic Refinement + Validation Loop

> **Status:** Implementation-ready guide. No code changes yet.
> **Scope:** Build the reusable system that lets any team adopt `schema-context-mcp` on their own warehouse, business logic, docs, and metrics.
> **Prerequisite:** The MCP server (7 tools, config system, eval framework, merger, connector) is already built and proven working for one environment (Savvy Wealth / BigQuery / RevOps).

---

## 1. Feature Summary

### What this is

A generic, repeatable workflow for onboarding new teams onto `schema-context-mcp`. The workflow takes a team from "I have a warehouse and some docs" to "I have a production-ready annotated schema config with eval coverage and promotion readiness."

### Why it exists

The MCP server itself is fully generic — no domain-specific code in any tool implementation. But adopting it requires:

- Bootstrapping a `schema-config.yaml` from scratch
- Writing eval cases that test the config against the team's business logic
- Validating annotations against the live warehouse
- Iterating on failures until promotion criteria are met
- Human review at defined gates

Today this process was done manually for Savvy across 25 phases. The goal is to reduce a new team's onboarding from weeks of hand-crafting to a structured, partially-automated workflow.

### What it is NOT

- Not a fully autonomous self-healing system — human approval is required at defined gates
- Not a SaaS product or interactive UI — it's CLI tools + markdown checklists
- Not an npm packaging effort — that is separate and downstream

---

## 2. What Users Must Provide

### Required (blocks all progress without these)

| Input | Description | How it's used |
|---|---|---|
| **Warehouse credentials** | Service account key or ADC for BigQuery (or future connector) | `health_check`, `describe_view`, all live schema queries |
| **Project ID** | GCP project (or equivalent for other connectors) | Config `connection.project` |
| **Dataset name(s)** | At least one dataset containing views/tables to annotate | Config `connection.datasets` |

### Recommended (significantly improves onboarding quality)

| Input | Description | How it's used |
|---|---|---|
| **Source documentation** | Markdown docs describing views, fields, rules, gotchas — any format | Bootstrap extraction → draft config |
| **3-5 critical business rules** | The rules that, if violated, produce wrong numbers | Seed `rules` section; Track A required_patterns |
| **Primary analytics view** | The one view agents will query most often | First `views` entry; grounds the initial eval cases |
| **3-5 dangerous field pairs** | Fields commonly confused or misused (e.g., dedup flags) | `fields` + `dangerous_columns` entries |
| **Business vocabulary** | Abbreviations, acronyms, overloaded terms | `terms` section |

### Optional (adds depth but not required for initial deployment)

| Input | Description | How it's used |
|---|---|---|
| **dbt artifacts** | `manifest.json`, `semantic_manifest.json` | Future: dbt_meta/dbt_description in merger priority chain |
| **True-north metrics** | Business-approved historical numbers with period + owner | `true-north.yaml` fixtures; promotion gate |
| **Golden-result fixtures** | Recent query results for regression testing | `golden-results.yaml`; development regression |
| **Known-good SQL** | Dashboard queries, analyst scripts, report SQL | Track A reference_sql; Track C workflow cases |
| **Dashboard inventory** | Which dashboards exist and what views they use | `views[].consumers` entries |

### Degraded Adoption Paths

Teams will not always have all recommended inputs. The system must handle:

| Scenario | What works | What's limited | Minimum viable action |
|---|---|---|---|
| **Credentials + datasets only** | `list_views`, `health_check`, `describe_view` (bare schema) | All annotations `confidence: low` | Run health_check, review unannotated list, manually add top 5 field meanings |
| **No source docs** | Bootstrap skipped; manual config authoring | No auto-generated draft config | Use template + health_check output to identify fields worth annotating |
| **No true-north fixtures** | All evals except true-north comparison | Promotion capped at L1 (no numeric verification) | Add true-north when business-approved numbers become available |
| **No known-good SQL** | Track B knowledge assertions pass | Track A SQL correctness tests empty | Write Track A cases incrementally as analysts provide reference queries |
| **Single analyst (no business approver)** | Analyst serves as both author and reviewer | True-north fixtures carry `owner: analyst` not `owner: RevOps` | Document the reduced trust level; promote to L1 only |

---

## 3. Generic Hardening Workflow

The workflow has 8 stages that execute in order. Some stages loop (marked with arrows).

```
┌─────────────────────────────────────────────────────────┐
│ Stage 1: Prerequisites Check                            │
│   - Credentials valid? Dataset accessible?              │
│   - SELECT 1 succeeds? INFORMATION_SCHEMA readable?     │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Stage 2: Bootstrap                                      │
│   - Ingest docs (if available)                          │
│   - Scaffold schema-config.yaml                         │
│   - Generate onboarding checklist                       │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Stage 3: Human Review (GATE)                            │
│   - Review draft config against source docs             │
│   - Add/correct rules, terms, metrics                   │
│   - Classify rules as typed primitives                  │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Stage 4: Knowledge Retrieval Eval (Track B)             │
│   - Run offline knowledge assertions                    │
│   - Classify failures: config_gap vs surfacing_failure  │
│   - Patch config_gap failures (human reviews patches)   │
│   ◄─── Loop until Track B passes ──────────────────────►│
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Stage 5: SQL Correctness Eval (Track A) + Neg Controls  │
│   - Run offline pattern matching on reference SQL       │
│   - Run negative controls                               │
│   - Classify failures                                   │
│   - Patch config_gap failures (human reviews patches)   │
│   ◄─── Loop until Track A + neg controls pass ─────────►│
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Stage 6: Online Validation                              │
│   - Live tool-call eval (response shape + surfacing)    │
│   - True-north fixture comparison against live BQ       │
│   - Golden fixture regression                           │
│   ◄─── Loop until online checks pass ──────────────────►│
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Stage 7: Workflow Eval (Track C) — optional             │
│   - End-to-end workflow replacement tests               │
│   - Requires online mode                                │
└─────────────────────┬───────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────┐
│ Stage 8: Promotion (GATE)                               │
│   - Generate promotion report                           │
│   - Human sign-off                                      │
│   - Advance to target promotion level                   │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Phase-by-Phase Implementation Plan

### Phase 0: Templates + Documentation Foundation

**Goal:** Create the reusable artifacts that all subsequent phases depend on. Docs and templates come first because they define the contracts that tooling targets.

**Scope boundary:** Phase 0 creates contracts, templates, examples, and documentation only. No source-code changes of any kind — no modifications to extractors, validators, CLI argument parsing, tool handlers, or any runtime code. If work during Phase 0 reveals something that requires a code change, log it as a requirement for the appropriate later phase and move on. Phase 0 is complete when all artifacts exist and all contracts are frozen, not when implementation questions are resolved.

**Artifacts to create:**

| File | Purpose |
|---|---|
| `templates/schema-config.template.yaml` | Blank config with all sections, inline comments, generic examples (e-commerce domain, not Savvy) |
| `templates/true-north.template.yaml` | Blank true-north fixture with structure + instructions |
| `templates/golden-results.template.yaml` | Blank golden fixture with structure + instructions |
| `templates/eval-cases/track-a.template.yaml` | Track A case template with all fields documented |
| `templates/eval-cases/track-b.template.yaml` | Track B case template with knowledge assertion examples |
| `templates/eval-cases/track-c.template.yaml` | Track C case template |
| `templates/eval-cases/negative-controls.template.yaml` | Negative control template |
| `templates/onboarding-checklist.md` | Blank onboarding checklist (intake → bootstrap → review → eval → promote) |
| `templates/bootstrap-coverage-checklist.md` | Blank coverage mapping (source doc section → config section → status) |
| `templates/promotion-checklist.md` | Promotion criteria by level (L0-L2) |
| `docs/template-contract-checklist.md` | Frozen contract: required fields, types, and shapes for every template YAML artifact |
| `docs/fixture-contract-checklist.md` | Frozen contract: required fields, types, and shapes for true-north and golden-results fixtures |
| `docs/bootstrap-doc-format.md` | Spec for markdown patterns the extractor understands |
| `docs/onboarding-guide.md` | Step-by-step guide for new teams (references templates, not Savvy) |
| `examples/savvy-wealth.yaml` | Production-scale example config (the existing Savvy config, documented as reference) |

**Contract freeze requirement:** `docs/template-contract-checklist.md` and `docs/fixture-contract-checklist.md` must be created and reviewed before any subsequent phase begins. These documents define the expected YAML shapes, required vs optional fields, field types, and validation rules for:

- `schema-config.template.yaml` — every top-level section, required keys, value types
- `true-north.template.yaml` — required fields (`id`, `period`, `type`, `expected`, `source`, `owner`, `last_verified`), value constraints
- `golden-results.template.yaml` — required fields (`id`, `period`, `type`, `expected`), value constraints
- Track A cases — required fields (`id`, `request`, `reference_sql`, `required_patterns`), pattern object shape
- Track B cases — required fields (`id`, `request`, `knowledge_assertions`), assertion object shape
- Track C cases — required fields (`id`, `request`), minimum assertion requirements
- Negative controls — required fields (`negative_controls` array), control object shape

These contracts are the authoritative reference for all code that generates, validates, or consumes templates and fixtures. If a later phase needs to change a contract, it must update the checklist first and document the reason.

**Claude Code prompt:**
```
Read config/schema-config.yaml, tests/fixtures/true-north.yaml, tests/fixtures/golden-results.yaml,
and all files in tests/cases/. Then read src/bootstrap/extract.ts to understand what markdown
patterns the extractor expects.

Create all template files listed in Phase 0 of docs/onboarding-loop-implementation-guide.md.
Templates must use a generic e-commerce domain (orders, customers, products) — not Savvy terminology.
Each template must have inline YAML comments explaining every field and when it's required vs optional.

Also create examples/savvy-wealth.yaml as a copy of config/schema-config.yaml with a header comment
explaining it's a production reference example.

Do not modify any existing source files.
```

**Validation:**
- All template files parse as valid YAML (where applicable)
- `docs/onboarding-guide.md` references all templates by correct relative path
- `docs/bootstrap-doc-format.md` documents all 3 extraction patterns from `extract.ts`
- `docs/template-contract-checklist.md` defines required/optional fields for every template
- `docs/fixture-contract-checklist.md` defines required/optional fields for every fixture type
- `examples/savvy-wealth.yaml` loads without error: `node -e "const y = require('yaml'); const fs = require('fs'); y.parse(fs.readFileSync('examples/savvy-wealth.yaml','utf8'))"`
- Contract checklists are reviewed and frozen before Phase 1 begins

**Stop condition:** All files created, all YAML parseable, contracts frozen, no source code modified.

---

### Phase 1: Config Contract Hardening

**Goal:** Strengthen the validator to catch common onboarding mistakes before they cause mysterious downstream failures. Add live cross-reference validation.

**Artifacts to create/modify:**

| File | Change |
|---|---|
| `src/config/validator.ts` | Add cross-reference checks: fields referencing nonexistent columns (via health_check data), duplicate field names, self-referential prefer_field rules, empty when_contains arrays |
| `src/tools/health-check.ts` | Add `--auth` / permissions check: `SELECT 1` test, INFORMATION_SCHEMA access test, per-dataset accessibility |
| `src/config/validator.ts` | Validate `connection.connector` against allowlist (`['bigquery']`) |
| `tests/cases/track-b/` | Add validation-focused knowledge assertions |

**Claude Code prompt:**
```
Read src/config/validator.ts, src/tools/health-check.ts, and src/types/config.ts.

1. In validator.ts, add these checks:
   - connection.connector must be in ['bigquery'] (prepare for future connectors)
   - prefer_field rules where found === prefer should warn
   - require_filter rules with empty when_contains should error
   - date_type_rule entries with neither wrong_wrapper nor correct_wrapper should warn

2. In health-check.ts, add a permissions pre-check:
   - Before any schema queries, run SELECT 1 against each dataset
   - If permissions fail, report as config_issues with type: 'permission_error'
   - Include the specific error message from BigQuery

3. Run npm run build && npm run lint. Fix any errors.
4. Run the eval suite to confirm no regressions.
```

**Validation:**
- `npm run build` clean
- `npm run lint` clean
- Eval suite: all existing cases still pass
- New validation catches: self-referential prefer_field, empty when_contains, unknown connector

**Stop condition:** Build + lint + eval clean. New checks provably catch the target errors.

---

### Phase 2: Bootstrap Hardening

**Goal:** Make the bootstrap command accept required CLI args, document expected doc formats, add extraction coverage reporting, and handle non-conforming docs gracefully.

**Artifacts to create/modify:**

| File | Change |
|---|---|
| `src/index.ts` | Add `--project`, `--dataset`, `--connector` args to bootstrap subcommand |
| `src/bootstrap/extract.ts` | Add extraction coverage report (views found, fields found, rules found, terms found, unrecognized sections) |
| `src/bootstrap/extract.ts` | Add terms extraction: `**Term**: definition` and two-column glossary table patterns |
| `src/bootstrap/extract.ts` | Emit warnings for sections that matched no pattern (helps teams fix their doc format) |
| `src/bootstrap/emit-config.ts` | Thread project/dataset/connector from CLI args |

**Claude Code prompt:**
```
Read src/index.ts (bootstrap section, lines 174-199), src/bootstrap/extract.ts, and
src/bootstrap/emit-config.ts.

1. In src/index.ts, add --project, --dataset (comma-separated), and --connector args to the
   bootstrap argument parser. Thread them to emitConfig. Default connector to 'bigquery'.

2. In extract.ts, add:
   - Terms extraction: match lines like "**Term**: definition" or "| Term | Definition |" tables
   - Coverage reporting: after extraction, log to stderr a summary of what was found
     (X views, Y fields, Z rules, W terms) and list any markdown sections that matched no pattern
   - Do NOT change the existing view/field/rule extraction patterns

3. In emit-config.ts, use the provided project/dataset/connector instead of hardcoded placeholders.

4. Run npm run build && npm run lint. Fix any errors.
```

**Validation:**
- `npm run build` clean
- `npm run lint` clean
- Bootstrap with `--project test --dataset ds1` produces config with correct connection section
- Bootstrap on Savvy docs produces same extraction results as before (no regression)
- Bootstrap on empty directory produces coverage report showing 0 extractions + helpful message
- Terms extraction works on a test doc with `**SQO**: Sales Qualified Opportunity`

**Stop condition:** CLI args work, coverage report emits, terms extract, no regressions.

---

### Phase 3: Eval Substrate Hardening

**Goal:** Strengthen the eval framework before building any automation on top of it. Add response-shape validation, fixture templates, and better failure reporting.

**Artifacts to create/modify:**

| File | Change |
|---|---|
| `src/eval/runner.ts` | Add `--report` flag that outputs structured JSON report (not just exit code) |
| `src/eval/runner.ts` | Add fixture structural validation: warn on missing required fields in true-north/golden |
| `src/eval/scorer.ts` | Add response-shape checks: verify tool responses match expected TypeScript interfaces |
| `src/eval/attribution.ts` | Refine attribution to distinguish sub-categories within config_gap (field_gap, rule_gap, term_gap, view_gap) |

**Claude Code prompt:**
```
Read src/eval/runner.ts, src/eval/scorer.ts, src/eval/attribution.ts, and src/types/responses.ts.

1. In runner.ts, add a --report flag. When set, write structured JSON to a file (path from --report value)
   instead of only to stderr. Include: suite summary, per-case outcomes, failure categories,
   gap descriptions, and timestamp.

2. In attribution.ts, refine the config_gap category into sub-categories:
   - field_gap: missing pattern maps to a field name
   - rule_gap: missing pattern maps to a rule ID or rule type
   - term_gap: missing pattern maps to a term key
   - view_gap: missing pattern maps to a view name
   Keep the parent category as config_gap for backwards compatibility; add sub_category field.

3. Run npm run build && npm run lint. Fix any errors.
4. Run the full eval suite. Confirm all cases still pass (attribution changes must not break existing outcomes).
```

**Validation:**
- `npm run build` clean
- `npm run lint` clean
- Eval suite: all cases pass
- `--report output.json` produces valid JSON file with expected structure
- Attribution sub-categories appear in report for any intentionally-failing test case

**Stop condition:** Build + lint + eval clean. Report output is valid JSON.

---

### Phase 4: Online Eval Mode

**Goal:** Extend the eval runner to call live MCP tools and compare responses against expectations. This is the foundation for the agentic refinement loop — it must exist before any automation.

**Artifacts to create/modify:**

| File | Change |
|---|---|
| `src/eval/runner.ts` | Add `--online` flag that enables live tool execution |
| `src/eval/online.ts` (new) | Online eval executor: calls MCP tools, captures responses, runs assertions |
| `src/eval/runner.ts` | True-north comparison: when `--online`, execute reference queries against BQ and compare against `expected` values |
| `src/eval/runner.ts` | Golden fixture regression: when `--online`, compare live query results against golden fixtures |

**Implementation notes:**
- Online mode imports the tool handlers directly (not via MCP protocol) to avoid stdio complexity
- True-north comparison uses the BigQuery connector to execute queries, then compares against fixture `expected` values with configurable tolerance (default: 0.01 for rates, exact for counts)
- Response shape validation: verify that `describe_view` returns all expected fields with correct provenance/confidence types
- Cost guard: log `totalBytesProcessed` for each query; fail if any single query exceeds a configurable limit (default: 1GB)

**Claude Code prompt:**
```
Read src/eval/runner.ts, src/connectors/bigquery.ts, src/tools/describe-view.ts, and
tests/fixtures/true-north.yaml.

1. Create src/eval/online.ts with:
   - A function that takes a tool name + args, calls the tool handler directly, and returns the response
   - A function that executes a SQL query via BigQueryConnector and returns rows
   - A function that compares query results against fixture expected values with tolerance

2. In runner.ts, add --online flag. When set:
   - Track B assertions: call the named tool and check that the expected value appears in the response
     (instead of checking against JSON.stringify(config))
   - True-north fixtures: execute the reference query, compare results against expected values
   - Golden fixtures: same pattern as true-north but different tolerance/handling
   - Log totalBytesProcessed for each query to stderr

3. Do NOT change offline mode behavior — --online is additive.

4. Run npm run build && npm run lint. Fix any errors.
```

**Validation:**
- `npm run build` clean
- `npm run lint` clean
- Offline eval still passes (no regression)
- Online eval against live BQ succeeds for at least one true-north fixture
- Cost logging appears in stderr output

**Online-eval fallback rules:** When online validation cannot run (credentials missing, warehouse unreachable, query cost guard exceeded, or permissions insufficient), the following applies:

- Offline eval continues to run normally — it does not depend on warehouse access
- Onboarding and hardening can proceed through the offline stages (Track A/B pattern matching, negative controls)
- The `--online` flag failures are reported as structured errors, not silent skips
- **Promotion cannot advance beyond L1** unless online validation passes or the team documents an explicit human waiver with justification (e.g., "warehouse access pending IT approval; offline evals pass; waiver approved by [name] on [date]")

**Stop condition:** Build + lint clean. Offline eval unchanged. Online mode executes at least one live validation.

---

### Phase 5: Deterministic Onboarding Scaffold

**Goal:** Build the composable CLI commands that guide a new team from credentials to working config. No "engine" — just commands + checklist.

**Artifacts to create/modify:**

| File | Change |
|---|---|
| `src/index.ts` | Add `onboard` subcommand that runs prerequisites → bootstrap → health_check → eval in sequence |
| `src/onboarding/prerequisites.ts` (new) | Credentials check, dataset accessibility, INFORMATION_SCHEMA readability |
| `src/onboarding/scaffold.ts` (new) | Copy templates, substitute project/dataset, generate starter eval pack |
| `src/onboarding/starter-evals.ts` (new) | Auto-generate Track B assertions from source docs (not from config — avoids circular validation) |

**Critical design constraints:**

1. **Only Track B starter assertions may be auto-generated from source docs.** The system generates knowledge retrieval assertions grounded in the source documentation (not the derived config). This prevents circular validation.

2. **Track A SQL correctness cases must NOT be auto-generated** unless the team provides at least one of:
   - Known-good SQL (dashboard queries, analyst scripts, report SQL)
   - Explicit rule examples with SQL snippets from source material
   - Query examples from documentation that include concrete WHERE clauses or JOIN patterns

   Without human-provided SQL, Track A cases are empty. This is acceptable — empty Track A is honest. Fake Track A coverage is dangerous.

3. **Track C and negative control cases are never auto-generated.** They require domain understanding that cannot be derived from docs alone.

**Track B auto-generation rules:**
- For each view extracted from docs: assert that `describe_view` returns the view's purpose
- For each field extracted from docs: assert that the field meaning appears in tool responses
- For each rule extracted from docs: assert that the rule description appears in `get_rule` response
- These are "source-doc-grounded" assertions, not "config-grounded" — they catch config gaps

**Claude Code prompt:**
```
Read src/index.ts, src/bootstrap/extract.ts, and templates/eval-cases/track-b.template.yaml.

1. Create src/onboarding/prerequisites.ts:
   - Check that SCHEMA_CONFIG or default config path exists
   - Load config, create connector
   - Run SELECT 1 against each dataset
   - Run INFORMATION_SCHEMA query against each dataset
   - Report results to stderr

2. Create src/onboarding/scaffold.ts:
   - Copy template files from templates/ to a target directory (default: current working directory)
   - Substitute project/dataset in schema-config.template.yaml
   - Run bootstrap if --docs path provided

3. Create src/onboarding/starter-evals.ts:
   - Take ExtractedKnowledge (from bootstrap) as input
   - For each extracted view: generate a Track B assertion checking purpose
   - For each extracted field: generate a Track B assertion checking meaning
   - Write to a starter eval file
   - These assertions are grounded in the SOURCE DOCS, not the config

4. In src/index.ts, add 'onboard' subcommand that chains: prerequisites → scaffold → bootstrap → starter-evals

5. Run npm run build && npm run lint.
```

**Validation:**
- `npm run build` clean
- `npm run lint` clean
- `onboard --project test --dataset ds1` on an empty directory produces: config file, template copies, starter eval cases
- `onboard --project test --dataset ds1 --docs ./my-docs/` also runs bootstrap and generates doc-grounded assertions
- Prerequisites check reports clear pass/fail for each dataset

**Stop condition:** Build + lint clean. Onboard command produces valid config + eval files.

---

### Phase 6: Agentic Refinement Loop

**Goal:** Build the "run eval → classify failures → propose fixes → human review → re-run" loop. This is the core hardening automation. It runs AFTER online eval exists (Phase 4).

**Artifacts to create/modify:**

| File | Change |
|---|---|
| `src/refinement/loop.ts` (new) | Orchestration: run eval, parse results, classify, propose, gate, re-run |
| `src/refinement/proposer.ts` (new) | Generate config patch proposals from failure attribution |
| `src/refinement/gate.ts` (new) | Human approval gate: display proposals, wait for confirmation |

**Automation boundaries (strictly enforced):**

| Failure type | Sub-category | System may propose | Human must approve | System must NOT do |
|---|---|---|---|---|
| `config_gap` | `field_gap` | New field annotation with meaning from source docs | Yes, before applying | Auto-apply without review |
| `config_gap` | `view_gap` | New view entry with purpose from source docs | Yes, before applying | Auto-apply without review |
| `config_gap` | `rule_gap` | Draft rule as free text | Yes — human must choose typed primitive | Auto-generate typed rule |
| `config_gap` | `term_gap` | New term entry from source docs | Yes, before applying | Auto-apply without review |
| `surfacing_failure` | — | Flag for investigation with context | N/A — requires code-level diagnosis | Modify tool implementations |
| `evaluator_strict` | — | Flag for human review | Human must manually relax test | Propose test relaxation |
| `agent_reasoning` | — | Log and skip | N/A | Modify config or tests |

**Explicit prohibitions — the refinement loop must NEVER:**

1. **Silently classify draft rules into typed primitives.** Rule proposals are always free-text drafts. The human chooses the type (`ban_pattern`, `prefer_field`, `require_filter`, `date_type_rule`), severity, and all type-specific fields. The system may suggest a type, but the suggestion is a comment in the proposal, not an applied classification.

2. **Author metric definitions.** Metrics require domain expertise (numerator/denominator logic, cohort vs period modes, anchor dates). The system never proposes metric entries, even as drafts.

3. **Rewrite, relax, or modify test assertions to achieve a passing state.** If a test fails, the system may only propose config changes. It may never propose changing the test itself. Test relaxation is exclusively a human action.

4. **Change promotion criteria or level thresholds.** Promotion levels (L0-L3) and their criteria are fixed by this guide. The refinement loop operates within these criteria; it does not adjust them.

5. **Auto-approve dangerous_column entries.** Even with `--auto-approve`, dangerous_column additions require explicit human confirmation because they are safety-critical annotations.

6. **Modify existing config entries.** The refinement loop may only propose additions (new fields, new views, new terms). Modifying or deleting existing entries requires human action outside the loop.

**Business-readable patch summaries:** Every proposal must include a short plain-English summary alongside the technical config patch. This summary is for non-technical business reviewers and must explain:

- **What's missing:** What knowledge the config lacks (e.g., "The config does not define what `is_sqo_unique` means")
- **What could go wrong:** What practical error an agent might make without this knowledge (e.g., "An agent could double-count SQOs by using `is_sqo` instead of the dedup flag")
- **Why this addition helps:** How the proposed patch prevents the error (e.g., "Adding the field meaning and a `prefer_field` rule ensures agents use the correct dedup column")

This requirement is lightweight: 2-3 sentences per proposal. It ensures that domain experts who review proposals can make informed approval decisions without reading YAML diffs.

**Loop termination criteria:**
- All Track B assertions pass
- All Track A required patterns present, all banned patterns absent
- All negative controls pass
- No `config_gap` failures remaining (all are either resolved or deferred with justification)
- Maximum iteration count not exceeded (default: 10)

**Claude Code prompt:**
```
Read src/eval/runner.ts, src/eval/attribution.ts, and the Phase 6 spec in
docs/onboarding-loop-implementation-guide.md.

1. Create src/refinement/loop.ts:
   - Accept config path, cases path, and max iterations
   - Each iteration: run eval (offline first, then online if --online), parse JSON report,
     collect failures by category
   - For each config_gap: call proposer to generate a config patch
   - Display all proposals to stderr, wait for human confirmation (y/n per proposal)
   - Apply approved patches to config YAML
   - Re-run eval
   - Stop when: all pass, or max iterations, or no new proposals

2. Create src/refinement/proposer.ts:
   - For field_gap: look up the field in source docs (if available) and propose a meaning
   - For view_gap: look up the view in source docs and propose purpose + grain
   - For rule_gap: output a draft description, mark as "requires human classification into typed primitive"
   - For term_gap: look up in source docs, propose definition
   - Every proposal includes provenance (which source doc, which extraction) and confidence

3. Create src/refinement/gate.ts:
   - Format proposals as readable text for stderr
   - Support --auto-approve for field/view/term proposals only (never rules/metrics)
   - Log all approval decisions to a refinement-log.yaml

4. In src/index.ts, add 'refine' subcommand.

5. Run npm run build && npm run lint.
```

**Validation:**
- `npm run build` clean
- `npm run lint` clean
- `refine` on a config with known field_gap produces a proposal
- Approving the proposal and re-running shows the gap resolved
- Rules are never auto-proposed as typed primitives
- `--auto-approve` does not auto-approve rule proposals
- Refinement log captures all decisions

**Stop condition:** Build + lint clean. Loop demonstrates propose → approve → re-run → pass.

---

### Phase 7: Promotion Workflow

**Goal:** Formalize the readiness criteria and build the promotion report generator.

**Promotion levels:**

| Level | Name | Criteria |
|---|---|---|
| **L0** | Not Ready | Eval failures, health_check issues, or no eval cases at all |
| **L1** | Ready with Conditions | All offline evals pass, health_check clean, but no true-north verification or limited config coverage (< 50% of fields annotated) |
| **L2** | Ready for Internal Deployment | All offline + online evals pass, health_check clean, true-north verified (if fixtures exist), human sign-off documented, ≥ 70% field annotation coverage, at least one real net-new task completed successfully |
| **L3** | Ready for Production Agents | L2 + Track C workflow evals pass, golden fixtures stable across 2+ runs, config versioned in git, promotion report signed |

**Artifacts to create/modify:**

| File | Change |
|---|---|
| `src/promotion/report.ts` (new) | Generate promotion report: eval results, health_check output, coverage stats, fixture status, human approvals |
| `src/promotion/criteria.ts` (new) | Evaluate current state against promotion level criteria |
| `src/index.ts` | Add `promote` subcommand |

**Claude Code prompt:**
```
Read src/eval/runner.ts, src/tools/health-check.ts, and the Phase 7 spec in
docs/onboarding-loop-implementation-guide.md.

1. Create src/promotion/criteria.ts:
   - Accept eval suite results, health_check output, config, and fixture paths
   - Compute: field annotation coverage %, rule count, eval pass rates, fixture status
   - Return the highest promotion level met, with justification for each criterion

2. Create src/promotion/report.ts:
   - Generate a markdown report with: promotion level, eval summary, health_check summary,
     coverage stats, fixture verification status, outstanding gaps, human approval status
   - Write to a file (default: promotion-report.md)

3. In src/index.ts, add 'promote' subcommand that runs: eval suite → health_check → criteria → report.

4. Run npm run build && npm run lint.
```

**Validation:**
- `npm run build` clean
- `npm run lint` clean
- `promote` on the existing Savvy config produces a report showing L2
- `promote` on a minimal config (connection only) produces a report showing L0
- Report includes all sections: level, evals, health, coverage, fixtures, gaps

**Stop condition:** Build + lint clean. Reports generate correctly for both full and minimal configs.

---

### Phase 8: Integration Testing + Final Documentation

**Goal:** End-to-end test the full onboarding → refine → promote flow. Update all documentation.

**Artifacts to create/modify:**

| File | Change |
|---|---|
| `docs/onboarding-guide.md` | Update with final CLI commands and flow |
| `README.md` | Add onboarding section, fix broken references (examples/savvy-wealth.yaml, tests/examples/) |
| `ARCHITECTURE.md` | Add onboarding system architecture section |
| `docs/onboarding-loop-implementation-guide.md` | Mark phases complete in status table |

**Claude Code prompt:**
```
1. Run the full onboarding flow end-to-end using a fresh directory with the generic templates:
   - onboard --project test-project --dataset test_dataset
   - Verify config, eval cases, and checklists are generated
   - refine --config ./schema-config.yaml --cases ./tests/cases/
   - promote --config ./schema-config.yaml --cases ./tests/cases/

2. Update docs/onboarding-guide.md with the exact CLI commands and expected output.

3. Update README.md:
   - Add "Onboarding a New Team" section
   - Fix examples/savvy-wealth.yaml reference
   - Fix tests/examples/ reference
   - Add CLI subcommand documentation (bootstrap, onboard, refine, promote)

4. Update ARCHITECTURE.md with onboarding system section.

5. Run npm run build && npm run lint.
```

**Validation:**
- Full end-to-end flow completes without errors
- All documentation references resolve to existing files
- `npm run build` clean
- `npm run lint` clean
- Eval suite: all existing cases still pass

**Stop condition:** Full flow works end-to-end. All docs updated. Build + lint + eval clean.

---

## 5. Templates and Fixture Design

### schema-config.template.yaml

```yaml
# Schema Context MCP — Configuration Template
# Replace all <PLACEHOLDER> values with your environment details.
# See docs/onboarding-guide.md for field-by-field instructions.

connection:
  connector: bigquery          # Only 'bigquery' supported in v1
  project: <YOUR_GCP_PROJECT>
  datasets:
    - <YOUR_PRIMARY_DATASET>   # At least one required
  # key_file: ./path/to/service-account.json  # Optional; omit for ADC

# Views — annotate your most important analytics views
# Start with your primary reporting view; add others incrementally
views:
  # <your_primary_view>:
  #   purpose: "One sentence describing what this view is for"
  #   grain: "One row per <entity>"
  #   key_filters:
  #     <filter_name>:
  #       sql: "<SQL WHERE clause>"
  #   dangerous_columns:
  #     - column: <column_name>
  #       reason: "Why this column is dangerous"
  #       use_instead: <safe_column_name>
  #   consumers:
  #     - "Dashboard or team that uses this view"

# Fields — annotate fields that are confusing, dangerous, or commonly misused
# Focus on dedup flags, type-confused dates, and overloaded names
fields:
  # <field_name>:
  #   meaning: "What this field represents"
  #   gotcha: "Common mistake when using this field"  # Optional
  #   use_instead_of: "<other_field>"                 # Optional

# Rules — typed primitives that lint_query checks
# Types: ban_pattern, prefer_field, require_filter, date_type_rule
rules: []
  # - id: <unique_rule_id>
  #   type: ban_pattern
  #   severity: error          # error | warning | info
  #   message: "Why this pattern is banned"
  #   pattern: "<banned SQL substring>"

# Terms — business vocabulary definitions
terms: {}
  # <TERM>:
  #   definition: "What this term means"
  #   related_fields:
  #     - <field_name>
  #   related_rules:
  #     - <rule_id>
  #   gotcha: "Common confusion about this term"  # Optional

# Metrics — conversion rate or volume calculations
# Only add when you have well-defined, stable metric definitions
metrics: {}
  # <metric_name>:
  #   description: "What this metric measures"
  #   modes:
  #     period:
  #       numerator: "<field>"
  #       denominator: "<field>"
  #       anchor_date: "<date_field>"
```

### true-north.template.yaml

```yaml
# True-North Fixtures — Business-approved historical values
# These serve as the promotion gate. Failures block promotion to L2+.
# Only add values that have been verified by a business owner.

true_north:
  # - id: <team>_<period>_<metric_type>
  #   period: "Q1 2025"              # Human-readable period
  #   type: <fixture_type>           # Your metric category name
  #   expected:
  #     <metric_key>: <number>       # Business-approved value
  #   source: business_approved      # Always 'business_approved' for true-north
  #   owner: <team_or_person>        # Who approved this number
  #   last_verified: "2025-04-07"    # Date of last human verification
```

### golden-results.template.yaml

```yaml
# Golden Results — Development regression baselines
# These are NOT business-approved — they're recent query results used for regression detection.
# Update these when the warehouse legitimately changes.

golden:
  # - id: <descriptive_id>
  #   period: "Q1 2026"
  #   type: <fixture_type>
  #   expected:
  #     <metric_key>: <number>       # Queried YYYY-MM-DD from <source_view>
```

### Track A Template

```yaml
# Track A — SQL Correctness
# Tests that reference SQL contains correct patterns and avoids banned patterns.
# Requires human-authored reference_sql.

id: <team>-a1-<short-description>
request: "<natural language question an agent would receive>"
difficulty: basic          # basic | intermediate | advanced
category: <your_category>  # e.g., volume_query, conversion_rate, aggregation

required_patterns:
  - pattern: "<substring that MUST appear in correct SQL>"
    rule: <rule_id_from_config>
    reason: "Why this pattern is required"

banned_patterns:
  - pattern: "<substring that must NOT appear>"
    without: "<exception — pattern is OK if this is also present>"  # Optional
    rule: <rule_id_from_config>
    reason: "Why this pattern is dangerous"

reference_sql: |
  SELECT ...
  FROM `project.dataset.view`
  WHERE ...

# expected_tool_calls:        # Optional metadata for reviewers
#   - tool: describe_view
#     args: { view: "<view_name>", intent: "<intent>" }
```

### Track B Template

```yaml
# Track B — Knowledge Retrieval
# Tests that the config contains expected knowledge.
# In offline mode: checks against JSON.stringify(config)
# In online mode: calls the named tool and checks the response

- id: <team>-b1-<short-description>
  request: "<business question>"
  difficulty: basic
  category: knowledge_retrieval
  knowledge_assertions:
    - question: "<specific question>"
      expected: "<substring that must appear in tool response>"
      tool: describe_view    # Which tool should answer this
```

---

## 6. Failure Attribution and Patch Boundaries

### Attribution Categories

| Category | Sub-category | Meaning | Example |
|---|---|---|---|
| `config_gap` | `field_gap` | Field referenced in test but not annotated in config | Test expects `is_sqo_unique` meaning; config has no `fields.is_sqo_unique` |
| `config_gap` | `rule_gap` | Rule referenced in test but not in config | Test expects `sqo_volume_dedup` rule; `rules` array has no such ID |
| `config_gap` | `term_gap` | Term referenced in test but not defined | Test expects `SQO` definition; `terms` has no `SQO` key |
| `config_gap` | `view_gap` | View referenced in test but not configured | Test expects `vw_funnel_master` purpose; `views` has no entry |
| `surfacing_failure` | — | Knowledge is in config but not reaching the tool response | Config has the rule, but intent routing doesn't match it to the query |
| `evaluator_strict` | — | Test assertion is too strict for what the system can reasonably produce | Pattern match too specific; needs `without` clause |
| `agent_reasoning` | — | Test failure is an agent behavior issue, not a config issue | Agent chose wrong view despite correct annotations |

### Patch Safety Matrix

| Action | Auto-proposable? | Auto-approvable? | Human required? |
|---|---|---|---|
| Add field meaning from source docs | Yes | With `--auto-approve` | Recommended |
| Add view purpose from source docs | Yes | With `--auto-approve` | Recommended |
| Add term definition from source docs | Yes | With `--auto-approve` | Recommended |
| Add dangerous_column entry | Yes | No | Yes — safety-critical |
| Create typed rule (ban_pattern, etc.) | Draft only | Never | Always — must choose type + severity |
| Create metric definition | Never | Never | Always — requires domain expertise |
| Modify existing rule | Never | Never | Always — semantic change |
| Relax test assertion | Never | Never | Always — test integrity |
| Modify tool implementation | Never | Never | Always — code change |

---

## 7. Promotion Model

### Level Definitions

#### L0: Not Ready

Any of:
- Eval suite has failures
- `health_check` reports connection errors
- No eval cases exist
- Config fails validation

**Action:** Continue in refinement loop.

#### L1: Ready with Conditions

All of:
- All offline evals pass (Track A + B + negative controls)
- `health_check` clean (no connection errors; stale/unannotated counts documented)
- Config validates without errors

Plus any of:
- Field annotation coverage < 50%
- No true-north fixtures
- No Track A cases (only Track B)
- Single-person review (no business approver)
- Online validation not yet passing (credentials missing, warehouse unreachable, or cost guard exceeded)

**Action:** Deploy for internal experimentation. Document conditions. Continue hardening.

#### L2: Ready for Internal Deployment

All of:
- All offline evals pass
- Online evals pass (if implemented)
- `health_check` clean
- True-north fixtures verified against live warehouse (or explicitly waived with justification)
- Field annotation coverage ≥ 70%
- Human sign-off documented
- Config versioned in git
- At least one real net-new task completed successfully using the MCP as the primary context source (see below)

**Real-task requirement:** Before L2 promotion, the team must complete at least one genuine analytical task — not a canned eval case — where an agent uses the MCP tools as its primary context source. This task must be:
- A real business question or workflow (not synthetic)
- Outside the existing eval suite (not a duplicate of any Track A/B/C case)
- Reviewed by a human who confirms the agent produced a correct or acceptable result
- Documented in the promotion report (task description, agent output summary, reviewer name, outcome)

This requirement exists because eval suites test known patterns; real tasks test whether the config actually helps agents in practice.

**Action:** Deploy for production agent use within the team.

#### L3: Ready for Production Agents (CI/CD Integrated)

All of L2 plus:
- Track C workflow evals pass
- Golden fixtures stable across 2+ consecutive runs
- Promotion report generated and signed
- Config change process documented (who can modify, review required)
- Monitoring/alerting plan for schema drift (periodic health_check)

**Action:** Integrate into CI/CD. Run health_check on schedule. Alert on drift.

---

## 8. File/Artifact Map

### New files this implementation adds

```
templates/
├── schema-config.template.yaml
├── true-north.template.yaml
├── golden-results.template.yaml
├── onboarding-checklist.md
├── bootstrap-coverage-checklist.md
├── promotion-checklist.md
└── eval-cases/
    ├── track-a.template.yaml
    ├── track-b.template.yaml
    ├── track-c.template.yaml
    └── negative-controls.template.yaml

examples/
└── savvy-wealth.yaml                    # Production reference example

docs/
├── onboarding-guide.md                  # Step-by-step for new teams
├── bootstrap-doc-format.md              # What markdown patterns the extractor understands
├── template-contract-checklist.md       # Frozen contract for template YAML shapes
├── fixture-contract-checklist.md        # Frozen contract for fixture YAML shapes
└── onboarding-loop-implementation-guide.md  # This file

src/
├── onboarding/
│   ├── prerequisites.ts                 # Credentials + permissions check
│   ├── scaffold.ts                      # Template copy + substitution
│   └── starter-evals.ts                 # Doc-grounded Track B generation
├── refinement/
│   ├── loop.ts                          # Run eval → classify → propose → gate → re-run
│   ├── proposer.ts                      # Generate config patch proposals
│   └── gate.ts                          # Human approval gate
├── promotion/
│   ├── criteria.ts                      # Evaluate promotion level criteria
│   └── report.ts                        # Generate promotion report
└── eval/
    └── online.ts                        # Live tool-call + BQ query evaluation

Modified files:
├── src/index.ts                         # New subcommands: onboard, refine, promote
├── src/config/validator.ts              # Cross-reference checks
├── src/tools/health-check.ts            # Permissions pre-check
├── src/bootstrap/extract.ts             # Terms extraction, coverage reporting
├── src/bootstrap/emit-config.ts         # CLI arg threading
├── src/eval/runner.ts                   # --online flag, --report flag
├── src/eval/attribution.ts              # Sub-category refinement
├── README.md                            # Onboarding section, fixed references
├── ARCHITECTURE.md                      # Onboarding system section
└── docs/onboarding-guide.md             # Final CLI commands
```

---

## 9. Final Readiness Checklist

Before this guide is considered ready to implement:

- [ ] All exploration findings reviewed (code-inspector, data-verifier, pattern-finder)
- [ ] Council review incorporated (Codex + Gemini feedback addressed)
- [ ] Phase ordering validated (no dependency violations)
- [ ] Automation boundaries approved by project owner
- [ ] Degraded adoption paths cover realistic scenarios
- [ ] Template designs reviewed (generic domain, no Savvy leakage)
- [ ] Promotion criteria agreed upon by stakeholders
- [ ] Existing eval suite confirmed passing (no regressions from guide creation)
- [ ] Phase 0 identified as first implementation phase

**Production-quality verification (required before npm publication):**

After all phases are implemented, the following must be verified before the onboarding loop is considered production-ready or suitable for npm publication:

- [ ] End-to-end onboarding works in a clean, fresh directory with no pre-existing config or eval files
- [ ] Templates generate valid starter artifacts that pass YAML parsing and contract validation
- [ ] Refine loop proposals can be reviewed, approved, and applied without corrupting existing config
- [ ] Promotion reporting produces correct results on both minimal configs (connection only → L0) and fully populated configs (full annotations → L2+)
- [ ] The loop remains functional after the repo is cleaned and generalized for npm publication (no Savvy-specific paths, credentials, or hardcoded references remain in the onboarding/refinement/promotion code)

---

## Major Risks and Gaps

### Risk 1: Circular Validation

**Risk:** Auto-generating Track B assertions from config creates tests that validate the config against itself.
**Mitigation:** Phase 5 explicitly generates assertions from source documents, not from the derived config. The system MUST maintain this separation. Assertions check "does the tool return what the source doc says?" not "does the tool return what the config says?"

### Risk 2: Weak Evaluator Driving False Confidence

**Risk:** The offline eval uses substring matching on reference SQL and `JSON.stringify(config)`. This can produce false positives (pattern found in wrong context) and false negatives (correct knowledge present but serialized differently).
**Mitigation:** Phase 4 adds online eval mode with live tool calls. The offline eval becomes a fast pre-check; online eval is the authoritative gate for promotion.

### Risk 3: External Teams Won't Resemble Savvy

**Risk:** Savvy had clean docs, clear business ownership, well-defined metrics, and BigQuery expertise. Other teams may have poor docs, no business approver, ambiguous metrics, and limited SQL skills.
**Mitigation:** Degraded adoption paths (Section 2) and the L0→L1→L2→L3 promotion model allow teams to start with minimal investment and harden incrementally. The system never blocks on missing optional inputs.

### Risk 4: Scope Creep in Refinement Loop

**Risk:** The agentic refinement loop (Phase 6) could become an "engine" that tries to do too much autonomously.
**Mitigation:** Strict automation boundaries (Section 6). Rules and metrics are never auto-generated. The system proposes; humans approve. The loop has a maximum iteration count and explicit termination criteria.

### Risk 5: Bootstrap Extractor Format Assumptions

**Risk:** The markdown extractor handles 3-4 specific patterns. Teams with Confluence, Notion, Google Docs, or non-standard markdown will get empty extraction results.
**Mitigation:** Phase 2 adds extraction coverage reporting and warnings for unrecognized sections. `docs/bootstrap-doc-format.md` tells teams what format to convert their docs to. The degraded "no docs" path allows manual config authoring.

---

## What Phase to Build First

**Phase 0: Templates + Documentation Foundation.**

Rationale:
1. Zero code changes — pure artifact creation. Lowest risk, highest leverage.
2. Every subsequent phase references these templates. They're a hard dependency.
3. Forces the team to define the generic domain (not Savvy) upfront, which validates that the system is truly generic.
4. The onboarding guide becomes the user-facing contract that all tooling must satisfy.
5. Can be reviewed and iterated on before any code is written.
