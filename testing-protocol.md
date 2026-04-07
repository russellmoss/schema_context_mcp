# Savvy Wealth — schema-context-mcp Validation Protocol

**Purpose**: Validate that the MCP fully replaces the five `.claude/bq-*.md` files as the primary context source for all agentic workflows in the Dashboard project. Not just SQL generation — feature planning, data analysis, exploration, and review.

**Standard**: The MCP passes when every agent workflow that currently reads the `.claude/` docs produces equivalent-quality output using only MCP tool calls.

---

## MVP Build Order Alignment

Validation effort should track the intended v1 build order. Do not over-invest in advanced workflow evals before the core tools work.

1. **`describe_view`** — the primary tool; must be correct and complete before anything else matters
2. **`health_check`** — drift detection validates that config stays aligned with the live warehouse
3. **Config bootstrap quality** — the generated `schema-config.yaml` must cover the source docs without manual gap-filling for common cases
4. **Knowledge retrieval** (Track B) — the MCP answers direct questions correctly
5. **SQL generation** (Track A) — agents write correct SQL using only MCP context
6. **Workflow replacement** (Track C) — full agent workflows produce equivalent output to doc-based runs

Start eval investment at the top of this list. Track C failures are not actionable until steps 1–4 are solid.

---

## What We're Replacing

These five files currently serve as authoritative context for all agents:

| File | Knowledge class | Lines |
|---|---|---|
| `bq-views.md` | View registry — purpose, consumers, dependencies, key fields | ~280 |
| `bq-field-dictionary.md` | Field definitions, types, wrappers, business context | ~330 |
| `bq-patterns.md` | Query patterns, dedup rules, anti-patterns, cohort/period logic | ~340 |
| `bq-salesforce-mapping.md` | SF→BQ field lineage, sync cadence, type gotchas | ~230 |
| `bq-activity-layer.md` | Task linkage, channel/direction, outbound filters, attribution | ~320 |

These are consumed by:

- `/data-analysis` skill (analysis planning + SQL generation + council review)
- `/auto-feature` pipeline (feature exploration + build guide + implementation)
- Semantic layer / Explore agent (natural language → SQL)
- Ad hoc Claude Code sessions (query writing, debugging, investigation)

All of these must work with MCP-only context.

---

## Phase 0: Bootstrap from Existing Docs

The five `.claude/bq-*.md` files are high-quality, battle-tested documentation. The bootstrap phase extracts their knowledge into a structured MCP config before any validation begins.

### Steps

1. **Generate initial config** — Parse each doc and emit a draft `schema-config.yaml` covering:
   - View registry (from `bq-views.md`): purpose, grain, key fields, consumers
   - Field annotations (from `bq-field-dictionary.md`): types, business context, dangerous columns
   - Rules (from `bq-patterns.md`): dedup flags, banned patterns, cohort/period logic, coalesce rules
   - Salesforce mappings (from `bq-salesforce-mapping.md`): sync cadence, type gotchas, field lineage
   - Activity layer (from `bq-activity-layer.md`): join keys, outbound filters, attribution rules

2. **Review for omissions** — Manually scan the generated config against each source doc. Check for:
   - Missing rules (especially negative rules like "do NOT add AUM fields")
   - Malformed rule primitives (free-text where `ban_pattern` or `require_filter` is needed)
   - Missing dangerous-column annotations
   - Missing view-level intent hints

3. **Seed critical rules** — Ensure these high-value rules are present before the first full run:
   - `is_sqo_unique` for volume counts (not `is_sqo`)
   - `is_primary_opp_record` for AUM aggregation
   - `recordtypeid` exclusion at opp level, inclusion at lead level
   - `COALESCE(Underwritten_AUM__c, Amount)` — never add
   - Outbound activity filters (`is_engagement_tracking`, `lemlist`, `ListEmail`)
   - `task_executor_name` vs `SGA_Owner_Name__c` attribution split
   - Cohort vs period mode flag usage

4. **Freeze baseline** — Tag the config as `v0.1.0-bootstrap`. This is the starting point for all eval iterations. Do not begin the full validation suite until this baseline exists.

5. **Begin validation** — Only now proceed to the test environment setup and full suite.

### Bootstrap Coverage Checklist

Before leaving Phase 0, confirm coverage for each source doc class:

| Source Doc Class | MCP Config Section / Tool | Coverage | Proving Eval Cases |
|---|---|---|---|
| View registry (purpose, consumers, dependencies) | `views` → `describe_view`, `list_views` | complete / partial / deferred | _list case IDs_ |
| Field semantics (types, dedup flags, business context) | `fields` → `describe_view` | complete / partial / deferred | _list case IDs_ |
| Query patterns (anti-patterns, dedup rules, cohort/period) | `rules`, `metrics` → `get_rule`, `get_metric`, `lint_query` | complete / partial / deferred | _list case IDs_ |
| Activity-layer logic (joins, attribution, outbound filters) | `rules`, `fields` → `describe_view`, `get_rule` | complete / partial / deferred | _list case IDs_ |
| Source-system lineage (SF mapping, sync cadence, gotchas) | `fields`, `views` → `describe_view`, `resolve_term` | complete / partial / deferred | _list case IDs_ |

Fill in coverage status and proving eval case IDs during bootstrap review. Partial or deferred items must have a tracking note explaining what is missing and when it will be addressed.

---

## Minimum v1 Config Contract

Tests should assume only these config sections are in scope for v1:

- **`fields`** — field-level annotations (meaning, type info, use-instead-of, dangerous flags)
- **`views`** — view-level annotations (purpose, grain, key filters, consumers, dangerous columns)
- **`rules`** — query-pattern rules
- **`metrics`** — named metric definitions (numerator, denominator, mode guidance)
- **`terms`** — domain vocabulary
- **`dbt`** (optional) — manifest/semantic manifest path for teams that use dbt

Rule testing should be limited to the supported v1 primitives:

- `ban_pattern` — patterns that should never appear
- `prefer_field` — "you used X, consider Y"
- `require_filter` — "you queried X without Y"
- `date_type_rule` — DATE vs TIMESTAMP enforcement

Do not write eval cases that depend on config sections or rule types not listed here. If a test requires capabilities beyond v1, mark it as deferred.

---

## Core Response Contracts to Validate

The test suite should validate response shape consistency, not just content accuracy. Each core tool must return predictable structured fields.

- **`describe_view`** — must consistently return: `purpose`, `grain`, `dangerous_columns`, `key_filters`, `annotated_columns` with `provenance` and `confidence` per annotation. When `intent` is provided, must return `intent_warnings`. When configured, must return `consumers`.
- **`get_metric`** — must consistently return: `numerator`, `denominator`, `mode` (cohort/period), `gotchas`, `provenance`.
- **`get_rule`** — must consistently return: `id`, `type`, `severity`, `message`, `provenance`.
- **`health_check`** — must consistently return: drift categories (`unannotated_fields`, `stale_annotations`, `config_integrity`), counts per category, and actionable `suggestions`.

Include at least one test per tool that validates response shape independent of content. A response that returns the right information in an unpredictable structure is a bug.

---

## Test Environment Setup

```bash
git checkout -b test/mcp-validation
rm .claude/bq-views.md
rm .claude/bq-field-dictionary.md
rm .claude/bq-patterns.md
rm .claude/bq-salesforce-mapping.md
rm .claude/bq-activity-layer.md
# Keep other .claude/ files (skills, etc.) — only remove the BQ docs
# Ensure schema-context MCP is configured in .mcp.json
```

---

## Track A: SQL Correctness

10 test cases covering the most common failure modes. Each case defines required patterns, banned patterns, and reference SQL. The agent writes SQL using only MCP tools.

### Basic (should pass immediately)

#### A1: SQO Volume Count

```yaml
id: count-sqos-by-channel
request: "Count SQOs by channel for Q1 2026"
difficulty: basic
category: volume_metric

required_patterns:
  - pattern: "is_sqo_unique = 1"
    rule: sqo_volume_dedup
    reason: "Must use dedup flag for volume counts"
  - pattern: "recordtypeid = '012Dn000000mrO3IAI'"
    rule: re_engagement_exclusion
    reason: "Must exclude re-engagement at opp level"
  - pattern: "Channel_Grouping_Name"
    rule: canonical_channel
    reason: "Must use canonical channel field"
  - pattern: "TIMESTAMP"
    rule: date_type_safety
    reason: "Date_Became_SQO__c is TIMESTAMP"

banned_patterns:
  - pattern: "is_sqo = 1"
    without: "is_sqo_unique"
    rule: sqo_volume_dedup
  - pattern: "new_mapping"
    rule: no_new_mapping
  - pattern: "CloseDate"
    rule: use_stage_entered_closed

expected_tool_calls:
  - describe_view: { view: vw_funnel_master, intent: count_sqos }

reference_sql: |
  SELECT v.Channel_Grouping_Name,
    COUNT(CASE WHEN v.is_sqo_unique = 1 THEN 1 END) AS sqo_count
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE v.recordtypeid = '012Dn000000mrO3IAI'
    AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2026-01-01')
    AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP('2026-03-31 23:59:59')
  GROUP BY 1 ORDER BY 2 DESC
```

#### A2: Joined Advisor Count

```yaml
id: count-joined
request: "How many advisors joined in Q1 2026?"
difficulty: basic
category: volume_metric

required_patterns:
  - pattern: "is_joined_unique = 1"
    rule: joined_volume_dedup
  - pattern: "recordtypeid = '012Dn000000mrO3IAI'"
    rule: re_engagement_exclusion
  - pattern: "advisor_join_date__c"
    rule: correct_date_field
  - pattern: "DATE("
    rule: date_type_safety
    reason: "advisor_join_date__c is DATE, not TIMESTAMP"

banned_patterns:
  - pattern: "is_joined = 1"
    without: "is_joined_unique"
    rule: joined_volume_dedup
  - pattern: "TIMESTAMP(v.advisor_join_date"
    rule: date_type_safety
    reason: "advisor_join_date__c is DATE type"
```

#### A3: Outbound SGA Activity

```yaml
id: sga-outbound-effort
request: "Total outbound touchpoints per SGA for Q1 2026"
difficulty: basic
category: activity_metric

required_patterns:
  - pattern: "direction = 'Outbound'"
    rule: outbound_filter
  - pattern: "is_engagement_tracking = 0"
    rule: sga_outbound_filters
  - pattern: "[lemlist]"
    rule: sga_outbound_filters
  - pattern: "ListEmail"
    rule: sga_outbound_filters
  - pattern: "task_executor_name"
    rule: executor_attribution
    reason: "Individual effort uses executor, not lead owner"

banned_patterns:
  - pattern: "SGA_Owner_Name__c"
    rule: executor_vs_owner
    reason: "For effort measurement, use task_executor_name"
  - pattern: "task_who_id"
    rule: correct_join_key
    reason: "Use Full_prospect_id__c for lead linkage"
```

#### A4: Open Pipeline AUM

```yaml
id: open-pipeline-aum
request: "What's our total open pipeline AUM?"
difficulty: basic
category: pipeline_metric

required_patterns:
  - pattern: "is_sqo_unique = 1"
    rule: sqo_filter
  - pattern: "is_primary_opp_record = 1"
    rule: aum_dedup
    reason: "AUM aggregation uses is_primary_opp_record"
  - pattern: "recordtypeid = '012Dn000000mrO3IAI'"
    rule: re_engagement_exclusion
  - pattern: "COALESCE"
    rule: aum_coalesce
    reason: "AUM is COALESCE(Underwritten_AUM__c, Amount)"

banned_patterns:
  - pattern: "Underwritten_AUM__c + Amount"
    rule: no_aum_addition
  - pattern: "Closed Lost"
    rule: open_pipeline_stages
    reason: "Open pipeline excludes Closed Lost, Joined, On Hold, Signed"

negative_controls:
  - description: "SHOULD use is_primary_opp_record for AUM sum, even though volume counts use is_sqo_unique"
    required_pattern: "is_primary_opp_record"
    reason: "This is one of the few cases where is_primary_opp_record is correct"
```

### Intermediate (conversion logic, re-engagement nuance)

#### A5: Cohort Conversion Rate

```yaml
id: sql-to-sqo-cohort
request: "What's the SQL-to-SQO conversion rate for Q4 2025 cohort?"
difficulty: intermediate
category: conversion_rate

required_patterns:
  - pattern: "sql_to_sqo_progression"
    rule: cohort_numerator
  - pattern: "eligible_for_sql_conversions"
    rule: cohort_denominator
  - pattern: "converted_date_raw"
    rule: cohort_anchor_date
    reason: "Cohort mode anchors on entry date into current stage"

banned_patterns:
  - pattern: "Date_Became_SQO__c"
    rule: not_period_mode
    reason: "Period mode uses next-stage date for numerator — wrong for cohort"
  - pattern: "COUNTIF"
    rule: not_period_mode
    reason: "Cohort mode uses SUM of progression/eligibility flags"

negative_controls:
  - description: "Should NOT apply recordtypeid filter — eligibility flags already handle it"
    note: "Not an error if present, but unnecessary"
```

#### A6: Lead-Level Metrics with Re-Engagement

```yaml
id: prospect-count-with-reengagement
request: "How many prospects entered the funnel in March 2026?"
difficulty: intermediate
category: volume_metric

required_patterns:
  - pattern: "FilterDate"
    rule: correct_date_field
  - pattern: "TIMESTAMP("
    rule: date_type_safety
    reason: "FilterDate is TIMESTAMP"

banned_patterns:
  - pattern: "recordtypeid"
    rule: lead_level_no_recordtype
    reason: "Lead-level metrics include re-engagement. No recordtypeid filter."
  - pattern: "lead_record_source = 'Lead'"
    rule: includes_reengagement
    reason: "Unless explicitly asked, prospects include re-engagement"

negative_controls:
  - description: "MUST NOT filter out re-engagement at lead level"
    reason: "Re-engagement records are included in Prospects, Contacted, MQL, SQL by design"
```

#### A7: SGA Attribution on Opp Metrics

```yaml
id: sga-sqo-attribution
request: "How many SQOs did SGA 'Jane Smith' generate in Q1?"
difficulty: intermediate
category: attribution

required_patterns:
  - pattern: "SGA_Owner_Name__c"
    rule: dual_attribution_lead
  - pattern: "Opp_SGA_Name__c"
    rule: dual_attribution_opp
  - pattern: "is_sqo_unique = 1"
    rule: sqo_volume_dedup
  - pattern: "recordtypeid"
    rule: re_engagement_exclusion

banned_patterns:
  - pattern: "task_executor_name"
    rule: wrong_attribution_field
    reason: "SQO attribution uses lead/opp ownership, not task execution"

negative_controls:
  - description: "Must use BOTH SGA_Owner_Name__c and Opp_SGA_Name__c (OR condition)"
    reason: "SGA attribution can come from Lead or Opportunity path"
```

### Advanced (cross-view joins, specialized logic)

#### A8: Activity-to-Cohort Alignment

```yaml
id: touchpoints-per-lead-cohort
request: "Average outbound touchpoints per lead for the January 2026 cohort"
difficulty: advanced
category: activity_analysis

required_patterns:
  - pattern: "task_created_date_est >= "
    rule: activity_date_alignment
    reason: "Must bound activities to on-or-after lead's FilterDate"
  - pattern: "Full_prospect_id__c"
    rule: correct_join_key
  - pattern: "direction = 'Outbound'"
    rule: outbound_filter
  - pattern: "is_engagement_tracking = 0"
    rule: sga_outbound_filters

banned_patterns:
  - pattern: "task_who_id"
    rule: wrong_join_key
    reason: "task_who_id misses activities logged against the Opportunity"
```

#### A9: Forecast Query

```yaml
id: pipeline-forecast
request: "Show expected joins by quarter from current pipeline"
difficulty: advanced
category: forecast

required_patterns:
  - pattern: "vw_forecast_p2"
    rule: correct_view
    reason: "Must use the forecast view, not vw_funnel_master"
  - pattern: "p_join"
    rule: probability_field
  - pattern: "projected_quarter"
    rule: quarter_assignment
  - pattern: "expected_aum_weighted"
    rule: weighted_metric

banned_patterns:
  - pattern: "vw_funnel_master"
    rule: wrong_view
    reason: "Forecast data lives in vw_forecast_p2"
```

#### A10: Cold Call Analysis

```yaml
id: true-cold-calls
request: "How many true cold calls did each SGA make per week in Q1?"
difficulty: advanced
category: activity_analysis

required_patterns:
  - pattern: "is_true_cold_call"
    rule: correct_cold_call_flag
  - pattern: "task_executor_name"
    rule: executor_attribution
    reason: "Effort measurement uses executor, not lead owner"
  - pattern: "direction = 'Outbound'"
    rule: outbound_filter

banned_patterns:
  - pattern: "is_cold_call"
    without: "is_true_cold_call"
    rule: strict_cold_call
    reason: "is_cold_call is loose definition. is_true_cold_call is the strict version."
  - pattern: "SGA_Owner_Name__c"
    rule: executor_vs_owner
    reason: "For effort measurement, use task_executor_name"
```

---

## Track B: Knowledge Retrieval

Direct knowledge questions that the MCP must answer correctly. These test the config and tool responses, not SQL generation. Each maps to a specific source doc.

### From `bq-patterns.md`

```yaml
- question: "What flag should I use to count SQOs?"
  expected_answer_contains: "is_sqo_unique"
  expected_answer_not_contains: "is_sqo = 1"
  tool: describe_view or get_rule
  source_doc: bq-patterns.md rule 1

- question: "Do I need a recordtypeid filter for counting prospects?"
  expected: "No — lead-level metrics include all record types including re-engagement"
  tool: get_rule
  source_doc: bq-patterns.md rule 2/8

- question: "What's the canonical channel field?"
  expected_answer_contains: "Finance_View__c"
  expected_answer_not_contains: "new_mapping"
  tool: resolve_term or get_rule
  source_doc: bq-patterns.md rule 7

- question: "What's the difference between cohort and period mode?"
  expected: "Cohort anchors denominator on entry date. Period uses same time window for both. Cohort can't exceed 100%. Period can."
  tool: get_metric
  source_doc: bq-patterns.md cohort vs period section

- question: "Can I add Underwritten_AUM__c and Amount?"
  expected: "No — always COALESCE, never add. They represent the same value."
  tool: get_rule
  source_doc: bq-patterns.md rule 4
```

### From `bq-field-dictionary.md`

```yaml
- question: "Is converted_date_raw a DATE or TIMESTAMP?"
  expected: "DATE"
  tool: describe_view or get_field_info
  source_doc: bq-field-dictionary.md date fields

- question: "What is FilterDate?"
  expected_answer_contains: ["COALESCE", "funnel entry", "TIMESTAMP"]
  expected_answer_not_contains: "calendar filter"
  tool: describe_view
  source_doc: bq-field-dictionary.md FilterDate section

- question: "What's the difference between is_primary_opp_record and is_sqo_unique?"
  expected: "is_primary_opp_record is for AUM aggregation. is_sqo_unique is for volume counts."
  tool: describe_view
  source_doc: bq-field-dictionary.md dedup flags

- question: "What does eligible_for_sql_conversions mean?"
  expected_answer_contains: ["resolved", "became SQO or closed lost"]
  tool: describe_view or get_metric
  source_doc: bq-field-dictionary.md eligibility flags
```

### From `bq-activity-layer.md`

```yaml
- question: "Should I use task_who_id or Full_prospect_id__c to join activities to leads?"
  expected: "Full_prospect_id__c — task_who_id misses activities logged against the Opportunity"
  tool: describe_view
  source_doc: bq-activity-layer.md task linkage

- question: "For SGA effort measurement, should I group by task_executor_name or SGA_Owner_Name__c?"
  expected: "task_executor_name for individual effort. SGA_Owner_Name__c for lead-level metrics."
  tool: get_rule or describe_view
  source_doc: bq-activity-layer.md attribution

- question: "What filters exclude automated outbound activity?"
  expected_answer_contains: ["is_engagement_tracking = 0", "lemlist", "ListEmail"]
  tool: get_rule
  source_doc: bq-activity-layer.md automation exclusion

- question: "What's the difference between is_cold_call and is_true_cold_call?"
  expected: "is_true_cold_call is the strict definition — first outbound call, pre-MQL or re-engagement, not on scheduled date"
  tool: describe_view
  source_doc: bq-activity-layer.md quality signals
```

### From `bq-salesforce-mapping.md`

```yaml
- question: "What is SGA__c on the Opportunity object?"
  expected: "A User ID, not a name. Must join to User table to resolve the name."
  tool: describe_view or resolve_term
  source_doc: bq-salesforce-mapping.md gotcha 1

- question: "How stale can OpportunityFieldHistory be?"
  expected: "Up to 7 days — it's on a weekly sync, separate from the 6-hour cycle"
  tool: describe_view or get_rule
  source_doc: bq-salesforce-mapping.md sync cadence

- question: "Does Finance_View__c come from Lead or Opportunity?"
  expected: "Both — the view COALESCEs Opp first, then Lead. Opp value wins."
  tool: describe_view
  source_doc: bq-salesforce-mapping.md gotcha 9

- question: "Is Marketing_Segment__c the same as Lead_Score_Tier__c?"
  expected: "No — completely different systems. Marketing_Segment is FinTrx firm-type. Lead_Score_Tier is V4 XGBoost scoring."
  tool: resolve_term
  source_doc: bq-salesforce-mapping.md gotcha 11
```

### From `bq-views.md`

```yaml
- question: "What is the single source of truth for funnel metrics?"
  expected: "vw_funnel_master"
  tool: describe_view or list_views
  source_doc: bq-views.md

- question: "Which view should I use for pipeline forecasting?"
  expected: "vw_forecast_p2"
  tool: list_views or describe_view
  source_doc: bq-views.md

- question: "Is new_mapping still used?"
  expected_answer_contains: ["deprecated", "Finance_View__c"]
  tool: get_rule
  source_doc: bq-views.md raw tables section
```

---

## Track C: Workflow Replacement

Full agent workflows that currently depend on the `.claude/` docs. The MCP must support equivalent output quality.

### C1: Data Analysis Plan

```yaml
id: workflow-data-analysis
workflow: /data-analysis
request: "For QTD, what is the average number of initial calls per week for active SGAs?"
validation:
  - agent identifies correct view (vw_sga_activity_performance or vw_funnel_master)
  - agent resolves "active SGA" to correct filter logic
  - agent resolves "initial call" to correct field
  - agent uses correct date range logic
  - analysis plan includes methodology and rationale
  - SQL passes Track A-style pattern checks
compare_to: "Run same request with .claude/ docs present and diff output quality"
```

### C2: Feature Exploration

```yaml
id: workflow-feature-explore
workflow: /auto-feature explore
request: "Add a new metric to SGA Hub showing average touches before lead closes"
validation:
  - agent identifies vw_sga_activity_performance as source
  - agent identifies vw_funnel_master for close status
  - agent identifies correct join key (Full_prospect_id__c)
  - agent identifies outbound filters needed
  - agent identifies lead_closed_date and Disposition__c
  - agent correctly notes which dispositions are SGA-controllable
compare_to: "Run same request with .claude/ docs present and diff output quality"
```

### C3: Semantic Layer Question

```yaml
id: workflow-explore-query
workflow: Explore / semantic layer
request: "Show me SQO conversion rate by channel for Q4 2025 in cohort mode"
validation:
  - agent selects cohort mode (not period)
  - agent uses correct progression/eligibility flags
  - agent uses correct date anchor (converted_date_raw for SQL entry)
  - agent groups by Channel_Grouping_Name (not new_mapping)
  - agent does not apply recordtypeid (eligibility flags handle it)
compare_to: "Run same request with .claude/ docs present and diff output quality"
```

### C4: Ad Hoc Investigation

```yaml
id: workflow-adhoc
workflow: Claude Code session
request: "Why do some contacted leads show zero outbound touchpoints?"
validation:
  - agent identifies the ghost contact issue (1,656 leads in Q1 2026)
  - agent identifies probable causes (untracked channels, manual stage advancement)
  - agent queries vw_sga_activity_performance with correct outbound filters
  - agent joins on Full_prospect_id__c, not task_who_id
  - agent notes is_contacted = 1 from funnel master
compare_to: "Run same request with .claude/ docs present and diff output quality"
```

---

## Negative Controls

Tests where the agent must NOT apply a rule that would otherwise seem correct.

```yaml
- id: neg-prospect-no-recordtype
  request: "Count prospects by channel for Q1 2026"
  must_not_contain: "recordtypeid"
  reason: "Lead-level metrics include re-engagement. No recordtypeid filter."

- id: neg-aum-uses-primary-opp
  request: "Total AUM for open pipeline"
  must_contain: "is_primary_opp_record"
  must_not_treat_as_error: "is_primary_opp_record"
  reason: "AUM aggregation is the one case where is_primary_opp_record is correct"

- id: neg-effort-uses-executor
  request: "Calls per SGA per week"
  must_contain: "task_executor_name"
  must_not_contain_for_grouping: "SGA_Owner_Name__c"
  reason: "Individual effort measurement uses executor, not lead owner"

- id: neg-closedate-legitimate
  request: "Show me the CloseDate field from the Opportunity table"
  must_not_error: true
  reason: "CloseDate is unreliable for closed-lost dating, but asking about the field itself is legitimate"

- id: neg-cohort-no-recordtype
  request: "SQL-to-SQO conversion rate in cohort mode"
  must_not_require: "recordtypeid"
  reason: "Eligibility flags already handle record type filtering internally"
```

---

## Failure Attribution

Every failure is categorized so iteration targets the right fix:

| Category | Meaning | Fix | Example |
|---|---|---|---|
| `config_gap` | Knowledge missing from config | Add annotation or rule | `is_true_cold_call` not annotated |
| `surfacing_failure` | Knowledge in config but not returned by tool | Adjust intent routing, severity, or dangerous_columns list | `sga_dual_attribution` exists but `describe_view` with intent `sga_attribution` didn't surface it |
| `evaluator_strict` | Evaluator flagged something acceptable | Relax test case pattern or add `without` clause | Agent used `WHERE is_sqo_unique = 1 AND is_sqo = 1` — technically has `is_sqo` but it's not wrong |
| `agent_reasoning` | Agent had sufficient context but reasoned poorly | Not a config problem — note and move on | Agent called `describe_view`, saw the warning, but ignored it |

---

## Scoring

### Per-Case Score

```
required_checks:  [{pattern, status: pass|fail, note}]
banned_checks:    [{pattern, status: pass|fail, note}]
negative_checks:  [{control, status: pass|fail, note}]
semantic_score:   pass | partial | fail
knowledge_score:  pass | partial | fail  (Track B only)
overall:          pass | partial | fail
failure_category: config_gap | surfacing_failure | evaluator_strict | agent_reasoning | null
gaps:             [list of specific config additions needed]
```

### Suite Summary

```
Test Run: 2026-04-08
MCP Config Version: 0.2.0

Track A — SQL Correctness:
  count-sqos-by-channel:     PASS (5/5)
  count-joined:              PASS (4/4)
  sga-outbound-effort:       PARTIAL — missed lemlist    [config_gap]
  open-pipeline-aum:         PASS (6/6)
  sql-to-sqo-cohort:         FAIL — period mode logic    [config_gap]
  prospect-count-reeng:      PASS (3/3)
  sga-sqo-attribution:       FAIL — single attribution   [surfacing_failure]
  touchpoints-per-cohort:    PARTIAL — no date alignment  [config_gap]
  pipeline-forecast:         PASS (3/3)
  true-cold-calls:           PARTIAL — wrong cold call    [config_gap]

Track B — Knowledge Retrieval:
  18/22 golden assertions passed
  Failures:
    - "is_true_cold_call vs is_cold_call" — not in config         [config_gap]
    - "OpportunityFieldHistory staleness" — not surfaced           [config_gap]
    - "Finance_View__c precedence (opp wins)" — not in config      [config_gap]
    - "eligible_for_sql_conversions definition" — too vague         [surfacing_failure]

Track C — Workflow Replacement:
  data-analysis:     PARTIAL — correct view, missed outbound filter detail
  feature-explore:   PASS — identified all dependencies
  explore-query:     FAIL — used period mode
  adhoc-ghost:       PARTIAL — found issue, missed probable causes

Negative Controls: 4/5 passed
  FAIL: neg-aum-uses-primary-opp — agent flagged is_primary_opp_record as error

Overall: 5 PASS, 5 PARTIAL, 4 FAIL
Config gaps to fix: 6
Surfacing failures to fix: 2

Priority fixes:
  1. Add cohort mode metric definitions (sql_to_sqo, sqo_to_joined)
  2. Annotate is_true_cold_call with use_instead_of
  3. Add OpportunityFieldHistory staleness note to view annotation
  4. Add Finance_View__c opp-wins-over-lead precedence note
  5. Add sga_dual_attribution to describe_view intent: sga_attribution
  6. Add lemlist detail to sga_outbound_filters rule
```

---

## Repair Suggestions

After scoring and failure attribution, the evaluator must emit structured repair suggestions for every non-passing case. Each suggestion targets a specific fix action.

### Required output format

```yaml
repairs:
  - case: sql-to-sqo-cohort
    category: config_gap
    action: add_metric_definition
    target: sql_to_sqo conversion (cohort mode)
    detail: "Add cohort mode metric with progression flag sql_to_sqo_progression and denominator eligible_for_sql_conversions"

  - case: sga-sqo-attribution
    category: surfacing_failure
    action: strengthen_intent_surfacing
    target: describe_view intent routing for sga_attribution
    detail: "describe_view with intent sga_attribution must surface sga_dual_attribution rule"

  - case: true-cold-calls
    category: config_gap
    action: add_field_annotation
    target: is_true_cold_call
    detail: "Annotate is_true_cold_call with use_instead_of: is_cold_call and definition"

  - case: neg-aum-uses-primary-opp
    category: surfacing_failure
    action: add_dangerous_column
    target: is_primary_opp_record
    detail: "Mark is_primary_opp_record as context-dependent; correct for AUM, wrong for volume"

  - case: sga-outbound-effort
    category: config_gap
    action: add_rule
    target: sga_outbound_filters
    detail: "Add lemlist and ListEmail to the automation exclusion rule"
```

### Valid action types

| Action | When to use |
|---|---|
| `add_field_annotation` | Field exists in warehouse but lacks business context or type info in config |
| `add_rule` | A query pattern rule is missing entirely |
| `strengthen_intent_surfacing` | Rule exists but `describe_view` doesn't return it for the relevant intent |
| `add_dangerous_column` | A column is misused in a common way that should trigger a warning |
| `add_metric_definition` | A named metric (conversion rate, cohort calculation) is not defined |
| `relax_evaluator` | Evaluator flagged acceptable SQL — adjust the test case, not the config |

Do not emit repair suggestions for `agent_reasoning` failures — those are not config problems.

---

## Human Review Output

Every eval run must produce two outputs: a technical report for the repair loop and a business review summary for human reviewers.

### A. Technical Report

For builders and the repair loop. This is the existing eval output:

- Required checks, banned checks, negative controls (pass/fail per pattern)
- Failure attribution per case (`config_gap`, `surfacing_failure`, `evaluator_strict`, `agent_reasoning`)
- Repair suggestions with exact rule, field, and tool names
- Per-case and suite-level scoring

This report drives the iteration loop. Its audience is the developer running the eval.

### B. Business Review Summary

For human reviewers who understand the business logic but may not read SQL or YAML daily. This summary must be produced alongside the technical report — not instead of it.

The business review summary describes:

- What question the agent was trying to answer
- Whether the answer was broadly correct
- What business rule it missed and why that rule matters
- What would go wrong in practice if this shipped as-is
- What fix is being proposed
- Whether human judgment is needed before proceeding

Business review output should:

- Describe failures in business terms first, then technical root causes second
- Avoid unnecessary SQL jargon when a plain-English explanation is possible
- Use field names and rule names only when the reviewer needs them to make a decision

### Per-Case Review Summary

Every non-passing or ambiguous case must include a `review_summary` block in plain English. This block is required in addition to the technical score — not instead of it.

```yaml
review_summary:
  case: "SQL-to-SQO conversion rate (cohort mode)"
  verdict: "FAIL — used the wrong calculation method"
  business_impact: >
    The agent calculated conversion rate using the period method instead of the
    cohort method. This would overcount conversions for recent quarters and could
    show rates above 100%, which is misleading in pipeline reviews.
  plain_english_miss: >
    When asked for a cohort conversion rate, the agent should anchor on when leads
    entered the SQL stage, not when they became SQOs. It used the wrong anchor date
    and the wrong counting approach.
  recommended_fix: >
    Add cohort-mode metric definitions to the config so the MCP tells the agent
    which flags and dates to use for cohort calculations.
  needs_human_decision: false
```

When human judgment is required, add a `decision_needed` field:

```yaml
review_summary:
  case: "SGA attribution on opp-level SQO count"
  verdict: "FAIL — only checked one attribution path"
  business_impact: >
    The agent attributed SQOs using only the lead-level SGA field, missing cases
    where the SGA is assigned at the opportunity level. This would undercount SQOs
    for SGAs who work deals directly, affecting comp and performance reviews.
  plain_english_miss: >
    SGA credit can come from the lead path or the opportunity path. The agent only
    checked one. This is a known dual-attribution rule.
  recommended_fix: >
    Strengthen intent routing so describe_view surfaces the dual-attribution rule
    when the agent's intent involves SGA performance.
  needs_human_decision: true
  decision_needed: >
    The dual-attribution rule (check both SGA_Owner_Name__c and Opp_SGA_Name__c)
    is critical for comp accuracy. Please confirm this is still the correct logic
    before we encode it as a hard rule.
```

### Suite-Level Business Summary

Every final suite report must include a plain-English section summarizing the overall state for business reviewers. This section sits alongside the technical suite summary, not in place of it.

```
Business Review — 2026-04-08

What's working:
  The MCP correctly handles the most common queries — SQO counts, joined
  counts, pipeline AUM, and forecast lookups all pass. The agent gets the
  right dedup flags, date types, and view selections for these cases.

What's still failing:
  Two areas need work before promotion:
  1. Cohort conversion rates — the agent doesn't know how to distinguish
     cohort mode from period mode, so it uses the wrong calculation method.
     This would produce misleading conversion numbers in pipeline reviews.
  2. SGA attribution — the agent only checks one of two attribution paths,
     which would undercount individual SGA performance.

Risk level:
  MEDIUM — the failures affect specific metric types (conversion rates,
  SGA attribution), not the core volume and pipeline queries. However,
  these metrics are used in comp reviews and board reporting, so they
  must be correct before promotion.

Rollout recommendation:
  NOT SAFE TO PROMOTE — two config fixes are needed (cohort metric
  definitions, dual-attribution surfacing). Safe to continue hardening.
  Estimate one more iteration.

What a reviewer should focus on:
  1. Review the cohort vs period mode logic — does the proposed fix match
     how the team actually calculates conversion rates?
  2. Confirm the dual-attribution rule — is checking both SGA_Owner_Name__c
     and Opp_SGA_Name__c still the correct approach?
```

Every suite-level business summary must end with a plain-English rollout recommendation, one of: **safe to promote**, **safe to continue hardening**, or **not safe to promote**. This gives non-technical reviewers a clear decision point without requiring them to interpret the technical report.

This is not a self-healing system. The business summary exists so that a human reviewer — someone who knows the business rules but may not read YAML configs — can assess whether the MCP is ready for promotion and flag anything the eval loop can't catch on its own.

---

## Anti-Overfitting

The eval loop must demonstrate generalization, not memorization.

- **Track A alone is insufficient.** Passing SQL pattern checks proves the config contains the right rules, but not that the MCP surfaces them in realistic workflows. All three tracks must pass.
- **Numeric goldens belong in test fixtures, not in the semantic config.** If a known-correct number (e.g., "Q1 SQO count = 347") appears in `schema-config.yaml`, the MCP is leaking test answers into its context. Golden values live in `tests/fixtures/` only.
- **Track B, Track C, negative controls, and at least one net-new analysis are required** before any suite run counts as a pass. Skipping these tracks masks overfitting to Track A patterns.
- **Watch for config churn that only helps eval cases.** If a config change fixes one test case but has no general value (e.g., adding a rule that only applies to the exact phrasing of a test prompt), it is overfitting. The config should encode warehouse knowledge, not test-case answers.

---

## Iteration Loop

```
Run full suite
    │
    ▼
Identify failures → categorize (config_gap / surfacing / evaluator / agent)
    │
    ▼
Fix config gaps: claude "Add these annotations to schema-config.yaml: [list]"
Fix surfacing:   adjust intent routing, dangerous_columns, rule severity
Fix evaluator:   relax test case patterns
Note agent:      log and move on
    │
    ▼
Re-run ONLY failing tests
    │
    ▼
When all pass → re-run FULL suite (catch regressions)
    │
    ▼
When full suite passes 2x consecutive → MCP is ready
```

---

## Low-Risk Auto-Fix Boundary

The iteration loop can auto-suggest and generate patches for low-risk changes. Higher-risk changes must remain human-approved before promotion.

**Allowed for automated suggestion / patch generation:**

- Missing field annotations (meaning, type info, dangerous flags)
- Missing rules (ban_pattern, prefer_field, require_filter)
- Stronger intent surfacing (adjusting which rules surface for which intents)
- Dangerous column tagging
- Evaluator strictness relaxation (loosening test patterns)

**Must remain human-approved before promotion:**

- Semantic or business rule changes (altering what a metric means, changing filter logic)
- Metric definition changes (numerator/denominator, mode behavior)
- Rollout to MCP-first mode (archiving legacy docs)
- Any change with production blast radius (codebase changes, pipeline config, shared infra)

Auto-generated patches are suggestions, not commits. The loop proposes; a human disposes.

---

## Execution-Backed Validation (Final Gate)

After all three tracks pass structurally, run a small set of execution-backed checks:

1. **Dry-run compile** — run all Track A reference SQL and generated SQL through BigQuery dry-run. Both must compile without errors.

2. **Golden result check** — for 3 key metrics, compare MCP-generated SQL output against known-correct numbers:
   - Q1 2026 SQO count by channel (known from dashboard)
   - Q1 2026 Joined count (known from dashboard)
   - Q4 2025 SQL-to-SQO cohort conversion rate (known from prior analysis)

3. **Net-new analysis** — run one analysis request that is NOT in the test suite, using only the MCP. Evaluate the SQL manually. This tests generalization, not memorization.

### Golden Result Fixtures

Golden results are fixed historical expected outputs for critical tests. They live in test fixture files (`tests/fixtures/golden-results.yaml`), **not** in the MCP semantic config. The config encodes warehouse knowledge; the fixtures encode known-correct answers for validation.

#### Scalar golden result

```yaml
# tests/fixtures/golden-results.yaml
- id: golden-joined-q1-2026
  description: "Total joined advisors in Q1 2026"
  query_case: count-joined
  expected_value: 127
  tolerance: 0  # exact match
  source: "Dashboard export 2026-04-01"
  last_verified: "2026-04-01"
```

#### Table-shaped golden result

```yaml
- id: golden-sqo-by-channel-q1-2026
  description: "SQO count by channel for Q1 2026"
  query_case: count-sqos-by-channel
  expected_rows:
    - { Channel_Grouping_Name: "Paid Search", sqo_count: 89 }
    - { Channel_Grouping_Name: "Organic",     sqo_count: 64 }
    - { Channel_Grouping_Name: "Referral",    sqo_count: 51 }
    - { Channel_Grouping_Name: "Outbound",    sqo_count: 43 }
  match_mode: exact_set  # all rows must match, order ignored
  source: "Dashboard export 2026-04-01"
  last_verified: "2026-04-01"
```

Golden fixtures should be updated only when the underlying data is known to have changed (e.g., a backfill or schema migration), and each update should note the reason and verification source.

---

## What "Done" Looks Like

- All 10 Track A cases pass
- All Track B golden assertions pass (22/22)
- All Track C workflows produce equivalent-quality output to doc-based runs
- All negative controls pass
- Execution-backed checks confirm correct results
- Zero config gaps across two consecutive full-suite runs
- At least one net-new analysis produces correct SQL with MCP-only context
- The `.claude/bq-*.md` files can be archived without degrading any agent workflow

---

## Promotion Gate

MCP-first rollout happens only after all of the following are satisfied:

1. **Two consecutive full-suite passes** — not partial passes, not just Track A. All three tracks, all negative controls, all golden result checks. Two runs, back to back, no config changes between them.

2. **Execution-backed checks pass** — dry-run compile succeeds for all SQL, and golden result fixtures match within tolerance.

3. **At least one net-new analysis is manually reviewed** — a human reads the SQL and output for an analysis request that was never in the test suite and confirms it is correct. This is the generalization check.

4. **Human reviews the config diff** — a person reviews the full diff between the bootstrap baseline (`v0.1.0-bootstrap`) and the config being promoted. No auto-merge. The reviewer checks for:
   - Rules that only exist to pass specific test cases (overfitting)
   - Missing annotations that the tests didn't catch
   - Anything that contradicts the source docs

5. **Legacy docs archived, not deleted** — after promotion, move the `.claude/bq-*.md` files to `.claude/archive/` (or equivalent). They remain available as reference but are no longer the primary context source. If a regression is found post-promotion, the docs can be restored while the config is repaired.

Do not skip these gates. The cost of a bad rollout (agents producing wrong SQL with no docs to fall back on) is higher than the cost of one more iteration.
