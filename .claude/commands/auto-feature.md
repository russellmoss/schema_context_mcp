---
name: auto-feature
description: End-to-end feature implementation pipeline for schema-context-mcp. Exploration → council review → build guide → implementation → validation.
---

# /auto-feature — Feature Implementation Pipeline

You are implementing a feature for schema-context-mcp, an MCP server that provides AI agents with annotated warehouse schema context.

**Feature request:** $ARGUMENTS

---

## Step 1: Exploration

Spawn exploration teammates to investigate in parallel:

1. **code-inspector**: Trace existing tool implementation patterns, config schema impact, response shape consistency, provenance/confidence correctness relevant to this feature.
2. **pattern-finder**: Find eval test coverage gaps, response patterns that this feature must follow, error handling conventions.
3. **dependency-mapper**: Map imports/exports/consumers that this feature will touch. Identify blast radius.

Wait for all exploration results before proceeding.

## Step 2: Build Guide

Based on exploration findings, create a phased build guide:

1. **Config schema changes** — new YAML fields, types, defaults, validation
2. **Type definitions** — TypeScript interfaces/types in src/config/types.ts
3. **Connector changes** — new INFORMATION_SCHEMA queries if needed
4. **Tool implementation** — handler in src/tools/, registered in src/index.ts
5. **Merger/resolution logic** — changes to src/config/merger.ts if this feature touches annotation merging
6. **Eval test cases** — YAML test cases in tests/cases/ covering the feature
7. **Documentation sync** — update .claude/mcp-tool-spec.md, config-schema.md, eval-spec.md as needed
8. **Manual validation** — specific checks to run after implementation

## Step 3: Council Review

Before implementing, get council review on the build guide:

- **OpenAI**: Review tool response correctness — does the response shape match existing tools? Is provenance/confidence handled correctly? Will this cause config-to-schema drift?
- **Gemini**: Review eval coverage gaps — are there missing test cases? Edge cases? Negative controls? Review UX for agent consumers — will agents know when/how to use this tool?

Incorporate council feedback into the build guide.

## Step 4: Implementation

Execute the build guide phase by phase. After each phase:
- Run `npm run build` to verify compilation
- Check that all existing eval test cases still pass

## Step 5: Validation

After implementation:
1. Run `npm run build` — must compile clean
2. Run eval suite against new and existing test cases
3. Verify provenance and confidence are included in all responses
4. Verify resolution priority (native > dbt meta > dbt description > warehouse) is maintained
5. Verify lint_query uses substring matching only (no regex, no AST)
6. Verify health_check covers config-vs-schema drift only (no codebase scanning)

## Project-Specific Rules
- All tool responses MUST include provenance + confidence
- Resolution priority: native config > dbt meta > dbt description > warehouse description
- lint_query is substring-only (no AST parsing)
- health_check covers config-vs-schema drift only (no codebase scanning)
- Eval test cases are YAML, not JS — use the built-in eval framework
- Tool names are snake_case
- BigQuery queries use parameterized syntax — never string interpolation
