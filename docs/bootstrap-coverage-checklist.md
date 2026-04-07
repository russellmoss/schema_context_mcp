# Bootstrap Coverage Checklist

Tracks which source doc sections have been migrated to config, pending, or intentionally deferred.

## bq-views.md

| Section | Status | Config Location |
|---------|--------|----------------|
| View purposes, grain, consumers | Migrated | views.* |
| Key fields per view | Migrated | views.*.key_filters, views.*.dangerous_columns |
| Dataset organization | Migrated | views.*.status for base tables |
| Orphaned/external-only views | Deferred | Not needed for v1 (dashboard-consumed views only) |
| Raw tables (new_mapping deprecation) | Migrated | rules.no_new_mapping |
| geocoded_addresses, q4_2025_forecast | Migrated | views.geocoded_addresses, views.q4_2025_forecast |

## bq-field-dictionary.md

| Section | Status | Config Location |
|---------|--------|----------------|
| Identifier fields | Migrated (partial) | fields.primary_key not needed for query guidance |
| FilterDate computation chain | Migrated | fields.FilterDate |
| Date fields (DATE vs TIMESTAMP) | Migrated | fields.*, rules.date_* |
| Funnel flags | Migrated | fields.is_contacted through is_joined |
| Deduplication flags | Migrated | fields.is_sqo_unique, is_joined_unique, is_primary_opp_record |
| Eligibility flags (denominators) | Migrated | fields.eligible_for_* |
| Progression flags (numerators) | Migrated | fields.*_progression |
| Attribution fields | Migrated | fields.SGA_Owner_Name__c, task_executor_name |
| AUM/ARR fields | Migrated | fields.Opportunity_AUM, rules.aum_* |
| Re-engagement stage mapping | Migrated | views.vw_funnel_master.notes, terms.Re-engagement |
| Marketing_Segment vs Lead_Score_Tier | Migrated | terms.Marketing_Segment |
| Cohort month fields | Deferred | Low query-guidance value |

## bq-patterns.md

| Section | Status | Config Location |
|---------|--------|----------------|
| 12 critical rules | Migrated | rules.* (14 rules) |
| Cohort vs period mode | Migrated | metrics.* (4 metrics, 2 modes each) |
| Record type filtering | Migrated | rules.re_engagement_exclusion, fields.recordtypeid |
| Channel/source mapping | Migrated | rules.no_new_mapping, fields.Finance_View__c |
| Date handling patterns | Migrated | rules.date_* (4 date_type_rules) |
| Forecast-specific patterns | Deferred | Duration penalty, Monte Carlo — not core to preventing wrong SQL |
| AUM tier boundaries | Deferred | Implementation detail, not query-guidance |

## bq-activity-layer.md

| Section | Status | Config Location |
|---------|--------|----------------|
| Task linkage (WhoId/WhatId) | Migrated | views.vw_sga_activity_performance.purpose |
| Direction classification | Migrated | fields.direction |
| Channel classification | Migrated | fields.activity_channel |
| Automation exclusion filters | Migrated | rules.sga_outbound_automation_filter |
| Attribution (executor vs owner) | Migrated | fields.task_executor_name, rules.sga_effort_use_executor |
| Quality signals | Migrated | fields.is_meaningful_connect, is_true_cold_call |
| Ghost contacts known issue | Migrated | views.vw_sga_activity_performance.known_issues |
| Ramp status logic | Migrated | fields.activity_ramp_status |

## bq-salesforce-mapping.md

| Section | Status | Config Location |
|---------|--------|----------------|
| Sync cadence | Migrated | views.*.freshness_notes |
| Field lineage | Migrated | fields.* (source_info via meaning descriptions) |
| SGA__c gotcha | Migrated | fields.SGA__c |
| SQL__c naming confusion | Migrated | fields.SQO_raw, terms.SQO |
| Re-engagement dual-entry | Migrated | views.vw_funnel_master.notes, terms.Re-engagement |
| Stage_Entered_Closed__c gap | Migrated | fields.Stage_Entered_Closed__c, rules.stage_entered_closed_pre2024 |
| Finance_View__c precedence | Migrated | fields.Finance_View__c |
| CRD type mismatch | Migrated | terms.CRD |
| Hightouch sync details | Migrated | views.vw_funnel_master.freshness_notes, terms.Marketing_Segment |

---

**Summary**: All critical sections from all 5 source docs are migrated. Deferred items are low-priority implementation details (forecast duration penalties, AUM tier boundaries, cohort month fields) that don't affect query correctness.
