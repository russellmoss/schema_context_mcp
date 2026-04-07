# Fixture Contract Checklist — Frozen

> **Status:** FROZEN. This document defines the authoritative YAML shapes for true-north and golden-results fixtures.
> If a later phase needs to change a contract, it must update this checklist first and document the reason.

---

## true-north.yaml

Top-level key: `true_north` (array)

### Entry fields

| Key | Required | Type | Constraint |
|---|---|---|---|
| `id` | Yes | string | Unique, convention: `<team>_<period>_<metric_type>` |
| `period` | Yes | string | Human-readable period (e.g., `"Q1 2025"`, `"2025-01"`) |
| `type` | Yes | string | Metric category name (team-defined) |
| `expected` | Yes | object | Key-value pairs: metric name → number |
| `source` | Yes | string | Must be `"business_approved"` |
| `owner` | Yes | string | Team or person who approved the number |
| `last_verified` | Yes | string | Date of last human verification (`YYYY-MM-DD`) |
| `notes` | No | string | Additional context |

### Value constraints

- `expected` values must be numbers (integer or float)
- `last_verified` must be a valid date string in `YYYY-MM-DD` format
- `source` must always be `"business_approved"` for true-north fixtures
- `owner` should identify a team or named individual, not "system" or "auto"

### Tolerance rules (for online comparison)

| Value type | Default tolerance | Example |
|---|---|---|
| Rates / percentages (0-1 range) | ±0.01 | `0.648` matches `0.64` to `0.66` |
| Counts (integers) | Exact match | `187` must equal `187` |
| Currency / large numbers | ±1% | `472900000` matches `468171000` to `477629000` |

---

## golden-results.yaml

Top-level key: `golden` (array)

### Entry fields

| Key | Required | Type | Constraint |
|---|---|---|---|
| `id` | Yes | string | Unique descriptive identifier |
| `period` | Yes | string | Human-readable period |
| `type` | Yes | string | Fixture type / metric category |
| `expected` | Yes | object | Key-value pairs: metric name → number |

### Optional annotation fields

| Key | Required | Type | Description |
|---|---|---|---|
| `queried_from` | No | string | Source view name |
| `queried_date` | No | string | Date the value was queried (`YYYY-MM-DD`) |

### Value constraints

- `expected` values must be numbers (integer or float)
- Golden results are NOT business-approved — they are snapshots for regression detection
- Golden results should be updated when the warehouse legitimately changes

### Comparison rules (for online regression)

| Value type | Default tolerance | Notes |
|---|---|---|
| Rates / percentages | ±0.01 | Same as true-north |
| Counts | Exact match | Flag any difference |
| Currency / large numbers | ±1% | Flag for investigation if exceeded |

---

## Difference between true-north and golden-results

| Property | True-North | Golden Results |
|---|---|---|
| **Approval** | Business-approved by named owner | Developer snapshot, no approval |
| **Purpose** | Promotion gate — blocks L2+ if failing | Regression detection — flags drift |
| **Update frequency** | Rarely — only when business re-verifies | Whenever warehouse legitimately changes |
| **Required fields** | `source`, `owner`, `last_verified` required | Only `id`, `period`, `type`, `expected` |
| **Failure severity** | Blocks promotion | Warning — investigate but don't block |

---

## Validation Rules

1. All `id` fields must be unique within each fixture file
2. All `expected` values must be numeric (not strings, not null)
3. True-north entries must have `source: "business_approved"`
4. True-north entries must have a valid `last_verified` date
5. True-north entries must have a non-empty `owner`
6. Golden-result entries should include inline comments noting query source and date (convention, not enforced)
