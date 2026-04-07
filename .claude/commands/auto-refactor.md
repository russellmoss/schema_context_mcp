---
name: auto-refactor
description: Safe refactoring pipeline for schema-context-mcp. Dependency analysis → lane classification → council review → implementation.
---

# /auto-refactor — Refactoring Pipeline

You are refactoring code in schema-context-mcp, an MCP server that provides AI agents with annotated warehouse schema context.

**Refactor target:** $ARGUMENTS

---

## Step 1: Dependency Analysis

Spawn **dependency-mapper** to map the blast radius of this refactor:
- What imports the target?
- What does the target export?
- Who consumes those exports?
- What tests cover the target?

## Step 2: Lane Classification

Classify the refactor into a safety lane:

| Lane | Scope | Approval |
|------|-------|----------|
| **Lane 1** | File-internal (rename local var, extract private function) | Auto-proceed |
| **Lane 2** | Module-internal (tool internals, config parser internals, eval framework internals) | Proceed with council review |
| **Lane 3** | Cross-module (config YAML schema, connector interface, eval test case format) | Council review + user approval |
| **Lane 4** | BLOCKED (tool response shapes, MCP tool names, provenance/confidence contract) | Do not proceed without explicit user request |

### Blocked Areas (Lane 4)
- **Tool response shapes** — changing response structure breaks all consuming agents. Requires versioning.
- **Config YAML schema** — changing config format breaks all existing configs. Requires migration path.
- **Eval test case format** — changing test format requires updating the runner, evaluator, and all existing cases.
- **MCP tool names** — changing tool names breaks all agent configurations.
- **Provenance/confidence contract** — agents depend on these fields existing and being structured consistently.

## Step 3: Council Review (Lane 2+)

- **OpenAI**: Review for correctness — does the refactor preserve behavior? Are all consumers updated?
- **Gemini**: Review for completeness — are there consumers the dependency mapper missed? Edge cases?

## Step 4: Implementation

Execute the refactor. After each file change:
- Run `npm run build` to verify compilation
- Run affected eval test cases

## Step 5: Validation

1. `npm run build` — clean compile
2. Full eval suite — no regressions
3. If config schema changed: verify existing configs still parse correctly
4. If response shapes changed (Lane 4 only): document the breaking change
