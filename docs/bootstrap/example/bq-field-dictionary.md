# BigQuery Field Dictionary

> **Generated**: 2026-03-29 | **Regenerated with Human-Verified Context**: 2026-03-29
> **Purpose**: Field-level definitions with business context, types, and usage rules.

---

## vw_funnel_master (88 columns)

### Identifier Fields

| Field | Type | Description |
|-------|------|-------------|
| `primary_key` | STRING | `COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c)` — unique row key |
| `Full_prospect_id__c` | STRING | Salesforce Lead ID (NULL for opp-only rows from FULL OUTER JOIN) |
| `Full_Opportunity_ID__c` | STRING | Salesforce Opportunity ID (NULL for unconverted leads) |
| `advisor_name` | STRING | `COALESCE(Opp_Name, Prospect_Name)` — display name |
| `opp_row_num` | INT64 | Row number within opportunity partition (1 = earliest lead). Used for dedup. |

### URL Fields

| Field | Type | Description |
|-------|------|-------------|
| `lead_url` | STRING | SFDC Lead URL |
| `opportunity_url` | STRING | SFDC Opportunity URL |
| `salesforce_url` | STRING | `COALESCE(opportunity_url, lead_url)` — best link |
| `origin_opportunity_url` | STRING | URL of previous recruiting opportunity (re-engagement only) |

### FilterDate — How It Works

`FilterDate` answers: **"When did this prospect meaningfully enter our funnel?"**

It is a computed TIMESTAMP field using a cascading COALESCE:

```sql
COALESCE(l.Lead_FilterDate, o.Opp_CreatedDate, o.Date_Became_SQO__c, TIMESTAMP(o.advisor_join_date__c)) AS FilterDate
```

**Priority chain:**
1. **`Lead_FilterDate`** (highest priority) — itself computed as:
   - **Standard Leads**: `GREATEST(CreatedDate, stage_entered_new__c, stage_entered_contacting__c)` — the latest early-stage timestamp. Nulls treated as `TIMESTAMP('1900-01-01')` so they lose the GREATEST comparison.
   - **Re-Engagement records**: `GREATEST(CreatedDate, Stage_Entered_Planned_Nurture__c, Stage_Entered_Outreach__c)` — same logic with re-engagement stage analogs.
2. **`Opp_CreatedDate`** — fallback for orphan opportunities (no matching lead from FULL OUTER JOIN)
3. **`Date_Became_SQO__c`** — rare fallback if opp has no CreatedDate
4. **`advisor_join_date__c`** — last resort

**Dashboard uses:**
- Prospect cohort assignment (`filter_date_cohort_month` = `FORMAT_DATE('%Y-%m', DATE(FilterDate))`)
- Date-range filtering — when you filter to "Q1 2026", you're filtering on this field
- A prospect "exists" in a time period based on when they entered the top of funnel, not when they reached any downstream stage

### Date Fields

| Field | Type | Wrapper in Queries | Stage | Description |
|-------|------|--------------------|-------|-------------|
| `FilterDate` | TIMESTAMP | `TIMESTAMP()` | Prospect | Funnel entry date (see computation chain above) |
| `CreatedDate` | TIMESTAMP | `TIMESTAMP()` | - | Lead creation timestamp |
| `stage_entered_contacting__c` | TIMESTAMP | `TIMESTAMP()` | Contacted | When SGA began outreach |
| `mql_stage_entered_ts` | TIMESTAMP | `TIMESTAMP()` | MQL | When call was scheduled (Call Scheduled stage) |
| `converted_date_raw` | **DATE** | `DATE()` | SQL | Lead→Opportunity conversion date |
| `Initial_Call_Scheduled_Date__c` | **DATE** | `DATE()` | - | Scheduled initial call date (can be future) |
| `Opp_CreatedDate` | TIMESTAMP | `TIMESTAMP()` | - | Opportunity creation timestamp |
| `Date_Became_SQO__c` | TIMESTAMP | `TIMESTAMP()` | SQO | When `SQL__c` became 'Yes' |
| `advisor_join_date__c` | **DATE** | `DATE()` | Joined | Official join date |
| `Qualification_Call_Date__c` | **DATE** | `DATE()` | - | Date of qualification call |
| `Stage_Entered_Discovery__c` | TIMESTAMP | `TIMESTAMP()` | Discovery | Opp entered Discovery |
| `Stage_Entered_Sales_Process__c` | TIMESTAMP | `TIMESTAMP()` | Sales Process | Opp entered Sales Process |
| `Stage_Entered_Negotiating__c` | TIMESTAMP | `TIMESTAMP()` | Negotiating | Opp entered Negotiating |
| `Stage_Entered_Signed__c` | TIMESTAMP | `TIMESTAMP()` | Signed | Opp entered Signed |
| `Stage_Entered_On_Hold__c` | TIMESTAMP | `TIMESTAMP()` | On Hold | Opp placed on hold |
| `Stage_Entered_Closed__c` | TIMESTAMP | `TIMESTAMP()` | Closed Lost | Opp closed lost. **Legacy gap**: 3.6% populated for 2023, 65.4% for 2024, 74.5% for 2025. |
| `Stage_Entered_Joined__c` | TIMESTAMP | `TIMESTAMP()` | Joined | Opp entered Joined stage (timestamp version) |
| `Earliest_Anticipated_Start_Date__c` | **DATE** | `DATE()` | - | SGM's estimate of when advisor will start |
| `lead_closed_date` | TIMESTAMP | `TIMESTAMP()` | - | Lead closed date (Stage_Entered_Closed on Lead) |

**Critical**: `converted_date_raw` and `advisor_join_date__c` are DATE type, not TIMESTAMP. All `Stage_Entered_*` fields are TIMESTAMP. Always use the correct wrapper.

### Funnel Flags (binary 0/1 indicators)

| Field | Type | Logic | Description |
|-------|------|-------|-------------|
| `is_contacted` | INT64 | `stage_entered_contacting__c IS NOT NULL` | Has been contacted |
| `is_mql` | INT64 | `mql_stage_entered_ts IS NOT NULL` | Has scheduled a call |
| `is_sql` | INT64 | `IsConverted = TRUE AND Full_Opportunity_ID__c IS NOT NULL` | Lead converted to opportunity |
| `is_sqo` | INT64 | `LOWER(SQO_raw) = 'yes'` | Opportunity is qualified. **Use for rate calculations, NOT volume counts.** |
| `is_joined` | INT64 | `(advisor_join_date__c IS NOT NULL OR StageName = 'Joined') AND StageName != 'Closed Lost'` | Advisor has joined (excludes Closed Lost who previously had join date) |

### Deduplication Flags

| Field | Logic | When to Use | When NOT to Use |
|-------|-------|-------------|-----------------|
| `is_primary_opp_record` | `opp_row_num = 1` OR `Full_Opportunity_ID__c IS NULL` | AUM aggregation on open pipeline (`SUM(CASE WHEN is_primary_opp_record = 1 THEN Opportunity_AUM...)`) | Volume counts (use `is_sqo_unique` or `is_joined_unique` instead) |
| `is_sqo_unique` | `is_sqo = 1 AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)` | **SQO volume counts** — ensures one count per opportunity even when multiple leads converted to same opp | Rate calculations (use `is_sqo`) |
| `is_joined_unique` | `is_joined = 1 AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)` | **Joined volume counts** — same dedup logic | Rate calculations (use `is_joined`) |

**Rule**: Volume metrics (scorecard numbers) use `_unique` variants. Conversion rate progression flags use the non-unique variants because the rate is per-record, and the eligibility/progression flags on each record handle correctness.

### Eligibility Flags (cohort mode denominators)

| Field | Logic | Description |
|-------|-------|-------------|
| `eligible_for_contacted_conversions` | `is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL)` | Contacted lead that resolved (became MQL or closed) |
| `eligible_for_contacted_conversions_30d` | Same + `OR (no MQL AND no close AND contacted 30+ days ago)` | **Primary denominator** — includes 30-day effective resolution rule |
| `eligible_for_mql_conversions` | `is_mql = 1 AND (is_sql = 1 OR lead_closed_date IS NOT NULL)` | MQL that resolved (converted or closed) |
| `eligible_for_sql_conversions` | `is_sql = 1 AND (SQO_raw = 'yes' OR StageName = 'Closed Lost')` OR `Full_prospect_id__c IS NULL AND SQO_raw = 'yes'` | SQL that resolved (became SQO or closed lost). Opp-only records (no lead) with SQO also count. |
| `eligible_for_sqo_conversions` | `SQO_raw = 'yes' AND (is_joined = 1 OR StageName = 'Closed Lost')` | SQO that resolved (joined or closed lost) |

### Progression Flags (cohort mode numerators)

| Field | Logic | Description |
|-------|-------|-------------|
| `contacted_to_mql_progression` | `is_contacted = 1 AND is_mql = 1 AND mql_stage_entered_ts IS NOT NULL AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)` | Contacted lead that reached MQL |
| `mql_to_sql_progression` | `is_mql = 1 AND is_sql = 1` | MQL that converted to SQL |
| `sql_to_sqo_progression` | `is_sql = 1 AND SQO_raw = 'yes'` | SQL that became SQO |
| `sqo_to_joined_progression` | `SQO_raw = 'yes' AND is_joined = 1 AND StageName != 'Closed Lost'` | SQO that joined (excludes Closed Lost) |

### Attribution Fields

| Field | Type | Description |
|-------|------|-------------|
| `SGA_Owner_Name__c` | STRING | `COALESCE(Lead.SGA_Owner_Name__c, User lookup of Opp.SGA__c)` — SGA who worked the lead. For opp metrics, also check `Opp_SGA_Name__c`. |
| `Opp_SGA_Name__c` | STRING | Opportunity's SGA (ID from `Opportunity.SGA__c`). Needs User table join for name. |
| `Opp_SGA_User_Name` | STRING | Resolved name from `User` table for `Opp_SGA_Name__c` |
| `SGM_Owner_Name__c` | STRING | From `Opportunity.Opportunity_Owner_Name__c` — the SGM who owns the opp |
| `Original_source` | STRING | `COALESCE(Opp.Final_Source__c, Lead.Final_Source__c, 'Unknown')` — lead source |
| `Finance_View__c` | STRING | `COALESCE(Opp.Finance_View__c, Lead.Finance_View__c, 'Other')` — **canonical channel source** |
| `Channel_Grouping_Name` | STRING | Derived from `Finance_View__c` via CASE: Partnerships→Recruitment Firm, Job Applications→Marketing, Employee/Advisor Referral→Referral, else passthrough |
| `Channel_Grouping_Name_Raw` | STRING | `IFNULL(Finance_View__c, 'Other')` — pre-mapping value |
| `External_Agency__c` | STRING | External recruiting agency name |

### AUM/ARR Fields

| Field | Type | Description |
|-------|------|-------------|
| `Opportunity_AUM` | FLOAT64 | `COALESCE(Underwritten_AUM__c, Amount)` — best available AUM. **Never add these two fields.** |
| `Underwritten_AUM__c` | FLOAT64 | Underwritten AUM estimate (preferred) |
| `Amount` | FLOAT64 | Salesforce standard Amount field (fallback) |
| `Opportunity_AUM_M` | FLOAT64 | `Opportunity_AUM / 1,000,000` rounded to 2 decimals |
| `aum_tier` | STRING | Tier 1 (<$25M), Tier 2 ($25M-$75M), Tier 3 ($75M-$150M), Tier 4 (>$150M) |
| `Actual_ARR__c` | FLOAT64 | Post-join actual ARR (populated after advisor starts producing revenue) |
| `SGM_Estimated_ARR__c` | FLOAT64 | SGM's pre-join ARR estimate |
| `Account_Total_ARR__c` | FLOAT64 | Account-level ARR (from Account table join). Fallback when Actual_ARR not yet populated. |

**ARR COALESCE pattern** (used in SGM Hub): `COALESCE(Actual_ARR__c, SGM_Estimated_ARR__c, Account_Total_ARR__c)`. When `Actual_ARR__c` is NULL, it's pre-revenue and shows `(est)` indicator in UI.

### Status/Stage Fields

| Field | Type | Description |
|-------|------|-------------|
| `StageName` | STRING | Current opportunity stage (Qualifying, Discovery, Sales Process, Negotiating, Signed, On Hold, Closed Lost, Joined) or lead stage |
| `StageName_code` | INT64 | Numeric stage ordering (1=Qualifying through 8=Joined) |
| `SQO_raw` | STRING | Raw `SQL__c` field value (confusing name — means SQO status). 'Yes' = qualified. |
| `TOF_Stage` | STRING | Top-of-funnel stage label (Prospect, Contacted, MQL, SQL, SQO, Joined, Closed). Priority: Closed Lost > Joined > SQO > SQL > MQL > Contacted > Prospect. |
| `Conversion_Status` | STRING | Open, Closed, or Joined |
| `Disposition__c` | STRING | Lead disposition (closed lead without conversion) |
| `Closed_Lost_Reason__c` | STRING | Coalesced from Opp or Lead |
| `Closed_Lost_Details__c` | STRING | Coalesced from Opp or Lead |

### Record Type & Source Fields

| Field | Type | Description |
|-------|------|-------------|
| `recordtypeid` | STRING | `012Dn000000mrO3IAI` = Recruiting, NULL = lead-only rows |
| `record_type_name` | STRING | 'Recruiting', 'Re-Engagement', or 'Unknown' |
| `lead_record_source` | STRING | 'Lead' or 'Re-Engagement' — how the lead-side record was sourced. Use to filter re-engagement in/out of lead-level metrics. |
| `prospect_source_type` | STRING | Same as `lead_record_source` (alias exposed in detail records) |
| `Previous_Recruiting_Opportunity_ID__c` | STRING | For re-engagement: the original recruiting opp that was Closed Lost |

### Re-Engagement Stage Mapping

Re-engagement opportunities (`RecordTypeId = '012VS000009VoxrYAC'`) enter the view via the `ReEngagement_As_Lead` CTE, which maps re-engagement stages onto standard lead column aliases:

| Standard Lead Field | Re-Engagement Analog (SF Opp Field) | Funnel Stage |
|---------------------|--------------------------------------|-------------|
| `stage_entered_contacting__c` | `Stage_Entered_Outreach__c` | Contacted |
| `mql_stage_entered_ts` | `Stage_Entered_Call_Scheduled__c` | MQL |
| `converted_date_raw` | `DATE(Stage_Entered_Re_Engaged__c)` | SQL |
| `stage_entered_new__c` | `COALESCE(Stage_Entered_Planned_Nurture__c, CreatedDate)` | New/Prospect |

**Impact on metrics**: Because these are UNION ALL'd into `All_Leads`, re-engagement records **DO count** in Prospects, Contacted, MQL, and SQL metrics. They are excluded from SQO/Signed/Joined by the `recordtypeid` filter. To exclude from lead-level metrics, filter: `lead_record_source = 'Lead'`.

### Marketing_Segment__c vs Lead_Score_Tier__c — DIFFERENT SYSTEMS

These are **completely separate** and must not be confused:

| | `Marketing_Segment__c` | `Lead_Score_Tier__c` |
|--|----------------------|---------------------|
| **Source** | FinTrx `advisor_segments` table via Hightouch writeback | Native Salesforce lead scoring (V4 XGBoost output) |
| **Values** | CAPTIVE_W2, RIA_OWNER, INDEPENDENT_PLATFORM, OTHER | Career Clock, Prime Movers, Proven Movers, Moderate Bleeders |
| **Purpose** | Paid ads targeting by firm type | Lead quality scoring |
| **In vw_funnel_master?** | **No** — not exposed | **Yes** — passthrough as `Lead_Score_Tier__c` |
| **Dashboard use** | Not referenced | Active — filters, drill-downs, Explore AI |

`Lead_Score_Tier__c` values are Salesforce-native — the dashboard displays and filters on them but does not compute them.

### Cohort Month Fields

| Field | Type | Description |
|-------|------|-------------|
| `filter_date_cohort_month` | STRING | `YYYY-MM` from FilterDate |
| `contacted_cohort_month` | STRING | `YYYY-MM` from stage_entered_contacting__c |
| `mql_cohort_month` | STRING | `YYYY-MM` from mql_stage_entered_ts |
| `sql_cohort_month` | STRING | `YYYY-MM` from converted_date_raw |
| `sqo_cohort_month` | STRING | `YYYY-MM` from Date_Became_SQO__c |
| `joined_cohort_month` | STRING | `YYYY-MM` from advisor_join_date__c |

### Campaign & Experimentation Fields

| Field | Type | Description |
|-------|------|-------------|
| `Campaign_Id__c` | STRING | `COALESCE(Opp.CampaignId, Lead.Campaign__c)` |
| `Lead_Campaign_Id__c` | STRING | Lead's campaign ID |
| `Opp_Campaign_Id__c` | STRING | Opportunity's campaign ID |
| `Campaign_Name__c` | STRING | Resolved campaign name from Campaign table |
| `all_campaigns` | ARRAY<STRUCT<id,name>> | All campaigns the lead/contact is a member of |
| `Experimentation_Tag_Raw__c` | STRING | Semicolon-delimited experiment tags |
| `Experimentation_Tag_List` | ARRAY<STRING> | Parsed experiment tags (for UNNEST filtering) |

### Other Fields

| Field | Type | Description |
|-------|------|-------------|
| `DoNotCall` | BOOL | Lead Do Not Call flag |
| `Lead_Score_Tier__c` | STRING | V4 XGBoost lead scoring tier (see Marketing_Segment vs Lead_Score_Tier section above) |
| `Next_Steps__c` | STRING | Lead next steps text |
| `NextStep` | STRING | Opportunity next step text |

---

## vw_forecast_p2 (25 columns)

| Field | Type | Description |
|-------|------|-------------|
| `run_date` | DATE | `CURRENT_DATE()` at query time |
| `Full_Opportunity_ID__c` | STRING | Opportunity ID |
| `advisor_name` | STRING | Display name |
| `salesforce_url` | STRING | SFDC link |
| `SGM_Owner_Name__c` | STRING | SGM owner |
| `SGA_Owner_Name__c` | STRING | SGA associated |
| `StageName` | STRING | Current stage |
| `days_in_current_stage` | INT64 | Days since entering current stage |
| `Opportunity_AUM` | FLOAT64 | Raw AUM |
| `Opportunity_AUM_M` | FLOAT64 | AUM in millions |
| `aum_tier` | STRING | 4-tier classification |
| `is_zero_aum` | INT64 | 1 if AUM is null or 0 |
| `p_join` | FLOAT64 | Probability of joining (product of remaining stage rates) |
| `expected_days_remaining` | INT64 | Estimated days until join (can be 0) |
| `model_projected_join_date` | DATE | Model-computed join date |
| `Earliest_Anticipated_Start_Date__c` | DATE | SGM's anticipated date |
| `final_projected_join_date` | DATE | `COALESCE(anticipated, model)` — used for quarter assignment |
| `date_source` | STRING | 'Anticipated' or 'Model' |
| `rate_sqo_to_sp` | FLOAT64 | Historical rate (NULL if stage past this) |
| `rate_sp_to_neg` | FLOAT64 | Historical rate |
| `rate_neg_to_signed` | FLOAT64 | Historical rate |
| `rate_signed_to_joined` | FLOAT64 | Historical rate (always populated) |
| `stages_remaining` | INT64 | Count of stages left to Joined |
| `projected_quarter` | STRING | e.g. "Q2 2026" |
| `expected_aum_weighted` | FLOAT64 | `Opportunity_AUM * p_join` |

---

## vw_lost_to_competition (12 columns)

| Field | Type | Description |
|-------|------|-------------|
| `opportunity_id` | STRING | SFDC Opportunity ID |
| `sfdc_url` | STRING | SFDC link |
| `opportunity_name` | STRING | Advisor name |
| `crd` | STRING | Central Registration Depository number |
| `original_firm` | STRING | Firm at time of recruitment |
| `sqo_date` | TIMESTAMP | When deal became SQO |
| `closed_lost_date` | DATE | When deal was closed lost |
| `new_firm_start_date` | DATE | When advisor started at new firm (from FinTrx) |
| `months_to_move` | FLOAT64 | Months between closed_lost and new_firm_start |
| `moved_to_firm` | STRING | **The competitor firm** — canonical field for competitive analysis |
| `closed_lost_reason` | STRING | Why the deal was lost |
| `closed_lost_details` | STRING | Additional details |

---

## vw_joined_advisor_location (29 columns)

| Field | Type | Description |
|-------|------|-------------|
| Core identifiers | STRING | `primary_key`, `Full_Opportunity_ID__c`, `Full_prospect_id__c`, `advisor_name` |
| `advisor_join_date__c` | DATE | Join date |
| `StageName` | STRING | Current stage |
| `Opportunity_AUM` | FLOAT64 | Deal AUM |
| `SGA_Owner_Name__c`, `SGM_Owner_Name__c` | STRING | Attribution |
| `Original_source`, `Channel_Grouping_Name` | STRING | Source/channel |
| `recordtypeid`, `record_type_name` | STRING | Record type |
| Address fields | STRING | `address_street_1`, `address_street_2`, `address_city`, `address_state` (normalized to 2-letter abbrev), `address_postal`, `address_country` |
| `address_source` | STRING | 'Contact', 'FinTrx', 'Account', or 'Unknown' — which system provided the address |
| `sfdc_lat`, `sfdc_long` | FLOAT64 | SFDC native geocoding (usually NULL) |
| `address_lat`, `address_long` | FLOAT64 | `COALESCE(sfdc_lat, geocoded_lat)` — best available coords |
| `coord_source` | STRING | 'SFDC' or 'Geocoded' |
| `has_full_address`, `has_address` | BOOL | Coverage flags |
| `geocode_accuracy`, `geocoded_at` | STRING/TIMESTAMP | Geocode metadata |

---

## vw_daily_forecast (9 columns)

| Field | Type | Description |
|-------|------|-------------|
| `date_day` | DATE | Calendar date |
| `original_source` | STRING | Source for this row's goal allocation |
| `channel_grouping_name` | STRING | Channel for this row's goal allocation |
| `prospects_daily` | FLOAT64 | Daily prospect target |
| `mqls_daily` | FLOAT64 | Daily MQL target |
| `sqls_daily` | FLOAT64 | Daily SQL target |
| `sqos_daily` | FLOAT64 | Daily SQO target |
| `joined_daily` | FLOAT64 | Daily joined target |
| `quarter_key` | STRING | Quarter label (e.g., "Q1 2026") |

---

## vw_funnel_audit (51 columns)

Key fields (see vw_forecast_p2 for overlapping fields):

| Field | Type | Description |
|-------|------|-------------|
| `cohort_month` | STRING | Opp creation month |
| `days_to_sqo` | INT64 | Days from opp creation to SQO |
| `eff_sp_ts`, `eff_neg_ts`, `eff_signed_ts`, `eff_joined_ts` | TIMESTAMP | Effective stage timestamps (COALESCE with later stages) |
| `days_in_sp`, `days_in_negotiating`, `days_in_signed` | INT64 | Days spent in each stage |
| `days_total_sqo_to_joined` | INT64 | Total velocity from SQO to Joined |
| `days_in_current_stage` | INT64 | Days in current stage |
| `stages_skipped` | INT64 | Number of stages bypassed |
| `SP_Numerator/Denominator` through `Joined_Numerator/Denominator` | INT64 | Stage-level conversion numerators/denominators |
| `as_of_date` | DATE | Snapshot date |
