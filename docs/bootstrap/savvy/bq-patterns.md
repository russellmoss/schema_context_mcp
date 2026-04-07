# BigQuery Query Patterns & Gotchas

> **Generated**: 2026-03-29 | **Regenerated with Human-Verified Context**: 2026-03-29
> **Purpose**: Recurring patterns, critical rules, and anti-patterns embedded in the query files.

---

## Critical Rules (Break These and Metrics Break)

1. **Always use `is_sqo_unique = 1` for SQO volume counts, never `is_sqo = 1`**. Multiple leads can convert to the same opportunity. `is_sqo` marks every row; `is_sqo_unique` deduplicates to one count per opp. Same logic for `is_joined_unique` vs `is_joined`.

2. **Always include `recordtypeid = '012Dn000000mrO3IAI'` for SQO and Joined metrics**. Without this filter, Re-Engagement opportunities inflate counts. Lead-level metrics (Prospects, Contacted, MQL, SQL) do NOT require this filter — but re-engagement records ARE included (see Rule 7).

3. **Never use `DATE()` wrapper on TIMESTAMP fields or `TIMESTAMP()` wrapper on DATE fields**. `converted_date_raw` and `advisor_join_date__c` are DATE; everything else is TIMESTAMP. Mismatching causes silent data loss or incorrect comparisons.

4. **AUM is `COALESCE(Underwritten_AUM__c, Amount)` — never add them**. They represent the same value from different sources. Adding them would double-count.

5. **The field `SQL__c` means SQO status, not SQL**. `SQL__c = 'Yes'` means the opportunity is Sales Qualified (SQO). This is a legacy Salesforce naming issue.

6. **Closed Lost advisors with join dates must be excluded from "joined" counts**. An advisor who joined then left has `advisor_join_date__c IS NOT NULL` AND `StageName = 'Closed Lost'`. The view handles this: `is_joined` and `is_joined_unique` both check `StageName != 'Closed Lost'`.

7. **Always use `Finance_View__c` for channel grouping. The `new_mapping` JOIN pattern is DEPRECATED.** `Finance_View__c` (from Salesforce) is the canonical source of truth. The view computes `Channel_Grouping_Name` inline from it. Some legacy query files (`drill-down.ts`, `record-detail.ts`, `quarterly-progress.ts`) still JOIN to `SavvyGTMData.new_mapping` — these are pending migration. **Do not propagate this pattern to new queries.** `Cohort_source` is a source-level field, not a channel field.

8. **Re-engagement records ARE in lead-level metrics.** Prospects, Contacted, MQLs, and SQLs include re-engagement records. They are only excluded from SQO/Signed/Joined by the `recordtypeid` filter. To exclude re-engagement from lead-level counts, filter: `lead_record_source = 'Lead'`. To query re-engagement only: `lead_record_source = 'Re-Engagement'`.

---

## Date Handling

### DATE vs TIMESTAMP Fields

| Type | Fields | Query Wrapper | Example |
|------|--------|---------------|---------|
| **DATE** | `converted_date_raw`, `advisor_join_date__c`, `Qualification_Call_Date__c`, `Initial_Call_Scheduled_Date__c`, `Earliest_Anticipated_Start_Date__c` | `DATE(field) >= DATE(@startDate)` | `DATE(v.converted_date_raw) >= DATE(@startDate)` |
| **TIMESTAMP** | `FilterDate`, `stage_entered_contacting__c`, `mql_stage_entered_ts`, `Date_Became_SQO__c`, all `Stage_Entered_*__c`, `lead_closed_date`, `CreatedDate`, `Opp_CreatedDate` | `TIMESTAMP(field) >= TIMESTAMP(@startDate)` | `TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)` |

### The startDate/startDateTimestamp Pattern

Some queries that filter on both DATE and TIMESTAMP fields pass two params:
- `@startDate` / `@endDate` — used with `DATE()` wrapper
- `@startDateTimestamp` / `@endDateTimestamp` — used with `TIMESTAMP()` wrapper (often just `TIMESTAMP(@startDate)`)

In practice, most queries just use `@startDate` with both wrappers: `DATE(@startDate)` and `TIMESTAMP(@startDate)`. BigQuery implicitly casts.

### End Date Inclusive Pattern

Many queries append `' 23:59:59'` to the end date for TIMESTAMP comparisons:
```sql
TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
```
This ensures the entire last day is included. Some queries use `<=` with the date directly, which works for DATE fields but may miss records on the last day for TIMESTAMP fields.

---

## Deduplication

### When to Use Each Flag

| Scenario | Flag | Why |
|----------|------|-----|
| Counting SQOs for scorecard | `is_sqo_unique = 1` | One count per opportunity |
| Counting Joined for scorecard | `is_joined_unique = 1` | One count per opportunity |
| SQO→Joined conversion rate | `sqo_to_joined_progression` / `eligible_for_sqo_conversions` | Pre-computed per-record flags |
| Open pipeline AUM total | `is_primary_opp_record = 1` in CASE, `is_sqo_unique = 1` in WHERE | AUM dedup + SQO filter |
| Signed stage count | `is_primary_opp_record = 1` or `is_sqo_unique = 1` | Dedup at opp level |
| Detail record drill-down | Often no dedup flag — shows all lead→opp rows | Shows full history |

### The `opp_row_num` Mechanism

```sql
ROW_NUMBER() OVER (
  PARTITION BY Full_Opportunity_ID__c
  ORDER BY CreatedDate ASC NULLS LAST
) AS opp_row_num
```
When multiple leads convert to the same opportunity, `opp_row_num = 1` picks the earliest lead. This drives `is_primary_opp_record`, `is_sqo_unique`, and `is_joined_unique`.

---

## Channel/Source Mapping

### Canonical Pattern: `Finance_View__c`

**`Finance_View__c`** (direct from Salesforce) is the canonical source of truth for channel grouping. The `vw_funnel_master` view computes `Channel_Grouping_Name` inline:

```sql
CASE IFNULL(Finance_View__c, 'Other')
  WHEN 'Partnerships' THEN 'Recruitment Firm'
  WHEN 'Job Applications' THEN 'Marketing'
  WHEN 'Employee Referral' THEN 'Referral'
  WHEN 'Advisor Referral' THEN 'Referral'
  ELSE IFNULL(Finance_View__c, 'Other')
END AS Channel_Grouping_Name
```

### Deprecated Pattern: `new_mapping` table

Some query files still JOIN to `new_mapping` table:
```sql
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm
  ON v.Original_source = nm.original_source
-- Then use:
COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')
```

Files using this (pending migration): `drill-down.ts`, `record-detail.ts`, `quarterly-progress.ts`.

**For all new queries**: Use `v.Channel_Grouping_Name` directly. Do not JOIN `new_mapping`.

---

## Re-Engagement Records — Inclusion/Exclusion Rules

### How Re-Engagement Records Enter the View

The `ReEngagement_As_Lead` CTE maps re-engagement opportunity stages onto standard lead column aliases, then UNION ALL's them into `All_Leads`. The stage mapping:

| Standard Lead Field | Re-Engagement Analog |
|---------------------|---------------------|
| `stage_entered_contacting__c` | `Stage_Entered_Outreach__c` |
| `mql_stage_entered_ts` | `Stage_Entered_Call_Scheduled__c` |
| `converted_date_raw` | `DATE(Stage_Entered_Re_Engaged__c)` |
| `stage_entered_new__c` | `COALESCE(Stage_Entered_Planned_Nurture__c, CreatedDate)` |

### Two-Tier Filtering

| Metric Level | Re-Engagement Included? | Why |
|-------------|------------------------|-----|
| Prospects, Contacted, MQL, SQL | **YES** | No `recordtypeid` filter on lead-level metrics |
| SQO, Signed, Joined | **NO** | Explicit `recordtypeid = '012Dn000000mrO3IAI'` (Recruiting) excludes them |

### Filtering Re-Engagement In/Out

```sql
-- Exclude re-engagement from lead-level metrics:
WHERE lead_record_source = 'Lead'

-- Query re-engagement only:
WHERE lead_record_source = 'Re-Engagement'

-- Both fields work: lead_record_source and prospect_source_type are aliases
```

---

## SGA/SGM Attribution

### Dual-Attribution Pattern for SGA on Opportunity Metrics

For opportunity-level metrics (SQOs, Joined, AUM), filter on BOTH:
```sql
AND (v.SGA_Owner_Name__c = @sga OR v.Opp_SGA_Name__c = @sga)
```

**Why**: SGA attribution can come from:
1. `SGA_Owner_Name__c` — the SGA who worked the lead (from Lead object)
2. `Opp_SGA_Name__c` — the SGA recorded on the opportunity (from `Opportunity.SGA__c`, which is a User ID resolved via User table)

These can differ when leads are reassigned. The dual filter ensures the SGA gets credit for either path.

### Lead vs Opportunity Attribution

| Metric Level | SGA Field | SGM Field |
|-------------|-----------|-----------|
| Lead (Prospects, Contacted, MQL, SQL) | `SGA_Owner_Name__c` | N/A (no SGM on leads) |
| Opportunity (SQO, Joined, AUM) | `SGA_Owner_Name__c` OR `Opp_SGA_Name__c` | `SGM_Owner_Name__c` |

### SGM Field Origin

`SGM_Owner_Name__c` in the view = `Opportunity.Opportunity_Owner_Name__c` in Salesforce. It's the opportunity owner's name, which is always an SGM for recruiting opps.

---

## ARR/AUM Calculations

### AUM COALESCE Pattern

```sql
COALESCE(v.Underwritten_AUM__c, v.Amount, 0) -- for sums
COALESCE(v.Underwritten_AUM__c, v.Amount)     -- for display (NULL if both NULL)
```

- `Underwritten_AUM__c`: Savvy's underwritten estimate (more accurate, filled later in process)
- `Amount`: Salesforce standard field (filled earlier, sometimes stale)
- **Never add them** — they represent the same value

### ARR COALESCE Pattern (SGM Hub)

```sql
COALESCE(Actual_ARR__c, SGM_Estimated_ARR__c, Account_Total_ARR__c)
```

- `Actual_ARR__c`: Post-join actual revenue (populated after advisor produces)
- `SGM_Estimated_ARR__c`: SGM's pre-join estimate
- `Account_Total_ARR__c`: Account-level ARR from Account table
- UI shows `(est)` when `Actual_ARR__c` is NULL

### Open Pipeline AUM

Open pipeline = SQOs in stages: `['Qualifying', 'Discovery', 'Sales Process', 'Negotiating']` (constant `OPEN_PIPELINE_STAGES`). Excludes: Closed Lost, Joined, On Hold, Signed.

```sql
WHERE v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND v.recordtypeid = @recruitingRecordType
  AND v.is_sqo_unique = 1
-- AUM uses is_primary_opp_record in CASE:
SUM(CASE WHEN v.is_primary_opp_record = 1 THEN v.Opportunity_AUM ELSE 0 END)
```

**Signed stage nuance**: `OPEN_PIPELINE_STAGES` excludes 'Signed', but a signed advisor hasn't joined yet and still represents in-flight AUM. Some analyses (particularly forecasting) may want to include Signed deals as committed-but-not-yet-realized AUM. The constant reflects the default dashboard behavior, not a universal rule.

### AUM Tier Boundaries

**4-tier (funnel/pipeline)**: <$25M, $25M-$75M, $75M-$150M, >$150M
**2-tier (forecast)**: Lower (<$75M) vs Upper (>=$75M) — boundary at `AUM_TIER_BOUNDARY = 75_000_000`

---

## Cohort vs Period Mode

### Period Mode (Activity-Based)
- **Numerator**: Records reaching NEXT stage in the period (filtered by next stage's date)
- **Denominator**: Records reaching CURRENT stage in the period (filtered by current stage's date)
- **Can exceed 100%**: Different populations (a Q1 SQO might join a Q1 lead that became SQL in Q4)

### Cohort Mode (Resolved-Only)
- **Numerator**: `SUM(progression_flag)` for records entering current stage in the period
- **Denominator**: `SUM(eligibility_flag)` for records entering current stage in the period
- **Always 0-100%**: Same population, pre-computed flags

### Canonical Example: SQL→SQO

**Period Mode**:
```sql
-- Numerator: SQOs created in period
COUNTIF(Date_Became_SQO__c IN range AND is_sqo_unique = 1 AND recordtypeid = recruiting)
-- Denominator: SQLs created in period
COUNTIF(converted_date_raw IN range AND is_sql = 1)
```

**Cohort Mode**:
```sql
-- Numerator: Of SQLs from this period, how many became SQO?
SUM(CASE WHEN converted_date_raw IN range THEN sql_to_sqo_progression ELSE 0 END)
-- Denominator: Of SQLs from this period, how many resolved?
SUM(CASE WHEN converted_date_raw IN range THEN eligible_for_sql_conversions ELSE 0 END)
```

Key difference: Cohort mode anchors on the **entry** date into the current stage, not the next stage. The progression/eligibility flags are pre-computed in the view and don't care when the next stage happened.

---

## Record Type Filtering

### When to Filter by Record Type

| Metric | Record Type Filter | Why |
|--------|-------------------|-----|
| Prospects, Contacted, MQL, SQL | **No filter** | Lead-level metrics include all record types (including re-engagement) |
| SQO, Joined, Signed | `recordtypeid = '012Dn000000mrO3IAI'` (Recruiting) | Exclude Re-Engagement opps |
| SQO→Joined conversion | Uses `eligible_for_sqo_conversions` (no explicit filter) | Pre-computed flags already handle this correctly |
| Open Pipeline | `recordtypeid = '012Dn000000mrO3IAI'` | Recruiting pipeline only |
| Closed Lost analysis | Sometimes `RE_ENGAGEMENT_RECORD_TYPE` for re-engagement context | `closed-lost.ts` checks re-engagement opps separately |

### Record Type Constants
```typescript
RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI'
RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC'
```

---

## Forecast-Specific Patterns

### Duration Penalty Pattern

`computeAdjustedDeal()` in `src/lib/forecast-penalties.ts` applies a multiplier to the **current stage rate only** based on how long a deal has been in its current stage:

| Stage | 1 SD Threshold | 2 SD Threshold | 1-2 SD Multiplier | 2+ SD Multiplier |
|-------|---------------|----------------|-------------------|------------------|
| Discovery/Qualifying | 36 days | 64 days | 0.667 | 0.393 |
| Sales Process | 67 days | 105 days | 0.755 | 0.176 |
| Negotiating | 50 days | 81 days | 0.682 | 0.179 |
| Signed | No penalty | No penalty | 1.0 | 1.0 |

Example: A Negotiating deal at 90 days (2+ SD) gets:
```
adjusted_neg_to_signed = neg_to_signed * 0.179
signed_to_joined = unchanged
adjustedPJoin = adjusted_neg_to_signed * signed_to_joined
```

### AUM-Tiered Conversion Rates

The Monte Carlo forecast uses 2-tier AUM bands (Lower <$75M, Upper >=$75M) with separate conversion rates per tier. If a tier has fewer than 15 resolved deals (`TIER_FALLBACK_MIN_COHORT`), it falls back to flat (non-tiered) rates.

### Surprise Baseline (OpportunityFieldHistory PIT)

`forecast-pipeline.ts` queries `OpportunityFieldHistory` to reconstruct point-in-time (PIT) state:
```sql
FROM `savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory` h
```
Used to determine what the pipeline looked like at a prior date, enabling "surprise" detection (deals that appeared or disappeared unexpectedly). **Note**: `OpportunityFieldHistory` is synced weekly (not every 6 hours like core objects), so PIT reconstruction can be up to 7 days stale.

### vw_forecast_p2 Historical Cohort

The view uses resolved SQOs from Jun-Dec 2025 (Joined + Closed Lost only) to compute stage-to-stage conversion rates. Open deals are excluded to avoid deflating rates.

---

## Anti-Patterns (Things That Look Right But Are Wrong)

1. **Using `is_sqo = 1` for volume counts** → Use `is_sqo_unique = 1`. Without dedup, multi-lead opps inflate counts.

2. **Filtering SQO/Joined without `recordtypeid`** → Re-Engagement opps will be counted. Always add the recruiting filter.

3. **Using `DATE(Date_Became_SQO__c)` in queries** → `Date_Became_SQO__c` is TIMESTAMP. Use `TIMESTAMP()` wrapper for comparisons. `DATE()` works for display but truncates time which can cause off-by-one at midnight.

4. **Using `new_mapping` JOIN in new queries** → DEPRECATED. Use `v.Channel_Grouping_Name` directly (computed from `Finance_View__c` in the view).

5. **Assuming `SGA_Owner_Name__c` covers all SGA attribution** → For opp metrics, also check `Opp_SGA_Name__c`. The SGA may have been recorded on the opportunity differently than the lead.

6. **Using `advisor_join_date__c IS NOT NULL` for joined counts** → Closed Lost advisors can have join dates (they joined then left). Always check `StageName != 'Closed Lost'` or use the pre-computed `is_joined`/`is_joined_unique` flags.

7. **Adding `Underwritten_AUM__c + Amount`** → These are the same value from different sources. Always COALESCE, never SUM.

8. **Using period mode conversion rates for forecasting** → Period mode can exceed 100% and measures different populations. Always use cohort mode for forecasting and efficiency analysis.

9. **Counting Contacted without `is_contacted = 1`** → Having `stage_entered_contacting__c` set is necessary but not sufficient. The flag confirms the lead was actually contacted.

10. **Querying `Stage_Entered_Closed__c` for pre-2024 records** → Only 3.6% populated for 2023 data. Reliable from 2024 onward (65%+).

11. **Assuming lead-level metrics exclude re-engagement** → They don't. Prospects, Contacted, MQLs, and SQLs all include re-engagement records. Filter on `lead_record_source = 'Lead'` if you need to exclude them.

12. **Confusing `Marketing_Segment__c` with `Lead_Score_Tier__c`** → Completely different systems. `Marketing_Segment__c` is FinTrx firm-type (not in the view). `Lead_Score_Tier__c` is V4 XGBoost scoring (in the view, used by dashboard).
