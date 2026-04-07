# BigQuery Activity Layer — Task Object & SGA Activity View

> **Created**: 2026-03-31 | **Source**: `views/vw_sga_activity_performance_v2.sql` (488 lines)
> **Purpose**: Reference for the activity data model — Task linkage, direction classification, channel categorization, automation exclusions, and attribution patterns.

---

## Source Tables & Views

| Table/View | Dataset | Purpose |
|---|---|---|
| `SavvyGTMData.Task` | Raw Salesforce Task records | Every logged activity (call, SMS, email, LinkedIn, etc.) |
| `SavvyGTMData.User` | User table | Joined to get executor name, IsSGA__c, IsActive |
| `Tableau_Views.vw_funnel_master` | Lead/Opp funnel | Joined to get prospect context, SGA assignment, funnel flags |
| **`Tableau_Views.vw_sga_activity_performance`** | **The activity view** | Enriched, deduplicated tasks with channel/direction classification |

**Sync cadence**: Task table syncs every 6 hours via BQ Data Transfer Service.

**BQ view name**: `vw_sga_activity_performance` (no v2 suffix, despite the local SQL file being `vw_sga_activity_performance_v2.sql`).

---

## Task → Lead/Opportunity Linkage

### How Tasks Connect to Prospects

```sql
LEFT JOIN vw_funnel_master f
  ON (t.WhoId = f.Full_prospect_id__c OR t.WhatId = f.Full_Opportunity_ID__c)
```

- **`WhoId`** (`task_who_id`): Links to the **Lead** — `Full_prospect_id__c` in funnel master
- **`WhatId`** (`task_what_id`): Links to the **Opportunity** — `Full_Opportunity_ID__c` in funnel master
- A single Task can match BOTH paths (e.g., a call logged against a Lead that also has an Opportunity)

### Deduplication Logic

When a task matches both Lead and Opportunity, the view deduplicates:

```sql
ROW_NUMBER() OVER (
  PARTITION BY Id
  ORDER BY
    CASE WHEN WhoId = Full_prospect_id__c THEN 1 ELSE 2 END,  -- Prefer Lead match
    CASE WHEN Full_prospect_id__c IS NOT NULL AND Full_Opportunity_ID__c IS NOT NULL THEN 1 ELSE 2 END
) AS row_rank
-- WHERE row_rank = 1
```

**Rule**: Lead match (WhoId) wins over Opportunity match (WhatId). If both are Lead matches, prefer the record with more complete data.

### Implications for Queries

- **Use `Full_prospect_id__c` from the activity view** (not `task_who_id`) when joining to funnel master. The view has already resolved the dual linkage.
- Using `task_who_id` directly **misses activities logged against the Opportunity** (e.g., post-conversion activities). Validated: 161 converted leads had activity only via WhatId in Q1 2026.
- Orphan tasks (no funnel master match) have `Full_prospect_id__c IS NULL` — filter these out for SGA-specific analysis.

### Base Filters (Applied in the View)

```sql
WHERE t.IsDeleted = FALSE
  AND t.Subject NOT LIKE '%Step skipped%'
```

---

## Key Fields in vw_sga_activity_performance

### Identifiers & Dates

| Field | Type | Description |
|---|---|---|
| `task_id` | STRING | Task.Id from Salesforce |
| `task_created_date_utc` | TIMESTAMP | Task.CreatedDate (UTC) |
| `task_created_date_est` | **DATE** | `DATE(CreatedDate, 'America/New_York')` — **primary date field for queries** |
| `task_created_datetime_est` | DATETIME | Full datetime in EST |
| `activity_hour_est` | INT64 | Hour of day (0-23) in EST |
| `activity_day_of_week` | STRING | Day name (Monday, Tuesday, etc.) |
| `task_status` | STRING | Task.Status |
| `task_subject` | STRING | Task.Subject — **primary field for channel/direction classification** |
| `task_type` | STRING | Task.Type (e.g., "Call", "Incoming SMS") |
| `task_subtype` | STRING | Task.TaskSubtype (e.g., "Call", "LinkedIn", "ListEmail", "Email", "Event") |
| `call_duration_seconds` | INT64 | Task.CallDurationInSeconds (NULL for non-calls) |
| `task_who_id` | STRING | Task.WhoId — Lead ID |
| `task_what_id` | STRING | Task.WhatId — Opportunity ID |

### Executor (Who Performed the Activity)

| Field | Type | Description |
|---|---|---|
| `task_executor_name` | STRING | `User.Name` joined via `Task.OwnerId = User.Id` — the person who logged/performed the activity |
| `task_executor_id` | STRING | `User.Id` — stable ID for the executor |
| `task_executor_created_date` | TIMESTAMP | When the executor's User record was created |
| `activity_ramp_status` | STRING | `'On Ramp'` if within 30 days of executor_created_date, else `'Post-Ramp'` |

### Lead/Opp Context (From Funnel Master)

| Field | Type | Description |
|---|---|---|
| `SGA_Owner_Name__c` | STRING | The SGA who **owns the lead** (from funnel master, not from the Task) |
| `sgm_name` | STRING | SGM who owns the opportunity |
| `SGA_IsSGA__c` | BOOL | Whether the lead owner is flagged as SGA in User table |
| `SGA_IsActive` | BOOL | Whether the lead owner is currently active |
| `Full_prospect_id__c` | STRING | Lead ID (resolved from dual join — use this for lead-level queries) |
| `Full_Opportunity_ID__c` | STRING | Opportunity ID |
| `advisor_name` | STRING | Prospect/advisor display name |
| `is_contacted`, `is_mql`, `is_sql`, `is_sqo`, `is_joined` | INT64 | Funnel flags (COALESCEd to 0 for NULL) |

---

## Direction Classification (Outbound vs Inbound)

**Field**: `direction` (STRING)

```sql
CASE
  WHEN Type LIKE 'Incoming%'
    OR Subject LIKE '%Incoming%'
    OR Subject LIKE '%Inbound%'
    OR Subject LIKE 'Submitted Form%'
  THEN 'Inbound'
  ELSE 'Outbound'
END AS direction
```

**Inbound indicators** (4 patterns):
1. `Type LIKE 'Incoming%'` — e.g., "Incoming SMS"
2. `Subject LIKE '%Incoming%'` — e.g., "Incoming Call from..."
3. `Subject LIKE '%Inbound%'` — e.g., "Inbound Call"
4. `Subject LIKE 'Submitted Form%'` — marketing form submissions

**Everything else is Outbound** — this is a catch-all. Most outbound activities are SMS, calls, LinkedIn messages, and manual emails, but system notes and admin tasks also land here unless they match an inbound pattern.

**Important**: The direction field is a **binary classification** (Inbound/Outbound only). There is no "System" or "Unknown" bucket. For SGA outbound effort analysis, always combine `direction = 'Outbound'` with channel and automation filters (see below).

---

## Channel Classification

Two levels of granularity:

### `activity_channel` (Detailed — 10 values)

| Value | Detection Logic |
|---|---|
| `Marketing` | `Subject LIKE 'Submitted Form%' OR Subject LIKE '%HubSpot%'` |
| `SMS` | `Type LIKE '%SMS%' OR Subject LIKE '%SMS%' OR Subject LIKE '%Text%'` |
| `LinkedIn` | `Subject LIKE '%LinkedIn%' OR TaskSubtype = 'LinkedIn' OR Subject LIKE '%LI %'` |
| `Call` | `Type = 'Call' OR TaskSubtype = 'Call' OR Subject LIKE '%Call%/%answered%/%Left VM%/%Voicemail%' OR Subject LIKE 'missed:%'` |
| `Email (Blast)` | `Subject LIKE 'Sent Savvy raised%'` |
| `Email (Engagement)` | `Subject LIKE '%Clicked on link%'` — tracking events, NOT SGA effort |
| `Email (Campaign)` | `Subject LIKE '%[lemlist]%' OR TaskSubtype = 'ListEmail'` |
| `Email (Manual)` | `Type = 'Email' OR TaskSubtype = 'Email' OR Subject LIKE 'Email:%' OR Subject LIKE 'Sent %'` |
| `Meeting` | `TaskSubtype = 'Event' OR Subject LIKE '%Meeting%/%In Person%/%Zoom%/%Demo%'` |
| `Other` | Everything else |

**Priority**: The CASE waterfall means earlier matches win. SMS is checked before Call, so "Incoming SMS" hits SMS first.

### `activity_channel_group` (High-Level — 7 values)

| Value | What it combines |
|---|---|
| `Marketing` | Form submissions, HubSpot |
| `SMS` | All SMS (outbound + inbound) |
| `LinkedIn` | All LinkedIn activity |
| `Call` | All calls (cold, scheduled, inbound) |
| `Email (Engagement)` | Click tracking events only |
| `Email` | Manual + Campaign + Blast emails (consolidated) |
| `Meeting` | Video calls, in-person, demos |
| `Other` | Fallback |

---

## Automation & Engagement Exclusion Patterns

When counting **SGA outbound effort** (not automated sends or tracking events), apply these filters:

```sql
WHERE direction = 'Outbound'
  AND is_engagement_tracking = 0                          -- Exclude email click events
  AND COALESCE(task_subject, '') NOT LIKE '%[lemlist]%'   -- Exclude lemlist campaigns
  AND COALESCE(task_subtype, '') != 'ListEmail'           -- Exclude Salesforce list emails
```

### What Each Excludes

| Filter | What it catches | Why exclude |
|---|---|---|
| `is_engagement_tracking = 0` | `Subject LIKE '%Clicked on link%'` | Email open/click tracking events — not SGA effort |
| `NOT LIKE '%[lemlist]%'` | Lemlist campaign emails | Automated drip sequences — not manual SGA outreach |
| `!= 'ListEmail'` | Salesforce list email sends | Bulk sends — not personalized SGA effort |

**Source**: `src/lib/queries/sga-activity.ts:117-123` (`getAutomatedFilter()`)

### What Remains After Filtering (Q1 2026 Validated)

| Channel | Outbound Activities | % of Total |
|---|---|---|
| SMS | 74,440 | 88.3% |
| LinkedIn | 4,329 | 5.1% |
| Call | 3,596 | 4.3% |
| Email (Manual) | 1,639 | 1.9% |
| Other | 200 | 0.2% |

---

## Attribution: task_executor_name vs SGA_Owner_Name__c

These are **different fields** measuring **different things**:

| Field | Meaning | Source |
|---|---|---|
| `task_executor_name` | The person who **performed/logged the activity** | `User.Name` via `Task.OwnerId` |
| `SGA_Owner_Name__c` | The SGA who **owns the lead** | `vw_funnel_master` (from Lead object) |

### When They Differ

Validated in Q1 2026: **3.8% of outbound activities** (3,488 of 91,174) have `task_executor_name != SGA_Owner_Name__c`. At the lead level, **2.1% of leads** (600 of 28,618) have activity from >1 distinct executor.

**Common reasons for mismatch**:
- Lead reassignment (Lead was with SGA A, recycled to SGA B — B's activities show under A's lead)
- Team coverage (SGA A covers for SGA B during PTO)
- SGM or ops making calls on an SGA's lead

### Which to Use

| Analysis Type | Use This Field | Why |
|---|---|---|
| Lead-level metrics (persistence, coverage) | `SGA_Owner_Name__c` | Consistent with dashboard SGA filters |
| Individual effort measurement (OKR) | `task_executor_name` | Measures actual work performed |
| Team-level OKR baselines | Either — delta is ~0.2pp | Immaterial at team level |

---

## Quality Signals

| Field | Type | Logic | Description |
|---|---|---|---|
| `is_meaningful_connect` | INT64 | Incoming SMS = 1, Subject LIKE '%answered%' (not missed) = 1, CallDuration > 120s = 1 | A real two-way interaction occurred |
| `is_marketing_activity` | INT64 | `Subject LIKE 'Submitted Form%' OR executor_name = 'Savvy Marketing'` | Marketing-sourced, not SGA effort |
| `is_cold_call` | INT64 | Outbound call, not on scheduled call date | Any unscheduled outbound call |
| `is_true_cold_call` | INT64 | First outbound call to prospect, pre-MQL or re-engagement (180d+ post-close), not on scheduled date, valid linkage, not self-reference | Strict cold call definition |
| `call_type` | STRING | `'Cold Call'`, `'Scheduled Call'`, `'Inbound Call'`, or `'Not a Call'` | Call classification |
| `cold_call_quality` | STRING | Explains why a call is/isn't a true cold call | Debugging/audit field |

---

## Known Data Quality Issues

### "Ghost Contacts" — Contacted Stage with 0 Tracked Touches

**Discovered**: 2026-03-31 during SGA lead handling analysis.

In Q1 2026 (Jan 1 – Mar 9 cohort): **1,656 leads** have `is_contacted = 1` (meaning `stage_entered_contacting__c IS NOT NULL` in funnel master) but **zero outbound touchpoints** in `vw_sga_activity_performance` (after standard filters).

Breakdown:
- 1,347 of these are closed (lead_closed_date IS NOT NULL)
- 309 are still open

**Probable causes**:
1. Outreach via untracked channels (personal cell phones, unsynced dialers)
2. Manual stage advancement without logging activity in Salesforce
3. Activity logging in a format that doesn't match any channel classification pattern

**Impact**: The coverage gap metric (Metric 3 in SGA lead handling analysis) includes these. They should not be treated as "never contacted" — they may have been contacted but the activity wasn't tracked.

**Status**: Flagged for RevOps investigation. Not yet resolved.

---

## Common Query Patterns

### Counting Outbound SGA Effort per Lead

```sql
SELECT
  act.Full_prospect_id__c AS lead_id,
  COUNT(DISTINCT act.task_id) AS outbound_touchpoints
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
WHERE act.direction = 'Outbound'
  AND act.is_engagement_tracking = 0
  AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
  AND COALESCE(act.task_subtype, '') != 'ListEmail'
  AND act.Full_prospect_id__c IS NOT NULL
  AND act.task_created_date_est >= DATE('2026-01-01')
  AND act.task_created_date_est < DATE('2026-04-01')
GROUP BY 1
```

### Detecting Inbound Replies (Any Channel)

```sql
SELECT DISTINCT act.Full_prospect_id__c AS lead_id
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
WHERE act.direction = 'Inbound'
  AND COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')
  AND act.Full_prospect_id__c IS NOT NULL
  AND act.task_created_date_est >= DATE('2026-01-01')
  AND act.task_created_date_est < DATE('2026-04-01')
```

**Why exclude Marketing**: Form submissions (`Submitted Form%`) are marketing-generated inbound events, not prospect replies to SGA outreach.

### Aligning Activities to Lead Cohort (No Pre-Cohort Leakage)

When counting activities for a lead cohort, always bound activity dates to **on or after the lead's FilterDate**:

```sql
INNER JOIN activity_view act
  ON act.Full_prospect_id__c = q.lead_id
  AND act.task_created_date_est >= q.filter_date  -- No pre-cohort leakage
  AND act.task_created_date_est < DATE('2026-04-01')
```

Validated in Q1 2026: 3,162 outbound activities (4.4%) occurred before the lead's FilterDate. Without this filter, touchpoint counts are inflated.

---

## Lead Closed Indicators (For Activity Analysis)

When identifying leads that are "closed lost" (not converted) at the lead level:

| Field | Type | What It Means |
|---|---|---|
| `lead_closed_date` | TIMESTAMP | `Stage_Entered_Closed__c` on the Lead — when the lead was closed |
| `Disposition__c` | STRING | Why the lead was closed (see values below) |
| `Conversion_Status` | STRING | `'Open'`, `'Closed'`, or `'Joined'` |

### Common Disposition Values (Q1 2026)

| Disposition | Count | SGA Controllable? |
|---|---|---|
| No Response | 3,022 | Yes — SGA gave up |
| Auto-Closed by Operations | 2,414 | No — system/ops cleanup |
| Not Interested in Moving | 1,870 | Partially — may have been after contact |
| Not a Fit | 442 | Yes — SGA qualified out |
| Bad Contact Info - Uncontacted | 317 | No — can't reach |
| Other/Various | ~400 | Mixed |

**For abandonment/persistence analysis**: Consider excluding "Bad Contact Info" and "Auto-Closed by Operations" from SGA-accountability metrics, as these are not SGA-controllable outcomes.
