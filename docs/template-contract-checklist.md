# Template Contract Checklist — Frozen

> **Status:** FROZEN. This document defines the authoritative YAML shapes for all template artifacts.
> If a later phase needs to change a contract, it must update this checklist first and document the reason.

---

## schema-config.template.yaml

### Top-level keys

| Key | Required | Type | Description |
|---|---|---|---|
| `connection` | Yes | object | Warehouse connection settings |
| `views` | Yes | object | View annotations (keyed by view name) |
| `fields` | Yes | object | Field annotations (keyed by field name) |
| `rules` | Yes | array | Typed rule primitives |
| `terms` | Yes | object | Business vocabulary (keyed by term name) |
| `metrics` | Yes | object | Metric definitions (keyed by metric name) |

### connection

| Key | Required | Type | Constraint |
|---|---|---|---|
| `connector` | Yes | string | Must be `'bigquery'` in v1 |
| `project` | Yes | string | GCP project ID |
| `datasets` | Yes | array of string | At least one entry |
| `key_file` | No | string | Path to service account JSON |

### views[name]

| Key | Required | Type | Description |
|---|---|---|---|
| `purpose` | Yes | string | One-sentence description |
| `grain` | Yes | string | "One row per <entity>" |
| `key_filters` | No | object | Named SQL WHERE clauses |
| `key_filters[name].sql` | Yes (if key_filters) | string | SQL expression |
| `dangerous_columns` | No | array | Safety-critical columns |
| `dangerous_columns[].column` | Yes | string | Column name |
| `dangerous_columns[].reason` | Yes | string | Why it's dangerous |
| `dangerous_columns[].use_instead` | No | string | Preferred alternative |
| `consumers` | No | array of string | Dashboards/files using this view |
| `recommended_date_fields` | No | object | Date field names + types |
| `freshness_notes` | No | string | Data freshness description |
| `notes` | No | string | Additional context |
| `known_issues` | No | array of string | Known data quality issues |
| `status` | No | string | e.g., `"base_table"` |

### fields[name]

| Key | Required | Type | Description |
|---|---|---|---|
| `meaning` | Yes | string | What this field represents |
| `type` | No | string | BigQuery data type |
| `gotcha` | No | string | Common mistake |
| `use_instead_of` | No | string | Less-preferred field this replaces |

### rules[] (array items)

All rules require:

| Key | Required | Type | Constraint |
|---|---|---|---|
| `id` | Yes | string | Unique rule identifier |
| `type` | Yes | string | One of: `ban_pattern`, `prefer_field`, `require_filter`, `date_type_rule` |
| `severity` | Yes | string | One of: `error`, `warning`, `info` |
| `message` | Yes | string | Human-readable explanation |

Type-specific fields:

**ban_pattern:**

| Key | Required | Type |
|---|---|---|
| `pattern` | Yes | string |

**prefer_field:**

| Key | Required | Type |
|---|---|---|
| `found` | Yes | string |
| `prefer` | Yes | string |
| `context` | Yes | string |

**require_filter:**

| Key | Required | Type |
|---|---|---|
| `when_contains` | Yes | array of string (non-empty) |
| `required` | Yes | string |

**date_type_rule:**

| Key | Required | Type |
|---|---|---|
| `field` | Yes | string |
| `expected_type` | Yes | string |
| `wrong_wrapper` | No | string |
| `correct_wrapper` | No | string |

### terms[name]

| Key | Required | Type | Description |
|---|---|---|---|
| `definition` | Yes | string | What the term means |
| `related_fields` | No | array of string | Field names related to this term |
| `related_rules` | No | array of string | Rule IDs related to this term |
| `gotcha` | No | string | Common confusion |

### metrics[name]

| Key | Required | Type | Description |
|---|---|---|---|
| `description` | Yes | string | What this metric measures |
| `modes` | Yes | object | At least one of `period` or `cohort` |

**modes.period:**

| Key | Required | Type |
|---|---|---|
| `numerator` | Yes | string |
| `denominator` | Yes | string |
| `numerator_logic` | No | string |
| `denominator_logic` | No | string |
| `gotcha` | No | string |

**modes.cohort:**

| Key | Required | Type |
|---|---|---|
| `numerator` | Yes | string |
| `denominator` | Yes | string |
| `anchor_date` | Yes | string |
| `gotcha` | No | string |

---

## Track A Case (track-a.template.yaml)

| Key | Required | Type | Constraint |
|---|---|---|---|
| `id` | Yes | string | Unique, convention: `<team>-a<N>-<desc>` |
| `request` | Yes | string | Natural language question |
| `difficulty` | Yes | string | `basic`, `intermediate`, or `advanced` |
| `category` | Yes | string | Test category name |
| `required_patterns` | At least one of required/banned | array | Patterns that must appear |
| `required_patterns[].pattern` | Yes | string | Substring to match |
| `required_patterns[].rule` | Yes | string | Config rule ID |
| `required_patterns[].reason` | Yes | string | Why required |
| `banned_patterns` | At least one of required/banned | array | Patterns that must not appear |
| `banned_patterns[].pattern` | Yes | string | Substring to match |
| `banned_patterns[].without` | No | string | Exception clause |
| `banned_patterns[].rule` | Yes | string | Config rule ID |
| `banned_patterns[].reason` | Yes | string | Why banned |
| `reference_sql` | Yes | string | Human-authored correct SQL |
| `expected_tool_calls` | No | array | Metadata for reviewers |

---

## Track B Case (track-b.template.yaml)

| Key | Required | Type | Constraint |
|---|---|---|---|
| `id` | Yes | string | Unique, convention: `<team>-b<N>-<desc>` |
| `request` | Yes | string | Business question |
| `difficulty` | Yes | string | `basic`, `intermediate`, or `advanced` |
| `category` | Yes | string | Test category name |
| `knowledge_assertions` | Yes | array | At least one assertion |
| `knowledge_assertions[].question` | Yes | string | Specific question |
| `knowledge_assertions[].expected` | Yes | string | Substring that must appear in response |
| `knowledge_assertions[].tool` | Yes | string | `describe_view`, `get_rule`, `resolve_term`, or `get_metric` |

---

## Track C Case (track-c.template.yaml)

| Key | Required | Type | Constraint |
|---|---|---|---|
| `id` | Yes | string | Unique, convention: `<team>-c<N>-<desc>` |
| `request` | Yes | string | Realistic multi-step question |
| `difficulty` | Yes | string | Always `advanced` |
| `category` | Yes | string | Workflow category |
| `required_patterns` | No | array | Same shape as Track A |
| `knowledge_assertions` | No | array | Same shape as Track B |
| `reference_sql` | No | string | Optional partial reference |

At least one of `required_patterns` or `knowledge_assertions` is required.

---

## Negative Controls (negative-controls.template.yaml)

| Key | Required | Type | Constraint |
|---|---|---|---|
| `id` | Yes | string | Unique, convention: `neg-<desc>` |
| `request` | Yes | string | Natural language question |
| `difficulty` | Yes | string | `basic`, `intermediate`, or `advanced` |
| `category` | Yes | string | Test category name |
| `negative_controls` | No | array | Patterns that must NOT fire |
| `negative_controls[].description` | Yes | string | What the test verifies |
| `negative_controls[].banned_pattern` | Yes | string | Pattern that must not appear |
| `negative_controls[].reason` | Yes | string | Why the rule should not apply |
| `required_patterns` | No | array | Same shape as Track A |
| `reference_sql` | No | string | Correct SQL for context |

At least one of `negative_controls` or `required_patterns` is required.

---

## Validation Rules

1. All `id` fields must be unique across all case files in a suite
2. All `rule` references in patterns must correspond to a valid rule `id` in the config
3. All `tool` references in assertions must be one of: `describe_view`, `get_rule`, `resolve_term`, `get_metric`, `list_views`, `lint_query`, `health_check`
4. `when_contains` arrays in `require_filter` rules must not be empty
5. `prefer_field` rules where `found` equals `prefer` are invalid (self-referential)
