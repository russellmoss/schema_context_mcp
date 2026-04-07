# MCP Tool Specification

Reference for all 7 tools exposed by schema-context-mcp. Every tool response includes `provenance` and `confidence` fields.

---

## 1. describe_view

**The primary tool.** Agents should call this before writing SQL.

**Parameters:**
- `view` (string, required) — view or table name (e.g., `vw_funnel_master`)
- `intent` (string, optional) — what the agent is trying to do (e.g., `count_sqos`, `pipeline_aum`). Surfaces the most relevant warnings upfront.

**Response shape:**
```json
{
  "view": "vw_funnel_master",
  "purpose": "Single source of truth for recruiting funnel",
  "grain": "One row per lead-opportunity combination",
  "intent_warnings": ["Use is_sqo_unique = 1, NOT is_sqo = 1", "Add recordtypeid filter..."],
  "dangerous_columns": [
    { "column": "CloseDate", "reason": "Unreliable...", "use_instead": "Stage_Entered_Closed__c", "provenance": "native_config", "confidence": "high" }
  ],
  "key_filters": {
    "active_sqos": { "sql": "is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'", "provenance": "native_config", "confidence": "high" }
  },
  "annotated_columns": [
    { "name": "is_sqo_unique", "type": "INTEGER", "meaning": "...", "provenance": "native_config", "confidence": "high" }
  ],
  "consumers": ["dashboard/revenue.ts"],
  "recommended_date_fields": [...]
}
```

**Provenance sources:** `live_schema`, `native_config`, `dbt_manifest`, `dbt_meta`, `warehouse_description`, `inferred`
**Confidence logic:** `high` = live schema + human annotation, `medium` = automated source only, `low` = inferred or unconfirmed

**Edge cases:**
- View not found in warehouse → error with list of available views
- View found but no config → return live schema fields with `provenance: "live_schema"`, `confidence: "low"`
- Intent not recognized → return full response without intent_warnings filtering

---

## 2. get_metric

Returns metric definitions with computation logic.

**Parameters:**
- `metric` (string, required) — metric name (e.g., `sql_to_sqo`)
- `mode` (string, optional) — `cohort` or `period`. Changes which fields/logic are returned.

**Response shape:**
```json
{
  "metric": "sql_to_sqo",
  "mode": "cohort",
  "numerator": { "field": "sql_to_sqo_progression", "provenance": "native_config", "confidence": "high" },
  "denominator": { "field": "eligible_for_sql_conversions", "provenance": "native_config", "confidence": "high" },
  "gotcha": "Recent cohorts look low — deals still in flight",
  "rules": ["Use SUM, not COUNTIF for cohort mode"],
  "provenance": "native_config",
  "confidence": "high"
}
```

**Edge cases:**
- Unknown metric → error listing available metrics
- No mode specified → return general definition, note that behavior differs by mode

---

## 3. get_rule

Returns named query rules — validated WHERE clauses, required companions, context patterns.

**Parameters:**
- `rule` (string, required) — rule ID (e.g., `sqo_volume_dedup`, `re_engagement_exclusion`)

**Response shape:**
```json
{
  "id": "sqo_volume_dedup",
  "type": "prefer_field",
  "found": "is_sqo",
  "prefer": "is_sqo_unique",
  "context": "volume counts",
  "severity": "error",
  "message": "Use is_sqo_unique for volume counts",
  "provenance": "native_config",
  "confidence": "high"
}
```

**Rule types:** `ban_pattern`, `prefer_field`, `require_filter`

**Edge cases:**
- Unknown rule → error listing available rules
- Rule references field that no longer exists in warehouse → include drift warning

---

## 4. resolve_term

Domain vocabulary lookup.

**Parameters:**
- `term` (string, required) — business term (e.g., `SQO`, `AUM`, `MQL`)

**Response shape:**
```json
{
  "term": "SQO",
  "definition": "Sales Qualified Opportunity",
  "related_fields": ["is_sqo_unique", "Date_Became_SQO__c", "sqo_stage"],
  "related_rules": ["sqo_volume_dedup", "re_engagement_exclusion"],
  "gotchas": ["Use is_sqo_unique, not is_sqo, for volume counts"],
  "provenance": "native_config",
  "confidence": "high"
}
```

**Edge cases:**
- Unknown term → return empty result with suggestion to check available terms
- Fuzzy matches → return closest matches if exact not found

---

## 5. lint_query

Lightweight heuristic SQL linting. Substring-based, no AST parsing.

**Parameters:**
- `query` (string, required) — SQL query to lint

**Response shape:**
```json
{
  "warnings": [
    {
      "rule_id": "sqo_volume_dedup",
      "type": "prefer_field",
      "severity": "error",
      "message": "Found 'is_sqo' — prefer 'is_sqo_unique' for volume counts",
      "confidence": "medium",
      "provenance": "native_config"
    }
  ],
  "passed": false,
  "note": "Heuristic linting — substring-based, not AST. Treat as guidance."
}
```

**Three rule categories:**
1. `ban_pattern` — substring must NOT appear (severity: error)
2. `prefer_field` — substring found, suggest replacement (severity: error/warning)
3. `require_filter` — if query contains trigger substrings, must also contain required filter (severity: warning)

**Edge cases:**
- Empty query → error
- Query with no violations → `{ warnings: [], passed: true }`
- `prefer_field` match but preferred field also present → skip (not a violation)
- Substring in a comment or string literal → still flagged (substring matching limitation, noted in confidence)

---

## 6. health_check

Detects drift between config and live schema. Config-vs-schema only — no codebase scanning.

**Parameters:** None

**Response shape:**
```json
{
  "unannotated_fields": [
    { "view": "vw_funnel_master", "field": "quarterly_goal_id", "type": "STRING" }
  ],
  "stale_annotations": [
    { "view": "vw_funnel_master", "field": "old_field_name", "reason": "Not found in INFORMATION_SCHEMA" }
  ],
  "config_issues": [
    { "type": "broken_reference", "detail": "Rule 'xyz' references field 'abc' which doesn't exist" }
  ],
  "summary": "2 unannotated fields, 1 stale annotation, 0 broken references",
  "suggestion": "Annotate quarterly_goal_id and sgm_territory"
}
```

**Edge cases:**
- No config file → return all fields as unannotated
- Warehouse unreachable → error with connection details
- All fields annotated, no drift → clean health report

---

## 7. list_views

Discovers all views and tables. Flags annotation status.

**Parameters:**
- `dataset` (string, optional) — filter to a specific dataset

**Response shape:**
```json
{
  "views": [
    { "name": "vw_funnel_master", "dataset": "Tableau_Views", "type": "VIEW", "annotated": true, "column_count": 88 },
    { "name": "vw_forecast_p2", "dataset": "Tableau_Views", "type": "VIEW", "annotated": false, "column_count": 24 }
  ],
  "total": 2,
  "annotated": 1
}
```

**Edge cases:**
- No views found → empty list
- Dataset not found → error listing available datasets
