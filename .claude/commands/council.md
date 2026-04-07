---
name: council
description: Multi-model review for schema-context-mcp changes. Gets perspectives from OpenAI and Gemini on correctness, coverage, and agent UX.
---

# /council — Multi-Model Review

Review the current changes or proposal for schema-context-mcp.

**Review target:** $ARGUMENTS

---

## Context for Reviewers

This is an MCP server that gives AI agents annotated warehouse schema context so they write correct SQL. The consuming agents are Claude Code, Cursor, and Copilot — they call tools like `describe_view`, `get_metric`, `lint_query` to get field annotations, business rules, and warnings before writing SQL.

**Critical risks:**
- Schema drift: config says a field exists but it doesn't
- Wrong annotations surfaced for wrong intent
- Trust model provenance/confidence labels being incorrect
- lint_query false positives (flagging correct SQL as wrong)

**Who's affected:** AI agents and the developers configuring them. A bad bug means the agent silently writes wrong SQL that produces incorrect financial numbers.

**Process:** We use /auto-feature for new tools, council review, and a 3-track eval framework (testing-protocol.md) for validation.

## Review Prompts

### Ask OpenAI
Review for **correctness and safety**:
1. Does every tool response include provenance and confidence fields?
2. Is resolution priority (native > dbt meta > dbt description > warehouse) maintained in the merger?
3. Are there any cases where wrong annotations could be surfaced for the wrong intent?
4. Could this change cause config-to-schema drift that wouldn't be caught by health_check?
5. Are BigQuery queries using parameterized syntax (not string interpolation)?

### Ask Gemini
Review for **completeness and agent UX**:
1. Are there eval test cases covering this change? What gaps exist?
2. Are there edge cases or negative controls missing?
3. Will agents know when and how to use this tool/feature?
4. Is the response shape consistent with other tools?
5. Always verify that every tool response includes provenance and confidence. Always check that resolution priority (native > dbt > warehouse) is maintained in the merger.

## Output

Synthesize both reviews into:
- **Approved**: No blocking issues found
- **Approved with notes**: Minor issues to address, not blocking
- **Changes requested**: Issues that must be fixed before proceeding
- **Blocked**: Fundamental concerns that require rethinking the approach
