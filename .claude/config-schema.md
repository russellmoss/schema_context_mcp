# Config Schema Reference

The native config (`schema-config.yaml`) is the primary project-specific configuration. It encodes business knowledge that can't be inferred from schema alone and that dbt doesn't capture.

---

## Top-Level Sections

```yaml
connection:    # Required — warehouse connection
dbt:           # Optional — dbt artifact paths
fields:        # Optional — field-level annotations
views:         # Optional — view-level annotations
rules:         # Optional — query rules (typed primitives)
terms:         # Optional — domain vocabulary
metrics:       # Optional — metric definitions
```

---

## connection

```yaml
connection:
  connector: bigquery          # Required. v1: "bigquery" only
  project: savvy-gtm-analytics # Required. GCP project ID
  datasets:                    # Required. List of datasets to scan
    - Tableau_Views
  key_file: ./path/to/sa.json  # Optional. Falls back to GOOGLE_APPLICATION_CREDENTIALS env var
```

---

## dbt

```yaml
dbt:
  manifest_path: ./target/manifest.json            # Optional
  semantic_manifest_path: ./target/semantic_manifest.json  # Optional
```

When present, dbt descriptions and meta are merged with native config at response time. Resolution priority: native config > dbt meta > dbt description > warehouse description.

---

## fields

Per-field annotations. Keys are field names (case-sensitive as they appear in BigQuery).

```yaml
fields:
  is_sqo_unique:
    meaning: "Dedup flag for SQO volume counts — 1 means first qualifying opp"
    type: INTEGER                    # Optional — for documentation, live schema is authoritative
    use_instead_of: "is_sqo"         # Optional — "use this, not that" guidance
    gotcha: "is_sqo includes dupes"  # Optional — warning text

  CloseDate:
    meaning: "Unreliable close date from Salesforce"
    use_instead_of: "Stage_Entered_Closed__c"
    gotcha: "Updated by reps inconsistently. Use Stage_Entered_Closed__c for closed-lost dating."

  FilterDate:
    meaning: "COALESCE of funnel entry dates. TIMESTAMP type."
    type: TIMESTAMP
    gotcha: "Not a calendar filter — it's the lead's entry point into the funnel"
```

---

## views

Per-view annotations. Keys are view names.

```yaml
views:
  vw_funnel_master:
    purpose: "Single source of truth for recruiting funnel metrics"
    grain: "One row per lead-opportunity combination"
    key_filters:
      active_sqos: "is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'"
      open_pipeline: "StageName NOT IN ('Closed Lost', 'Joined', 'On Hold', 'Signed')"
    dangerous_columns:
      - CloseDate
      - is_sqo
      - is_primary_opp_record
    consumers:
      - "dashboard/funnel-metrics.ts"
      - "reports/weekly-pipeline.ts"
    recommended_date_fields:
      sqo_date: "Date_Became_SQO__c (TIMESTAMP)"
      joined_date: "advisor_join_date__c (DATE)"
      entry_date: "FilterDate (TIMESTAMP)"
```

---

## rules

Typed rule primitives. Each rule has a `type` that determines its schema.

### ban_pattern
Substring that must never appear in queries.

```yaml
- id: no_new_mapping
  type: ban_pattern
  pattern: "new_mapping"
  severity: error
  message: "Deprecated. Use Channel_Grouping_Name or Finance_View__c directly."
```

### prefer_field
"You used X, consider Y" substitution.

```yaml
- id: sqo_volume_dedup
  type: prefer_field
  found: "is_sqo"
  prefer: "is_sqo_unique"
  context: "volume counts"
  severity: error
  message: "Use is_sqo_unique for SQO volume counts"
```

### require_filter
"You queried X without Y" companion filter.

```yaml
- id: re_engagement_exclusion
  type: require_filter
  when_contains:
    - "is_sqo"
    - "is_joined"
  required: "recordtypeid = '012Dn000000mrO3IAI'"
  severity: warning
  message: "Add recordtypeid filter to exclude re-engagement opportunities"
```

### Rule fields
- `id` (string, required) — unique identifier, referenced by eval test cases
- `type` (enum, required) — `ban_pattern` | `prefer_field` | `require_filter`
- `severity` (enum, required) — `error` | `warning`
- `message` (string, required) — human-readable explanation
- `pattern` / `found` / `when_contains` — type-specific trigger field
- `prefer` / `required` — type-specific resolution field
- `context` (string, optional) — when this rule applies

---

## terms

Domain vocabulary. Simple key-value with optional metadata.

```yaml
terms:
  SQO:
    definition: "Sales Qualified Opportunity"
    related_fields: [is_sqo_unique, Date_Became_SQO__c]
    related_rules: [sqo_volume_dedup, re_engagement_exclusion]
  AUM:
    definition: "Assets Under Management"
    related_fields: [Underwritten_AUM__c, Amount]
    gotcha: "Always COALESCE(Underwritten_AUM__c, Amount) — never add them"
```

Simple form (definition only):
```yaml
terms:
  SQO: "Sales Qualified Opportunity"
  AUM: "Assets Under Management"
```

---

## metrics

Metric definitions with computation logic and mode-specific behavior.

```yaml
metrics:
  sql_to_sqo:
    description: "Conversion rate from SQL to SQO stage"
    modes:
      cohort:
        numerator: sql_to_sqo_progression
        denominator: eligible_for_sql_conversions
        anchor_date: converted_date_raw
        gotcha: "Recent cohorts look low — deals still in flight"
      period:
        numerator_logic: "COUNT WHERE Date_Became_SQO__c in period"
        denominator_logic: "COUNT WHERE converted_date_raw in period"
        gotcha: "Can exceed 100% — numerator and denominator use different date anchors"
```
