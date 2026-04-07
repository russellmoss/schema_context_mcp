# BigQuery View Registry

> **Generated**: 2026-03-29 | **Regenerated with Human-Verified Context**: 2026-03-29
> **Purpose**: Catalog of every BigQuery view, its purpose, consumers, and key fields.

---

## Dataset: Tableau_Views (Primary Dashboard Views)

### View: vw_funnel_master
- **Dataset**: `savvy-gtm-analytics.Tableau_Views`
- **Purpose**: Single source of truth combining Lead + Opportunity data for the entire recruiting funnel. All funnel metrics, conversion rates, and drill-downs derive from this view.
- **Consumers**:
  - `src/lib/queries/funnel-metrics.ts` — volume metrics (Prospects, Contacted, MQL, SQL, SQO, Joined)
  - `src/lib/queries/conversion-rates.ts` — cohort and period mode conversion rates
  - `src/lib/queries/detail-records.ts` — detail record tables
  - `src/lib/queries/drill-down.ts` — drill-down modals
  - `src/lib/queries/open-pipeline.ts` — open pipeline dashboard, SGM hub
  - `src/lib/queries/source-performance.ts` — source/channel performance tables
  - `src/lib/queries/export-records.ts` — CSV export
  - `src/lib/queries/forecast-rates.ts` — historical conversion rates for forecast
  - `src/lib/queries/forecast-monte-carlo.ts` — Monte Carlo simulation
  - `src/lib/queries/forecast-pipeline.ts` — pipeline forecast (historical joins)
  - `src/lib/queries/sga-activity.ts` — SGA activity performance (joined to Task)
  - `src/lib/queries/sga-leaderboard.ts` — SGA leaderboard
  - `src/lib/queries/sgm-quota.ts` — SGM quota tracking
  - `src/lib/queries/sgm-dashboard.ts` — SGM hub dashboard
  - `src/lib/queries/quarterly-progress.ts` — quarterly progress tracking
  - `src/lib/queries/pipeline-catcher.ts` — pipeline catcher game
  - `src/lib/queries/filter-options.ts` — filter dropdown options
  - `src/lib/queries/weekly-actuals.ts` — weekly actuals tracking
  - `src/lib/queries/closed-lost.ts` — closed-lost analysis
  - `src/lib/queries/re-engagement.ts` — re-engagement funnel
  - `src/lib/semantic-layer/` — Explore AI agent queries
- **Key Dependencies**: `SavvyGTMData.Lead`, `SavvyGTMData.Opportunity`, `SavvyGTMData.Account`, `SavvyGTMData.Campaign`, `SavvyGTMData.CampaignMember`, `SavvyGTMData.User`
- **Key Fields**: `FilterDate` (funnel entry timestamp), `is_sqo_unique`, `is_joined_unique`, `is_primary_opp_record`, `eligible_for_*_conversions`, `*_progression` flags, `Channel_Grouping_Name`, `recordtypeid`, `lead_record_source`
- **Field Count**: 88 columns
- **Last Modified**: 2026-03-22 (added ARR fields for SGM Hub)
- **Re-Engagement**: Re-engagement records (`012VS000009VoxrYAC`) are UNION ALL'd into the lead side via `ReEngagement_As_Lead` CTE and DO affect lead-level metrics. See bq-patterns.md for filtering rules.

### View: vw_forecast_p2
- **Dataset**: `savvy-gtm-analytics.Tableau_Views`
- **Purpose**: Deterministic expected-value pipeline forecast. Computes P(Join), projected join dates, and expected AUM for each open SQO based on historical stage-to-stage conversion rates from resolved deals (Jun-Dec 2025).
- **Consumers**:
  - `src/lib/queries/forecast-pipeline.ts` — forecast pipeline page
  - `src/lib/queries/forecast-export.ts` — forecast Google Sheets export
  - `src/app/api/forecast/record/[id]/route.ts` — individual deal forecast detail
- **Key Dependencies**: `vw_funnel_master` (reads open pipeline + historical cohort)
- **Key Fields**: `p_join`, `final_projected_join_date`, `expected_aum_weighted`, `projected_quarter`, `days_in_current_stage`, `rate_*` columns
- **Field Count**: 25 columns

### View: vw_funnel_audit
- **Dataset**: `savvy-gtm-analytics.Tableau_Views`
- **Purpose**: Audit trail for opportunity stage progression — tracks days in each stage, stage velocities, skipped stages, and conversion numerators/denominators. Used alongside vw_forecast_p2 for deal-level detail.
- **Consumers**:
  - `src/lib/queries/forecast-export.ts` — joined to forecast data for audit columns
  - `src/app/api/forecast/record/[id]/route.ts` — deal detail view
- **Key Dependencies**: `vw_funnel_master`
- **Key Fields**: `days_in_sp`, `days_in_negotiating`, `days_in_signed`, `stages_skipped`, `SP_Numerator/Denominator`, `Neg_Numerator/Denominator`, `Signed_Numerator/Denominator`, `Joined_Numerator/Denominator`
- **Field Count**: 51 columns

### View: vw_daily_forecast
- **Dataset**: `savvy-gtm-analytics.Tableau_Views` (also in `savvy_analytics`)
- **Purpose**: Daily-ized forecast goals broken down by source/channel. Each row = one day with daily target counts for prospects, MQLs, SQLs, SQOs, and Joined.
- **Consumers**:
  - `src/lib/queries/forecast-goals.ts` — goal progress bars on dashboard
  - `src/lib/semantic-layer/query-templates.ts` — Explore AI forecast queries
  - `src/lib/reporting/context.ts` — reporting agent context
- **Key Dependencies**: External forecast model (likely manually maintained)
- **Key Fields**: `date_day`, `original_source`, `channel_grouping_name`, `prospects_daily`, `mqls_daily`, `sqls_daily`, `sqos_daily`, `joined_daily`, `quarter_key`
- **Field Count**: 9 columns

### View: vw_joined_advisor_location
- **Dataset**: `savvy-gtm-analytics.Tableau_Views`
- **Purpose**: One row per joined advisor with best-available address for map visualization. Coalesces addresses from Contact, FinTrx regulatory data, and Account records. Includes geocoded lat/long.
- **Consumers**:
  - `src/lib/queries/advisor-locations.ts` — advisor map page
  - `src/app/api/cron/geocode-advisors/route.ts` — cron job for geocoding
- **Key Dependencies**: `vw_funnel_master`, `SavvyGTMData.Opportunity`, `SavvyGTMData.Contact`, `SavvyGTMData.Account`, `FinTrx_data_CA.ria_contacts_current`, `Tableau_Views.geocoded_addresses` (table)
- **Key Fields**: `address_lat`, `address_long`, `address_source`, `coord_source`, `has_full_address`, `address_state` (normalized)
- **Field Count**: 29 columns

### View: vw_lost_to_competition
- **Dataset**: `savvy-gtm-analytics.Tableau_Views`
- **Purpose**: Matches closed-lost SQOs to FinTrx regulatory data to determine which firm the advisor moved to after declining Savvy. Uses CRD (Central Registration Depository) number matching.
- **Consumers**:
  - `src/lib/reporting/context.ts` — competitive-intel and analyze-wins reporting agents
  - `src/lib/reporting/tools.ts` — reporting tool queries
  - NOT consumed by any direct dashboard page — reporting agents only
- **Key Dependencies**: `SavvyGTMData.Opportunity` (direct, not via vw_funnel_master), `FinTrx_data_CA.ria_contacts_current`
- **Key Fields**: `moved_to_firm`, `months_to_move`, `closed_lost_reason`, `crd`, `sfdc_url`
- **Field Count**: 12 columns

### View: vw_sga_activity_performance
- **Dataset**: `savvy-gtm-analytics.Tableau_Views` (also in `savvy_analytics`)
- **Purpose**: Joins Salesforce Task records to vw_funnel_master to categorize SGA activities (calls, SMS, email, LinkedIn, meetings) with direction, quality signals, cold call classification, and ramp status.
- **Consumers**:
  - `src/lib/queries/sga-activity.ts` — SGA activity performance page
  - `src/lib/reporting/context.ts` — reporting agent context
- **Key Dependencies**: `SavvyGTMData.Task`, `SavvyGTMData.User`, `vw_funnel_master`
- **Key Fields**: `activity_channel`, `direction`, `is_meaningful_connect`, `is_true_cold_call`, `cold_call_quality`, `activity_ramp_status`
- **Note**: Local SQL file is `vw_sga_activity_performance_v2.sql` but BQ view name is `vw_sga_activity_performance` (no v2 suffix)

### Table: geocoded_addresses
- **Dataset**: `savvy-gtm-analytics.Tableau_Views`
- **Type**: BASE TABLE (not a view)
- **Purpose**: Stores geocoded lat/long coordinates for joined advisors. Populated by the `geocode-advisors` cron job.
- **Consumers**: `vw_joined_advisor_location` (LEFT JOIN), `src/app/api/cron/geocode-advisors/route.ts`

### Table: q4_2025_forecast (**Active — Legacy Name**)
- **Dataset**: `savvy-gtm-analytics.SavvyGTMData`
- **Type**: BASE TABLE (backed by Google Sheet)
- **Purpose**: Goal-setting table for quarterly targets. Contains quarterly goal allocations used by the forecast and goal-tracking features.
- **Consumers**: `src/lib/queries/forecast-goals.ts`, goal progress tracking
- **Status**: **ACTIVE** — despite the `q4_` prefix, this table is rolling forward. Currently contains Q4 2025 + Q1 2026 data. Q2 2026 will be added next. The name is a legacy artifact from when it was created — do NOT treat as deprecated or Q4-specific.
- **Key Fields**: Goal targets by source/channel/quarter

---

## Dataset: savvy_analytics (48 views — mostly Tableau/analytics)

Most views in `savvy_analytics` are **not consumed by the Next.js dashboard directly**. They serve Tableau, ad-hoc analysis, or historical purposes. Dashboard-consumed views:

| View | Dashboard Consumer | Purpose |
|------|-------------------|---------|
| `vw_sga_sms_timing_analysis_v2` | Reporting agents (analyze-wins, sga-performance) | SMS behavior per lead |
| `vw_sga_closed_lost_sql_followup` | `src/lib/queries/closed-lost.ts` | Closed-lost SQL follow-up analysis |
| `sms_weekly_metrics_daily` (table) | Reporting agents (sga-performance) | Weekly SGA scorecards |
| `vw_sga_activity_performance` | `src/lib/queries/sga-activity.ts` | SGA activity (same as Tableau_Views version) |
| `vw_daily_forecast` | Same as Tableau_Views version | Daily forecast goals |

**Orphaned/External-only views** (not consumed by dashboard):
- `vw_channel_conversion_rates_pivoted`, `vw_channel_funnel_volume_by_month`, `vw_channel_drill_base`, `vw_channel_drill_rollup_unified_date` — Tableau-only
- `vw_coaching_dashboard_master_v1`, `vw_team_performance_v1/v2` — Tableau coaching dashboards
- `vw_conversion_rate_table`, `vw_conversion_rates`, `vw_conversion_volume_table` — Tableau conversion views
- `vw_forecast_*` variants — Tableau forecast views
- `vw_sga_funnel`, `vw_sga_funnel_team_agg` — Tableau SGA views
- `vw_sgm_*` views — Tableau SGM capacity views
- `Firm-city-state`, `Outbound_SQO_Q4` — ad-hoc analysis

---

## Dataset: SavvyGTMData (8 views + raw tables)

| View | Purpose | Dashboard Consumer |
|------|---------|-------------------|
| `XYPN_view` | XYPN partner data | None (external) |
| `broker_protocol_match_quality` | Broker protocol matching QA | None (external) |
| `broker_protocol_needs_review` | Broker protocol records needing review | None (external) |
| `broker_protocol_recent_changes` | Recent broker protocol changes | None (external) |
| `fintrx_clean` | Cleaned FinTrx data | None (external) |
| `vw_sga_funnel` | SGA funnel (legacy) | None (external) |
| `vw_sga_funnel_improved` | SGA funnel v2 | None (external) |
| `vw_sga_funnel_team_agg_improved` | SGA team aggregation | None (external) |

---

## Raw Tables Directly Queried by Dashboard

These `SavvyGTMData` tables are queried directly (not just consumed via views):

| Table | Query Files | Purpose |
|-------|------------|---------|
| `User` | filter-options, detail-records, funnel-metrics, open-pipeline, quarterly-progress, sga-leaderboard, sga-activity, sgm-quota, weekly-actuals, drill-down, admin-quarterly-progress | SGA/SGM name lookups, IsSGA flag |
| `Opportunity` | closed-lost, re-engagement, advisor-locations, forecast-pipeline | Direct opp queries for closed-lost analysis, re-engagement |
| `Lead` | drill-down, weekly-actuals, filter-options | Lead-level detail for drill-downs |
| `Task` | sga-activity | Activity data (joined to vw_funnel_master in view, also queried directly) |
| `OpportunityFieldHistory` | forecast-pipeline, forecast-date-revisions | PIT reconstruction for surprise baseline, date revision tracking. **Synced weekly** (separate from 6-hour transfers). |
| `Campaign` | filter-options | Campaign name lookups |
| `CampaignMember` | filter-options | Campaign membership existence checks |
| `Account` | advisor-locations | Account address fields, Account_Total_AUM__c |
| `new_mapping` | drill-down, record-detail, quarterly-progress | Source→Channel mapping (**DEPRECATED** — view now does this inline from `Finance_View__c`) |
| `Contact` | (via vw_joined_advisor_location view only) | Contact address fields |

### The `new_mapping` Table
- **Schema**: `original_source` (STRING) → `Channel_Grouping_Name` (STRING)
- **Purpose**: Maps `Original_source` values to marketing channel groupings
- **Current Status**: **DEPRECATED**. `Finance_View__c` is the canonical source for channel grouping. The `vw_funnel_master` view now computes `Channel_Grouping_Name` inline from `Finance_View__c` via a CASE statement. Some legacy query files (`drill-down.ts`, `record-detail.ts`, `quarterly-progress.ts`) still JOIN to `new_mapping` — these should be migrated. **Do not use `new_mapping` in new queries.**

---

## FinTrx Dataset Tables

27 tables in `FinTrx_data_CA`. Refreshed **monthly** via SFTP → Cloud Function Gen2 (16GB) → BigQuery. ~33M total rows.

Dashboard-consumed tables:

| Table | Consumer | Purpose |
|-------|----------|---------|
| `ria_contacts_current` | `vw_lost_to_competition`, `vw_joined_advisor_location` | Current advisor firm/location data, CRD matching |
| `advisor_segments` | Hightouch outbound sync (daily, 3 syncs) | ~790K rows. Firm-type classification synced to Salesforce `Marketing_Segment__c` on Lead, Contact, Opportunity. 4 segments: OTHER (420K), CAPTIVE_W2 (180K), INDEPENDENT_PLATFORM (96K), RIA_OWNER (94K). No score field — purely categorical. Join key: `RIA_CONTACT_CRD_ID` matched to SF `FA_CRD__c`. **Not queried by dashboard directly.** |

All other FinTrx tables (firm historicals, disclosure data, affiliates, custodians, etc.) are not directly consumed by the dashboard.
