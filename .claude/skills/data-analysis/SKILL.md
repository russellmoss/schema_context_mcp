---
name: data-analysis
description: "Build a validated data analysis plan using MCP tools for warehouse context. Explores schema via MCP, validates queries against BigQuery, runs adversarial review with council models, and produces a ready-to-execute analysis document. Use to test MCP context quality against real analysis workflows."
---

# Data Analysis Agent

You are a data analysis planning agent. Given a natural language analysis request, you will:

1. Gather warehouse context exclusively through MCP tool calls (not static docs)
2. Build a detailed analysis plan with SQL queries
3. Validate every query against live BigQuery
4. Send the plan for adversarial review by GPT and Gemini
5. Incorporate feedback and produce a final, validated analysis document

**This skill serves double duty**: it produces real analysis AND validates that the MCP provides sufficient context for data analysis workflows.

## Inputs

The user provides `$ARGUMENTS` — a natural language description of the analysis they want.

---

## Phase 1: Understand the Request & Gather Context via MCP

### 1.1 Parse the request

Identify:
- **Metrics**: What numbers are being asked for?
- **Dimensions**: What groupings or breakdowns are needed?
- **Filters**: What populations, date ranges, or exclusions apply?
- **Definitions**: What business terms need to be resolved?

### 1.2 Gather context through MCP tools

Use MCP tool calls to gather all needed context. **Do not read .claude/bq-*.md files directly** — the whole point is to test the MCP path.

For each concept in the request:
1. Call `list_views` to find relevant views
2. Call `describe_view` with appropriate intent to get field annotations, dangerous columns, key filters
3. Call `get_metric` for any named metrics (with mode if applicable)
4. Call `resolve_term` for business vocabulary
5. Call `get_rule` for any query rules that apply

**Track MCP adequacy**: For each piece of context you need, note:
- Did the MCP provide it? (yes/no)
- Was it accurate? (verified later against BigQuery)
- Was it surfaced with the right intent? (or did you have to dig for it)

### 1.3 Search codebase for supplementary patterns

If the MCP doesn't surface something you need, search the codebase:
- Grep for field names, filter logic, calculation patterns
- Check existing eval test cases for similar queries

Document any context gaps — these become repair suggestions for the MCP config.

---

## Phase 2: Build the Analysis Plan

Create a folder in `docs/analyses/` named descriptively with a date prefix (e.g., `docs/analyses/2026-04-07-sga-weekly-calls/`).

Create `analysis-plan.md` inside with this structure:

```markdown
# [Descriptive Analysis Title]

**Requested**: [date]
**Request**: [user's original request, verbatim]
**Status**: Draft — pending validation
**Context source**: MCP-only (no .claude/bq-*.md docs used)

---

## 1. Request Interpretation

[Restate in precise terms. Map every business term to its technical definition.]

### Definitions Used
| Business Term | Technical Definition | MCP Source |
|---|---|---|
| [term] | [exact filter/logic] | [which MCP tool provided this] |

### Scope
- **Date Range**: [exact range with logic]
- **Population**: [who is included/excluded and why]
- **Metrics**: [what is being measured]
- **Granularity**: [per week, per SGA, etc.]

## 2. Data Sources
| Source | Purpose | Key Fields |
|---|---|---|
| [view/table] | [why] | [fields] |

## 3. Methodology & Rationale
[Step-by-step approach. For each decision, explain WHY.]

## 4. SQL Queries
### Query 1: [Purpose]
```sql
[validated SQL]
```
**Validation result**: [PASSED/FAILED — row count, sample data]

## 5. MCP Context Adequacy
| Context Needed | MCP Provided | Accurate | Surfacing Quality | Gap? |
|---|---|---|---|---|
| [what you needed] | [yes/no] | [yes/no/untested] | [good/poor/missing] | [repair suggestion if gap] |

## 6. Council Review
**Reviewed by**: OpenAI, Gemini
**Changes made**: [summary]
```

---

## Phase 3: Validate Queries Against BigQuery

For EVERY field referenced in your SQL:
1. Verify it exists via INFORMATION_SCHEMA
2. Verify data type matches your usage
3. Check population rate for key fields

Execute every SQL query. For each:
1. Run the query
2. Record row count and sample output
3. Sanity-check results
4. If query fails, fix and re-run
5. Record validation result in plan

**Rules:**
- Never use string interpolation — always literal values or @paramName
- Use dedup flags per MCP rule guidance
- Test with LIMIT 100 first for complex queries

---

## Phase 4: Adversarial Council Review

### 4.1 Send to OpenAI (with reasoning_effort: "high")

Include the analysis plan plus MCP tool response excerpts as context. Ask for review of:
1. **Definition correctness**: Does the plan correctly define every business term?
2. **SQL correctness**: Right field names, NULL handling, dedup flags?
3. **Logical correctness**: Will queries answer the question asked?
4. **Dedup and counting**: Any double-counting?
5. **Date range and filter logic**: Boundaries correct?

### 4.2 Send to Gemini

Ask for review of:
1. **Assumptions**: Documented? Correct?
2. **Missing context**: Related fields or views the plan missed?
3. **Statistical validity**: Methodology sound?
4. **Business logic alignment**: Consistent with how the business measures this?

---

## Phase 5: Incorporate Feedback & Finalize

### 5.1 Triage council feedback

**Bucket A — Agree**: Fix immediately, re-run changed queries.
**Bucket B — Disagree**: Document reasoning.
**Bucket C — Needs user input**: Flag as "Pending User Input."

### 5.2 Write full council feedback into the plan appendix

Copy-paste complete raw responses — never summarize.

### 5.3 Update MCP Context Adequacy section

Based on everything learned, update the adequacy table. Any gaps become actionable repair suggestions for the MCP config:
- Missing field annotation → `add_field_annotation`
- Missing rule → `add_rule`
- Wrong intent surfacing → `strengthen_intent_surfacing`
- Missing dangerous column → `add_dangerous_column`

---

## Phase 6: Present to User

1. **Summary**: 2-3 sentences
2. **Key decisions**: Important methodological choices
3. **Council findings**: What was caught, what was fixed
4. **MCP adequacy**: How well did MCP-only context work? Any gaps to fix?
5. **Questions for user** (if any)
6. **Location**: Where the analysis plan is saved

**CRITICAL RULES**:
- Run ALL validation queries via BigQuery MCP — never assume data
- Every business term must be resolved through MCP tools first
- If MCP is insufficient, note the gap but still complete the analysis using supplementary sources
- Save everything to the analysis folder
- ALWAYS paste full council responses into the appendix
- NEVER finalize a plan with unanswered user questions
