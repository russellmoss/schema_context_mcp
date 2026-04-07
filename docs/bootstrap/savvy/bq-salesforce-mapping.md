# Salesforce → BigQuery Mapping

> **Generated**: 2026-03-29 | **Regenerated with Human-Verified Context**: 2026-03-29
> **Purpose**: Complete data flow from Salesforce objects to BigQuery tables, field lineage, sync cadence, and FinTrx pipeline.

---

## Sync Architecture

```
Salesforce (source of truth)
    │
    ├─── BQ Data Transfer Service (every 6 hours) ───→ SavvyGTMData.*
    │         Lead, Opportunity, Contact, Account, Task,
    │         Campaign, CampaignMember, User
    │
    ├─── BQ Data Transfer Service (WEEKLY, separate job) ───→ SavvyGTMData.OpportunityFieldHistory
    │         Point-in-time reconstruction for Pipeline Forecast
    │
    ├─── Hightouch (outbound, daily, 3 syncs) ←───── FinTrx_data_CA.advisor_segments
    │         Syncs advisor_segment → Marketing_Segment__c
    │         on Lead, Contact, and Opportunity
    │
    └─── FinTrx (SFTP → Cloud Function, MONTHLY) ──→ FinTrx_data_CA.*
              27 tables, ~33M rows, regulatory/advisor data

BigQuery (analytics layer)
    │
    ├─── Tableau_Views.vw_funnel_master ──→ Dashboard (Next.js)
    │         Joins Lead + Opportunity + Account + Campaign + CampaignMember + User
    │
    ├─── Tableau_Views.vw_forecast_p2 ────→ Forecast Page
    │         Reads from vw_funnel_master
    │
    ├─── Tableau_Views.vw_lost_to_competition ──→ Reporting Agents
    │         Joins Opportunity + FinTrx ria_contacts_current
    │
    ├─── Tableau_Views.vw_joined_advisor_location ──→ Advisor Map
    │         Joins vw_funnel_master + Opportunity + Contact + Account + FinTrx + geocoded_addresses
    │
    └─── savvy_analytics.* ──→ Tableau dashboards, Reporting Agents
              48 views (most not consumed by Next.js dashboard)
```

---

## Object Mapping

| SF Object | BQ Table | Dataset | Sync Cadence | Approx Columns | Key Fields Used by Dashboard |
|-----------|----------|---------|--------------|----------------|------------------------------|
| Lead | `Lead` | SavvyGTMData | Every 6 hours | 143 | Id, Name, ConvertedOpportunityId, ConvertedDate, IsConverted, SGA_Owner_Name__c, Final_Source__c, Finance_View__c, stage_entered_contacting__c, Stage_Entered_Call_Scheduled__c, FA_CRD__c, Campaign__c, Experimentation_Tag__c, Lead_Score_Tier__c, External_Agency__c, Initial_Call_Scheduled_Date__c, Stage_Entered_Closed__c, Disposition__c, DoNotCall, Next_Steps__c |
| Opportunity | `Opportunity` | SavvyGTMData | Every 6 hours | 170+ | Id, Name, RecordTypeId, StageName, Amount, Underwritten_AUM__c, SGA__c (User ID), Opportunity_Owner_Name__c, SQL__c, Date_Became_SQO__c, advisor_join_date__c, Final_Source__c, Finance_View__c, FA_CRD__c, Stage_Entered_*__c (7 fields), Earliest_Anticipated_Start_Date__c, Closed_Lost_Reason__c, Closed_Lost_Details__c, Actual_ARR__c, SGM_Estimated_ARR__c, CampaignId, Experimentation_Tag__c, External_Agency__c, ContactId, AccountId, Previous_Recruiting_Opportunity_ID__c, Created_Recruiting_Opportunity_ID__c |
| Account | `Account` | SavvyGTMData | Every 6 hours | ~50 | Id, Account_Total_ARR__c, BillingStreet/City/State/PostalCode/Country/Lat/Long, Account_Total_AUM__c |
| Contact | `Contact` | SavvyGTMData | Every 6 hours | ~60 | Id, MailingStreet/City/State/PostalCode/Country/Lat/Long |
| Task | `Task` | SavvyGTMData | Every 6 hours | ~30 | Id, CreatedDate, Subject, Type, TaskSubtype, CallDurationInSeconds, WhoId (Lead), WhatId (Opp), OwnerId, Status, IsDeleted |
| User | `User` | SavvyGTMData | Every 6 hours | ~30 | Id, Name, IsSGA__c, IsActive, CreatedDate |
| Campaign | `Campaign` | SavvyGTMData | Every 6 hours | ~20 | Id, Name, IsDeleted |
| CampaignMember | `CampaignMember` | SavvyGTMData | Every 6 hours | ~15 | LeadId, ContactId, CampaignId, IsDeleted |
| OpportunityFieldHistory | `OpportunityFieldHistory` | SavvyGTMData | **Weekly** (separate job) | ~10 | OpportunityId, Field, OldValue, NewValue, CreatedDate |

**Important**: `OpportunityFieldHistory` is on a **separate weekly** Data Transfer Service job, NOT part of the 6-hour cycle. This means PIT reconstruction data for the Pipeline Forecast can be up to 7 days stale. All other core objects above are synced every 6 hours with maximum 6-hour staleness.

---

## Field Lineage (Critical Fields)

| Dashboard Label | SF Field | SF Object | BQ Raw Table | BQ View Field | Transformation |
|----------------|----------|-----------|-------------|---------------|----------------|
| SGA Name | `SGA_Owner_Name__c` | Lead | `SavvyGTMData.Lead` | `SGA_Owner_Name__c` | Passthrough on Lead; COALESCE with User lookup of `Opp.SGA__c` for final |
| SGM Name | `Opportunity_Owner_Name__c` | Opportunity | `SavvyGTMData.Opportunity` | `SGM_Owner_Name__c` | Renamed in view from `Opp_SGM_Name` |
| Opp SGA | `SGA__c` | Opportunity | `SavvyGTMData.Opportunity` | `Opp_SGA_Name__c` | This is a **User ID** in SF. View joins to `User` table to get name as `Opp_SGA_User_Name`. |
| Original Source | `Final_Source__c` | Lead + Opportunity | Both | `Original_source` | `COALESCE(Opp.Final_Source__c, Lead.Final_Source__c, 'Unknown')` |
| Finance View | `Finance_View__c` | Lead + Opportunity | Both | `Finance_View__c` | `COALESCE(Opp.Finance_View__c, Lead.Finance_View__c, 'Other')` — **canonical channel source** |
| Channel | `Finance_View__c` | Lead + Opportunity | Both | `Channel_Grouping_Name` | CASE mapping: Partnerships→Recruitment Firm, Job Apps→Marketing, Employee/Advisor Referral→Referral, else passthrough |
| FA CRD | `FA_CRD__c` | Lead + Opportunity | Both | Not in vw_funnel_master | Used in `vw_lost_to_competition` and `vw_joined_advisor_location` for FinTrx matching |
| SQL Date | `ConvertedDate` | Lead | `SavvyGTMData.Lead` | `converted_date_raw` | Passthrough (type stays DATE) |
| SQO Date | `Date_Became_SQO__c` | Opportunity | `SavvyGTMData.Opportunity` | `Date_Became_SQO__c` | Passthrough (TIMESTAMP) |
| Join Date | `Advisor_Join_Date__c` | Opportunity | `SavvyGTMData.Opportunity` | `advisor_join_date__c` | Passthrough (DATE) |
| SQO Status | `SQL__c` | Opportunity | `SavvyGTMData.Opportunity` | `SQO_raw`, `is_sqo`, `is_sqo_unique` | `SQL__c = 'Yes'` → `is_sqo = 1`. **Confusing name**: `SQL__c` actually means SQO status. |
| Actual ARR | `Actual_ARR__c` | Opportunity | `SavvyGTMData.Opportunity` | `Actual_ARR__c` | Passthrough. Post-join only. |
| Account ARR | `Account_Total_ARR__c` | Account | `SavvyGTMData.Account` | `Account_Total_ARR__c` | Joined via `Opportunity.AccountId = Account.Id` |
| SGM Est ARR | `SGM_Estimated_ARR__c` | Opportunity | `SavvyGTMData.Opportunity` | `SGM_Estimated_ARR__c` | Passthrough. Pre-join estimate. |
| Pipeline AUM | `Underwritten_AUM__c` / `Amount` | Opportunity | `SavvyGTMData.Opportunity` | `Opportunity_AUM` | `COALESCE(Underwritten_AUM__c, Amount)` — never add, always COALESCE |
| Record Type | `RecordTypeId` | Opportunity | `SavvyGTMData.Opportunity` | `recordtypeid` | Passthrough. Only Recruiting opps (`012Dn000000mrO3IAI`) join from `Opp_Base`. |
| Stage | `StageName` | Opportunity | `SavvyGTMData.Opportunity` | `StageName` | `COALESCE(Opp.StageName, Lead.lead_StageName)` |
| Contacted Date | `Stage_Entered_Contacting__c` | Lead | `SavvyGTMData.Lead` | `stage_entered_contacting__c` | Passthrough (TIMESTAMP) |
| MQL Date | `Stage_Entered_Call_Scheduled__c` | Lead | `SavvyGTMData.Lead` | `mql_stage_entered_ts` | Renamed in view |
| Lead Score Tier | `Lead_Score_Tier__c` | Lead | `SavvyGTMData.Lead` | `Lead_Score_Tier__c` | Passthrough. V4 XGBoost output (Career Clock, Prime Movers, etc.) |
| Marketing Segment | `Marketing_Segment__c` | Lead, Contact, Opp | `SavvyGTMData.Lead` etc. | **Not in vw_funnel_master** | Written by Hightouch from FinTrx `advisor_segments`. Firm-type classification — NOT lead scoring. |

---

## Re-Engagement Records in vw_funnel_master

Re-Engagement opportunities (`RecordTypeId = '012VS000009VoxrYAC'`) are treated as **lead-like records** in the `ReEngagement_As_Lead` CTE:

| SF Opportunity Field | Maps To (Lead-equivalent) | Funnel Stage |
|---------------------|--------------------------|-------------|
| `Full_Opportunity_ID__c` | `Full_prospect_id__c` (treated as lead ID) | - |
| `Stage_Entered_Outreach__c` | `stage_entered_contacting__c` | Contacted |
| `Stage_Entered_Call_Scheduled__c` | `mql_stage_entered_ts` | MQL |
| `DATE(Stage_Entered_Re_Engaged__c)` | `converted_date_raw` | SQL |
| `COALESCE(Stage_Entered_Planned_Nurture__c, CreatedDate)` | `stage_entered_new__c` | New/Prospect |
| `Created_Recruiting_Opportunity_ID__c` | `converted_oppty_id` | - |
| `Opportunity_Owner_Name__c` | `Lead_SGA_Owner_Name__c` | - |

This allows re-engagement records to flow through the same funnel logic as regular leads. They are UNION ALL'd into `All_Leads` and DO affect lead-level metric counts (Prospects, Contacted, MQL, SQL). They are excluded from SQO/Signed/Joined by the `recordtypeid` filter.

---

## Sync Cadence and Freshness

### BigQuery Data Transfer Service — Core Objects (6-Hour Cycle)
- **Schedule**: Every 6 hours
- **Objects synced**: Lead, Opportunity, Contact, Account, Task, Campaign, CampaignMember, User
- **Mechanism**: Salesforce REST API bulk extraction → BigQuery load
- **Typical duration**: Minutes per object (parallel extraction)
- **Maximum staleness**: 6 hours behind Salesforce

### BigQuery Data Transfer Service — OpportunityFieldHistory (Weekly)
- **Schedule**: Weekly (separate DTS job)
- **Objects synced**: OpportunityFieldHistory only
- **Purpose**: Point-in-time (PIT) pipeline state reconstruction for Pipeline Forecast surprise baseline, close date revision tracking (`dateRevisionCount`, `dateConfidence`)
- **Maximum staleness**: 7 days behind Salesforce
- **Impact**: PIT reconstruction and surprise detection can lag by up to a week

### Data Freshness Monitoring
- `data-freshness.ts` checks `SavvyGTMData.__TABLES__` metadata for last modified timestamps
- Surfaces staleness indicators to the dashboard

### Hightouch Outbound Sync
- **Direction**: BigQuery → Salesforce
- **Source table**: `FinTrx_data_CA.advisor_segments`
- **Target field**: `Marketing_Segment__c` on Lead, Contact, and Opportunity
- **Schedule**: Daily (3 separate syncs)
- **Syncs**:
  | Sync | SF Object | ~Rows | Sync ID |
  |------|-----------|-------|---------|
  | Marketing Segments - Lead | Lead | ~87,000 | 2711387 |
  | Marketing Segments - Contacts | Contact | ~1,100 | 2711389 |
  | Marketing Segments - Opportunity | Opportunity | ~2,200 | 2711001 |
- **Mechanism**: Diff-based (Hightouch caches previous state, only changed records sync). Typical daily run: 0-50 rows. Uses Bulk API v2, 10K rows/batch.
- **Match key**: Native Salesforce `Id` (optimized March 2026 — previously used `FA_CRD__c` which required ~87K individual REST lookups per Lead run)
- **Critical distinction**: `Marketing_Segment__c` is a **FinTrx firm-type classification** (CAPTIVE_W2, RIA_OWNER, INDEPENDENT_PLATFORM, OTHER) — it is **NOT** the V4 lead scoring output. V4 XGBoost tiers (Career Clock, Prime Movers, etc.) live in `Lead_Score_Tier__c`. These are completely separate systems.

---

## FinTrx Pipeline

### Data Flow
```
FinTrx (vendor) → SFTP drop → Cloud Function Gen2 (16GB memory) → BigQuery (FinTrx_data_CA dataset)
```

### Refresh Cadence
**Monthly** — all 27 tables refreshed each cycle. ~33M total rows across all tables.

### Tables
- **`ria_contacts_current`** — Primary table. Current advisor data with CRD, firm name, location, firm start dates. Used for:
  - CRD matching in `vw_lost_to_competition` (where did lost advisors go?)
  - Address enrichment in `vw_joined_advisor_location`
- **`ria_firms_current`** — Current firm data
- **`advisor_segments`** — ~790K rows. Firm-type marketing segmentation, synced back to SF via Hightouch
  - 4 segments: OTHER (420K), CAPTIVE_W2 (180K), INDEPENDENT_PLATFORM (96K), RIA_OWNER (94K)
  - Purely categorical — no score field
  - Join key: `RIA_CONTACT_CRD_ID` (INT64) matched to Salesforce `FA_CRD__c` (STRING)
  - **Not queried by dashboard directly** — consumed only by Hightouch
- **Historical tables** — `Firm_historicals`, `affiliates_historicals`, `custodians_historicals`, etc. for longitudinal analysis
- **`Historical_Disclosure_data`** — Regulatory disclosure records
- **`contact_registered_employment_history`** — Employment history for transition analysis

### CRD Matching Pattern

The CRD (Central Registration Depository) number is the primary join key between Salesforce advisor records and FinTrx regulatory data:

```sql
-- vw_lost_to_competition (casts FinTrx → STRING)
CAST(RIA_CONTACT_CRD_ID AS STRING) AS crd  -- FinTrx side (INT64 → STRING)
o.FA_CRD__c AS crd                          -- Salesforce side (STRING)

-- vw_joined_advisor_location (casts SF → INT64)
SAFE_CAST(NULLIF(TRIM(COALESCE(o.FA_CRD__c, l.FA_CRD__c)), '') AS INT64) = ft.RIA_CONTACT_CRD_ID
```

Note: The join direction differs — `vw_lost_to_competition` casts FinTrx to STRING; `vw_joined_advisor_location` casts SF to INT64 with SAFE_CAST. Both handle the type mismatch.

---

## Known Gotchas

1. **`SGA__c` on Opportunity is a User ID, not a name**. The view joins to `User` table to get the actual name. If you query `SavvyGTMData.Opportunity` directly, `SGA__c` returns a 15/18-char Salesforce ID.

2. **`SQL__c` means SQO status**. Legacy naming. `SQL__c = 'Yes'` means the opportunity has been qualified as an SQO.

3. **Re-Engagement opps appear twice in the view**. Once in `ReEngagement_As_Lead` (as lead-equivalent rows with the re-engagement opp's own ID) and potentially again in `Opp_Base` (if `Created_Recruiting_Opportunity_ID__c` points to a recruiting opp). The FULL OUTER JOIN handles the relationship.

4. **`Opp_Base` only includes Recruiting record type** (`WHERE RecordTypeId = '012Dn000000mrO3IAI'`). Re-Engagement opps enter via `ReEngagement_As_Lead`, not via `Opp_Base`. This means `recordtypeid` in the view is NULL for lead-only rows and `012Dn000000mrO3IAI` for opp rows.

5. **Account_Total_ARR__c comes from a JOIN**. The view joins `Opportunity` to `Account` via `AccountId` to get this field. It's not on the Opportunity object itself.

6. **`advisor_join_date__c` can exist on Closed Lost records**. An advisor who joined then left retains the join date but gets `StageName = 'Closed Lost'`. The view's `is_joined` flag correctly excludes these.

7. **BQ Data Transfer has 6-hour lag for core objects, 7-day lag for OpportunityFieldHistory**. The `data-freshness.ts` query checks `SavvyGTMData.__TABLES__` for last modified timestamps. PIT reconstruction (surprise baseline) is the most stale data in the dashboard.

8. **`Stage_Entered_Closed__c` has low population for older records**. Only 3.6% populated for 2023 records, 65.4% for 2024, 74.5% for 2025. Don't rely on it for pre-2024 analysis.

9. **`Finance_View__c` exists on both Lead and Opportunity**. The view COALESCEs Opp first, then Lead. This means if the opp has a different Finance_View than the lead, the opp value wins.

10. **Campaign fields have two paths**. `Campaign__c` on Lead (custom field) vs `CampaignId` on Opportunity (standard field). The view COALESCEs them into `Campaign_Id__c`. Additionally, `all_campaigns` array comes from `CampaignMember` records (all campaigns the lead/contact belongs to, not just the primary).

11. **`Marketing_Segment__c` ≠ `Lead_Score_Tier__c`**. `Marketing_Segment__c` is FinTrx firm-type (CAPTIVE_W2 etc., written by Hightouch, not in the view). `Lead_Score_Tier__c` is V4 XGBoost lead quality scoring (Career Clock etc., in the view, used by dashboard). Completely separate systems.

---

## Ground Truth Validation (Q1 2025)

Verified 2026-03-29 against `vw_funnel_master`:

| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| SQLs | 123 | **122** | -1 (minor discrepancy, investigate) |
| SQOs | 96 | 96 | Exact match |
| Joined | 12 | 12 | Exact match |

The SQL count difference of 1 may be due to a view modification on 2026-03-22 (ARR fields added for SGM Hub) or a data sync change. SQOs and Joined match exactly.
