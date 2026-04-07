# Onboarding Checklist

> Use this checklist to track progress from initial setup through promotion.
> Copy this file into your project directory and check off items as you go.

## Stage 1: Prerequisites

- [ ] GCP project ID identified: `__________________`
- [ ] Dataset name(s) identified: `__________________`
- [ ] Service account key or ADC configured
- [ ] `SELECT 1` succeeds against each dataset
- [ ] `INFORMATION_SCHEMA.COLUMN_FIELD_PATHS` readable for each dataset

## Stage 2: Bootstrap

- [ ] Source documentation gathered (if available)
  - [ ] Docs converted to supported markdown format (see `docs/bootstrap-doc-format.md`)
- [ ] Bootstrap command run: `npx schema-context-mcp bootstrap --project <PROJECT> --dataset <DATASET>`
- [ ] Draft `schema-config.yaml` generated
- [ ] Onboarding checklist populated (this file)
- [ ] Bootstrap coverage report reviewed — unrecognized sections noted

## Stage 3: Human Review (GATE)

- [ ] Draft config reviewed against source documentation
- [ ] Views: purpose and grain verified for each view
- [ ] Fields: meanings verified for annotated fields
- [ ] Dangerous columns: all safety-critical columns identified
- [ ] Rules: draft rules classified into typed primitives (`ban_pattern`, `prefer_field`, `require_filter`, `date_type_rule`)
- [ ] Terms: business vocabulary reviewed
- [ ] Metrics: defined by domain expert (not auto-generated)
- [ ] Reviewer name: `__________________`
- [ ] Review date: `__________________`

## Stage 4: Knowledge Retrieval Eval (Track B)

- [ ] Track B eval cases created (auto-generated from source docs or manually authored)
- [ ] Offline eval run: `npx schema-context-mcp eval --cases ./tests/cases/ --config ./schema-config.yaml`
- [ ] All Track B assertions pass
- [ ] Any `config_gap` failures patched and re-verified

## Stage 5: SQL Correctness Eval (Track A) + Negative Controls

- [ ] Track A eval cases authored (requires human-provided reference SQL)
- [ ] Negative control cases authored
- [ ] Offline eval run
- [ ] All Track A required patterns present
- [ ] All banned patterns absent
- [ ] All negative controls pass
- [ ] Any `config_gap` failures patched and re-verified

## Stage 6: Online Validation

- [ ] Online eval enabled: `--online` flag
- [ ] Live tool-call assertions pass
- [ ] True-north fixtures compared against live warehouse
- [ ] Golden fixture regression check passes
- [ ] Cost guard verified (no query exceeds limit)

## Stage 7: Workflow Eval (Track C) — Optional

- [ ] Track C workflow cases authored
- [ ] Online workflow eval run
- [ ] Results reviewed by domain expert

## Stage 8: Promotion (GATE)

- [ ] Promotion report generated: `npx schema-context-mcp promote --config ./schema-config.yaml`
- [ ] Current promotion level: `__________________`
- [ ] Human sign-off documented
- [ ] Reviewer name: `__________________`
- [ ] Sign-off date: `__________________`
- [ ] Config committed to version control
