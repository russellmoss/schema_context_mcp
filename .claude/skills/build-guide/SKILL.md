---
name: build-guide
description: "Build an agentic implementation guide from exploration results. Use after /new-feature exploration completes. Creates a phased, validation-gated guide that another agent can execute step-by-step."
---

# Build Agentic Implementation Guide

You are building an implementation guide from completed exploration results for schema-context-mcp. The guide must be executable by a single Claude Code agent working phase-by-phase with human checkpoints.

## Prerequisites

Before starting, verify that exploration files exist:
- `exploration-results.md` (synthesized findings)
- `code-inspector-findings.md`
- `data-verifier-findings.md`
- `pattern-finder-findings.md`

Read ALL of them. The exploration results are the primary source, but the raw findings files contain detail you'll need for exact line numbers, code snippets, and edge cases.

Also read:
- `.claude/mcp-tool-spec.md` — tool response shapes and contracts
- `.claude/config-schema.md` — config YAML structure
- `.claude/eval-spec.md` — eval test case format and scoring

## Guide Structure

Create `agentic_implementation_guide.md` in the project root with this exact structure:

### Header Section

```markdown
# Agentic Implementation Guide: [Feature Name]

## Reference Document
All decisions in this guide are based on the completed exploration files.
Those documents are the single source of truth.

## Feature Summary
[Table of new capabilities being added, their config sections, and affected tools]

## Architecture Rules
- All BigQuery queries use parameterized syntax — never string interpolation
- Every tool response must include provenance and confidence
- Resolution priority: native config > dbt meta > dbt description > warehouse description
- lint_query uses substring matching only — no regex, no AST
- health_check covers config-vs-schema drift only — no codebase scanning
- Eval test cases are YAML, not JS
- Tool names are snake_case

## Pre-Flight Checklist
npm run build 2>&1 | head -50
If pre-existing errors, stop and report. Do not proceed with a broken baseline.
```

### Phase Pattern

Every phase follows this template:

```markdown
# PHASE N: [Title]

## Context
[Why this phase exists, what it does, which files are affected]

## Step N.1: [Specific action]
**File**: [exact path]
[Exact code to add/change, with before/after when helpful]

## PHASE N — VALIDATION GATE
npm run build
npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml

**Expected**: [What the output should look like]

**STOP AND REPORT**: Tell the user:
- "[Summary of what was done]"
- "[Build status]"
- "[What's next]"
- "Ready to proceed to Phase [N+1]?"
```

### Standard Phase Order

**Phase 1: Config Schema Changes**
- New YAML fields, types, defaults, validation rules
- Changes to src/config/types.ts (TypeScript interfaces)
- Changes to src/config/parser.ts (YAML loading/validation)
- This INTENTIONALLY breaks the build if tools expect new config fields
- Validation gate: `npm run build` — count errors, these become the Phase 2-5 checklist

**Phase 2: Connector Changes (if needed)**
- New INFORMATION_SCHEMA queries in src/connectors/bigquery.ts
- Must use parameterized syntax
- Validation gate: verify queries compile via BigQuery dry-run

**Phase 3: Merger Changes (if needed)**
- Changes to src/config/merger.ts for new annotation merging logic
- Must maintain resolution priority: native > dbt meta > dbt description > warehouse
- Must tag provenance at merge time
- Validation gate: `npm run build`

**Phase 4: Tool Implementation**
- Handler in src/tools/ — new file or modification to existing tool
- Register in src/index.ts
- Response MUST include provenance and confidence on every annotation
- Response shape must be consistent with existing tools (see mcp-tool-spec.md)
- Validation gate: `npm run build`

**Phase 5: Eval Test Cases**
- YAML test cases in tests/cases/
- Cover: basic success, edge cases, negative controls
- Track A (SQL correctness), Track B (knowledge retrieval), Track C (workflow) as appropriate
- Validation gate: `npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml`

**Phase 6: Documentation Sync**
- Update `.claude/mcp-tool-spec.md` if tool response shapes changed
- Update `.claude/config-schema.md` if config schema changed
- Update `.claude/eval-spec.md` if eval framework changed
- Validation gate: review docs match implementation

**Phase 7: Integration Validation**
- Run full eval suite
- Verify provenance and confidence in all tool responses
- Verify resolution priority maintained
- Verify no regressions in existing tools

### Critical Rules for Guide Quality

1. **Provenance and confidence are non-negotiable.** Every annotation in every tool response must include both. The guide must specify where these are tagged.

2. **Resolution priority must be explicit.** If the feature touches merger.ts, the guide must state how native > dbt > warehouse is maintained.

3. **Eval coverage is required.** Every new behavior must have at least one eval test case. Include expected results.

4. **Validation gates must have concrete commands.** Not "verify the changes" — actual bash commands that produce checkable output.

5. **Phase errors are the checklist.** Build errors after Phase 1 are expected and represent remaining work. Track them.

6. **Include a Troubleshooting section.** Common issues: missing provenance, wrong confidence level, config not loading, eval case format errors.

## Output

Save the guide as `agentic_implementation_guide.md` in the project root.

**STOP AND REPORT**: Tell the user:
- "Implementation guide complete: `agentic_implementation_guide.md`"
- "[N] phases, [M] files to modify"
- "**Recommended next step**: Run `/council` to get adversarial review before execution."
- "When validated, start execution with: `Read agentic_implementation_guide.md top to bottom. Execute each phase sequentially. Stop and report at every gate. Start with Pre-Flight.`"
