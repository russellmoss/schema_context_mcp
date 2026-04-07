---
name: refactor-guide
description: "Build a detailed, non-breaking refactor guide from exploration findings. Optimized for safe decomposition, extraction, import/export safety, and behavior preservation in this MCP server codebase."
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Refactor Guide Skill

You are writing a refactor execution guide for schema-context-mcp where safety matters more than aggressiveness.

The guide is not a brainstorm. It is an execution document for a future implementation pass.

## Goal

Convert exploration findings into a **small-step, reversible, non-breaking** refactor plan.

The plan must:
- preserve behavior exactly — zero intentional behavior changes
- preserve tool response shapes
- preserve config YAML schema compatibility
- minimize simultaneous changes
- surface risks before code is touched
- include concrete verification after every phase

## Inputs

Read all exploration artifacts provided by the orchestrator. At minimum, expect:
- `refactor-triage.md` — triage results and lane classification
- `code-inspector-findings.md` — types, tool chains, file dependencies
- `pattern-finder-findings.md` — established codebase patterns
- `dependency-mapper-findings.md` — imports, exports, consumers, blast radius
- `refactor-exploration-results.md` — synthesized exploration results

Also read:
- `.claude/mcp-tool-spec.md` — tool response shape contract
- `.claude/config-schema.md` — config YAML schema
- `.claude/eval-spec.md` — eval framework specification

## Blocked by Default

These areas are blocked within refactor scope. They may only proceed with explicit user approval.

- **Tool response shapes** — changing structure breaks all consuming agents
- **MCP tool names** — changing names breaks all agent configurations
- **Config YAML schema** — changing format breaks existing configs
- **Provenance/confidence contract** — agents depend on these fields
- **Eval test case format** — changing format requires updating runner, evaluator, and all cases
- **Resolution priority logic** in merger.ts (native > dbt > warehouse)
- **Connector interface** — changes affect all future connector implementations
- No "while we're here" cleanup that expands risk

## Validation Discipline

- **`npm run build`** after every code change. This is the primary safety net.
- **`npm run lint`** at phase boundaries.
- **Eval suite** at phase boundaries: `npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml`
- If the change touches merger.ts, run ALL eval test cases (merger affects all tools).

## Preferred Refactor Style

Prefer this order of operations:
1. Extract pure/internal pieces before shared/public pieces
2. Move types/constants/helpers before moving behavior-heavy logic
3. Update imports in the smallest coherent slice
4. Run `npm run build` after every slice — do not continue if it fails

## Assessment vs. Extraction

Not every flagged file needs refactoring. A valid guide output is: "assessed, no safe extraction available — leave as-is."

**Assessment-first posture**: Read the file, understand its responsibilities, identify what is and isn't safely extractable, and report. Extract only when:
- A clean, self-contained block can be moved without changing behavior
- The consumer surface is fully identified and small
- `npm run build` will pass
- The file is not in a blocked-by-default area

### Leverage/Risk Tags

For each proposed extraction:
- **Agentic leverage**: `high` / `medium` / `low` — does this make future agentic work easier?
- **Risk**: `high` / `medium` / `low` — does this touch blocked areas or have many consumers?
- **Recommendation**: `apply` / `assess-only` / `skip`
- One sentence explaining why.

## Required Guide Structure

### 1. Refactor Summary
- target, lane classification, one-paragraph summary

### 2. Scope and Non-Goals
- exact scope
- explicitly excluded areas (tool response shapes, config schema, etc.)

### 3. Pre-Flight Checklist
- `npm run build` — baseline
- `npm run lint` — baseline
- Eval suite — baseline pass count
- Targeted Grep for current import paths

### 4. Execution Phases
For each phase:
- leverage/risk tag
- objective
- exact files touched (full paths from `src/`)
- exact code movement or extraction
- import/export updates required
- what must remain semantically identical
- validation gate: `npm run build` + `npm run lint` + eval suite
- stop-and-report criteria

### 5. Post-Refactor Verification
- `npm run build`
- `npm run lint`
- Full eval suite — same or better pass count
- Targeted Grep for stale import paths
- Verify provenance/confidence still present in all tool responses
- Verify resolution priority still maintained in merger.ts

### 6. Rollback Notes
- `git revert` guidance
- what partial states are not acceptable

### 7. Open Decisions
- only decisions that truly require a human

## Repo-Specific Risk Areas

| Area | Why it's risky | What to preserve |
|---|---|---|
| `src/config/merger.ts` | All tools consume merged output | Resolution priority, provenance tagging |
| `src/config/types.ts` | Shared interfaces everywhere | All type definitions |
| `src/tools/*.ts` | Response shape contract with consuming agents | Response shapes, provenance, confidence |
| `src/connectors/bigquery.ts` | Only connector, parameterized query contract | Query parameterization, result mapping |
| `src/eval/` | Test infrastructure for all validation | Test case format, scoring model |
| `src/index.ts` | Tool registration, MCP server setup | Tool names, registration order |

## Quality Bar

The final guide should read like a careful senior engineer's rollout plan, not a brainstorming memo.
