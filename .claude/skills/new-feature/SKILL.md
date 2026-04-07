---
name: new-feature
description: "Kick off a new MCP server feature with parallel exploration. Use when adding tools, config capabilities, metrics, or rules. Spawns an agent team for codebase inspection, data verification, and pattern analysis."
---

# New Feature — Parallel Exploration

You are starting the exploration phase for a new feature in schema-context-mcp. The user will describe what they want to add. Your job is to run a parallel investigation and produce a comprehensive exploration report.

## Step 1: Understand the Feature

If not already clear from the user's request, identify:
- Is this a new tool, a config schema extension, a new rule type, or an eval enhancement?
- What MCP tools will be affected?
- Does this require new BigQuery queries or new config sections?
- Will this change any tool response shapes? (if so, flag as breaking change)

Do NOT ask more than necessary — infer what you can from the request.

## Step 2: Create Agent Team

Spawn an agent team with 3 teammates:

### Teammate 1: Code Inspector (agent: code-inspector)

Task: "Read `.claude/mcp-tool-spec.md` and `.claude/config-schema.md` for reference. Then investigate the codebase for the following feature: $ARGUMENTS

Find:
- Every TypeScript type/interface that needs new fields (src/config/types.ts, tool response types)
- Every tool handler that would be affected (src/tools/*.ts)
- How the merger currently handles the relevant config sections
- How the eval harness would need to cover this feature
- Whether this feature requires new connector queries
- Whether provenance and confidence would need new logic

Save findings to `code-inspector-findings.md` in the project root."

### Teammate 2: Data Verifier (agent: data-verifier)

Task: "Read `.claude/config-schema.md` for the config structure. Then verify the data layer for: $ARGUMENTS

Using MCP access to BigQuery:
- Do the fields/views referenced by this feature exist?
- What are population rates and data quality for relevant fields?
- If new INFORMATION_SCHEMA queries are needed, prototype them
- If config annotations need to be validated against live schema, run the checks
- Flag any views or fields that are missing and would block implementation

Save findings to `data-verifier-findings.md` in the project root."

### Teammate 3: Pattern Finder (agent: pattern-finder)

Task: "Read `.claude/mcp-tool-spec.md` for existing tool patterns. Then investigate: $ARGUMENTS

Find:
- How existing tools with similar functionality are implemented
- What response shape patterns this feature should follow
- How existing eval test cases cover similar features
- Whether there are error handling patterns to replicate
- Provenance/confidence patterns to follow

Save findings to `pattern-finder-findings.md` in the project root."

## Step 3: Synthesize Results

Once all teammates complete, read all three findings files and produce `exploration-results.md`:

### Sections:
1. **Feature Summary** — What's being added, which config sections, which tools
2. **Data Status** — Fields exist / missing, schema validation results
3. **Files to Modify** — Complete list with file paths, what changes
4. **Type Changes** — Exact interfaces/types to add or extend
5. **Response Shape Impact** — Will any tool response shapes change? Breaking or additive?
6. **Eval Coverage Plan** — What test cases are needed (Track A, B, C, negative controls)
7. **Recommended Phase Order** — Ordered implementation phases
8. **Risks and Blockers** — Missing data, breaking changes, config migration needs

## Step 4: Present to User

Tell the user:
- "Exploration complete. [N] files to modify, [blockers if any]."
- "Run `/build-guide` to generate the implementation guide, or investigate further."
- If response shapes would change: "WARNING: This feature changes tool response shapes — requires versioning discussion."
