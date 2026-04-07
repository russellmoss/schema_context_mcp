# Eval Framework Specification

schema-context-mcp ships with a built-in evaluation harness that validates config accuracy against live warehouse context. The framework is generic — bring your own warehouse and config.

---

## Three Tracks

### Track A — SQL Correctness
Does the agent write correct SQL using only MCP context?

- Agent receives a natural-language request
- Agent calls MCP tools to get context
- Agent writes SQL
- Evaluator checks: required patterns present, banned patterns absent, semantic structure correct

### Track B — Knowledge Retrieval
Does the MCP return accurate answers to direct knowledge questions?

- Evaluator asks a question (e.g., "What flag should I use to count SQOs?")
- MCP tool is called directly
- Response is checked against golden assertions (expected_answer_contains, expected_answer_not_contains)

### Track C — Workflow Replacement
Can agents complete full workflows using only MCP context?

- Agent executes a full workflow (data analysis, feature exploration, semantic query)
- Output quality is compared to equivalent doc-based workflow
- Validation checks: correct view selection, correct field resolution, correct filter logic

---

## Test Case YAML Format

```yaml
id: count-sqos-by-channel          # Unique identifier
request: "Count SQOs by channel"    # Natural-language prompt
difficulty: basic | intermediate | advanced
category: volume_metric | conversion_rate | activity_metric | attribution | forecast | activity_analysis

# Track A fields
required_patterns:
  - pattern: "is_sqo_unique = 1"    # Substring that MUST appear in generated SQL
    rule: sqo_volume_dedup           # Rule ID from schema-config.yaml
    reason: "Must use dedup flag"    # Why this pattern is required

banned_patterns:
  - pattern: "is_sqo = 1"           # Substring that must NOT appear
    without: "is_sqo_unique"         # Exception: OK if this other pattern is also present
    rule: sqo_volume_dedup

expected_tool_calls:                 # Which MCP tools the agent should call
  - describe_view: { view: vw_funnel_master, intent: count_sqos }

reference_sql: |                     # Gold-standard SQL for comparison
  SELECT ...

# Track B fields
knowledge_assertions:
  - question: "What is the correct dedup filter?"
    expected: "is_sqo_unique = 1"
    tool: describe_view

# Negative controls
negative_controls:
  - description: "Should NOT apply recordtypeid at lead level"
    banned_pattern: "recordtypeid"
    reason: "Lead-level metrics include re-engagement"
```

---

## Scoring Model

### Per-Case Score

```yaml
required_checks:  [{pattern, status: pass|fail, note}]
banned_checks:    [{pattern, status: pass|fail, note}]
negative_checks:  [{control, status: pass|fail, note}]
semantic_score:   pass | partial | fail
knowledge_score:  pass | partial | fail    # Track B only
overall:          pass | partial | fail
failure_category: config_gap | surfacing_failure | evaluator_strict | agent_reasoning | null
gaps:             [list of specific config additions needed]
```

### Suite Summary

```
Track A — SQL Correctness: X/10 pass, Y partial, Z fail
Track B — Knowledge Retrieval: X/22 golden assertions passed
Track C — Workflow Replacement: X/4 equivalent quality
Negative Controls: X/5 passed
Config gaps to fix: N
Surfacing failures to fix: N
```

---

## Failure Attribution Categories

| Category | Meaning | Fix |
|---|---|---|
| `config_gap` | Knowledge missing from config | Add annotation or rule to schema-config.yaml |
| `surfacing_failure` | Knowledge exists in config but tool didn't return it | Adjust intent routing, severity, or dangerous_columns list |
| `evaluator_strict` | Evaluator flagged something that's actually acceptable | Relax test case pattern or add `without` clause |
| `agent_reasoning` | Agent had sufficient context but reasoned poorly | Not a config problem — log and move on |

---

## Human Review Output

Every eval run produces two outputs:

1. **Technical report** — required checks, banned checks, failure attribution, repair suggestions (for builders)
2. **Business review summary** — plain-English descriptions of what failed, business impact, and whether human judgment is needed (for RevOps/business reviewers)

Non-passing cases must include a `review_summary` block with: case, verdict, business_impact, plain_english_miss, recommended_fix, needs_human_decision. Suite reports must include a plain-English business summary alongside technical scoring.

See `testing-protocol.md` for full format specification and examples.

---

## Running the Eval

```bash
# Full suite
npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml

# Single test case
npx schema-context-mcp eval --cases ./tests/cases/count-sqos.yaml --config ./config/schema-config.yaml

# Specific track only
npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml --track A
```

---

## Iteration Loop

1. Run full suite
2. Identify failures → categorize (config_gap / surfacing / evaluator / agent)
3. Fix: config gaps → add annotations; surfacing → adjust routing; evaluator → relax patterns
4. Re-run ONLY failing tests
5. When all pass → re-run FULL suite (catch regressions)
6. When full suite passes 2x consecutive → MCP is ready

---

## Execution-Backed Validation (Final Gate)

After all tracks pass structurally:
1. **Dry-run compile** — all Track A SQL through BigQuery dry-run
2. **Golden result check** — 3 key metrics compared against known-correct dashboard numbers
3. **Net-new analysis** — one request NOT in test suite, using only MCP, manually evaluated
