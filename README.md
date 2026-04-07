# schema-context-mcp

**Your AI agents are writing bad SQL because they don't know your data.**
This fixes that.

---

schema-context-mcp is an [MCP server](https://modelcontextprotocol.io/) that gives AI agents the business context they need to work with your data warehouse correctly — live schema, field gotchas, metric definitions, and all the tribal knowledge that usually lives in someone's head (or a 3,000-line markdown file nobody updates).

Instead of dumping docs into a context window and hoping for the best, your agents make targeted tool calls and get back structured, provenance-tagged answers. Every response tells you *where* the information came from and *how much to trust it*.

```
Agent: "I need to count SQOs by channel"

describe_view({ view: "vw_funnel_master", intent: "count_sqos" })

> purpose: "Single source of truth for recruiting funnel"
> intent_warnings:
>   - "Use is_sqo_unique = 1, NOT is_sqo = 1"
>   - "Add recordtypeid filter to exclude re-engagement"
> dangerous_columns: [is_sqo, is_primary_opp_record]
```

The agent gets the warnings *before* writing a single line of SQL. No more double-counted metrics. No more missing filters. No more "why does this number look wrong?"

## Table of Contents

- [Quick Start](#quick-start)
- [What It Does](#what-it-does)
- [The Tools](#the-tools)
- [Config in 5 Minutes](#config-in-5-minutes)
- [Works With dbt](#works-with-dbt)
- [Trust Model](#trust-model)
- [Eval Framework](#eval-framework)
- [CLI Commands](#cli-commands)
- [Where This Fits](#where-this-fits)
- [What's Not in v1](#whats-not-in-v1)
- [Origin Story](#origin-story)

## Quick Start

### Install

```bash
npm install -g @mossrussell/schema-context-mcp
```

### Add to Claude Code

Drop this in your `.mcp.json`:

```json
{
  "mcpServers": {
    "schema-context": {
      "command": "npx",
      "args": ["-y", "@mossrussell/schema-context-mcp"],
      "env": {
        "WAREHOUSE_CONNECTOR": "bigquery",
        "BIGQUERY_PROJECT": "your-project-id",
        "BIGQUERY_KEY_FILE": "/path/to/service-account.json",
        "SCHEMA_CONFIG": "./config/schema-config.yaml"
      }
    }
  }
}
```

### Three ways to get started

**Option A: Automated onboarding (recommended)**

Already have warehouse docs? Let the onboarding command do the heavy lifting:

```bash
npx schema-context-mcp onboard \
  --project your-gcp-project \
  --dataset your_dataset \
  --docs ./my-docs/ \
  --team myteam
```

This scaffolds your project, checks connectivity, bootstraps config from your existing docs, and generates starter eval cases. See the full [onboarding guide](docs/onboarding-guide.md).

**Option B: Have dbt?**

Point `manifest_path` at your dbt artifacts. Add native config only for the stuff dbt can't express (like "use this field, not that one").

**Option C: Start from scratch**

Just set `connection` in your config. The MCP returns live schema immediately. Add annotations as your agents make mistakes — you'll know exactly what to add because the mistakes will tell you.

## What It Does

Your agents currently learn about your warehouse by reading static docs — field dictionaries, view registries, query pattern guides. Those docs go stale, eat up context window, and can't validate themselves against reality.

schema-context-mcp replaces that entire pattern:

| Instead of... | Agents now... |
|---|---|
| Reading a 500-line view registry | Call `describe_view` and get live, annotated schema |
| Searching a field dictionary | Call `resolve_term` for instant domain vocabulary lookup |
| Memorizing query anti-patterns | Call `lint_query` to catch mistakes before execution |
| Guessing at metric definitions | Call `get_metric` for exact formulas and mode guidance |
| Wondering if docs are current | Call `health_check` to see drift in seconds |

Every response includes **provenance** (where the info came from) and **confidence** (how much to trust it). No more "I think this field means..." — now it's "this field means X, sourced from your config, confidence: high."

### Real-world scenarios

**Agent writes a query** — calls `describe_view` with intent, gets warnings and filters before writing SQL. Correct on first attempt.

**Agent already drafted a query** — calls `lint_query`, catches the dedup flag mistake and missing filter before execution.

**Your team changed the schema** — run `health_check`, see 2 new unannotated fields and 1 stale annotation. Fix it in 30 seconds.

**New analyst joins** — calls `resolve_term("SQO")` and `describe_view`, immediately productive without reading five internal docs.

**Agent plans a feature** — calls `describe_view` to see consumers and dependencies, understands blast radius before writing code.

## The Tools

### `describe_view` — the big one

Call this before writing SQL. Returns purpose, grain, key filters, dangerous columns, and annotated fields — merged from all sources.

The optional `intent` parameter is where it gets smart. Tell it *what you're trying to do* and it surfaces the most relevant warnings upfront:

```
describe_view({ view: "vw_funnel_master", intent: "count_sqos" })

> purpose: "Single source of truth for recruiting funnel"
> grain: "One row per lead-opportunity combination"
> intent_warnings:
>   - "Use is_sqo_unique = 1, NOT is_sqo = 1"
>   - "Add recordtypeid filter to exclude re-engagement"
> dangerous_columns: [is_sqo, is_primary_opp_record]
> key_filters, annotated_columns, recommended_date_fields...
```

Even without intent, agents still get dangerous columns and key filters on first glance.

Where configured, it also returns **consumers and dependencies** — so agents can reason about blast radius, not just query correctness.

### `get_metric` — metric definitions done right

```
get_metric({ metric: "sql_to_sqo", mode: "cohort" })

> numerator: "sql_to_sqo_progression"
> denominator: "eligible_for_sql_conversions"
> gotcha: "Recent cohorts look low — deals still in flight"
```

Computation logic, mode guidance (cohort vs. period), and stage-specific rules — all in one call.

### `lint_query` — catch mistakes before they run

Lightweight SQL linting against your configured rules. Three categories:

- **Banned substrings** — patterns that should never appear
- **Preferred field substitutions** — "you used X, consider Y"
- **Required companion filters** — "you queried X without Y"

Substring-based, no AST parsing. Honest about its confidence levels. Treats results as guidance, not gospel.

### `resolve_term` — domain vocabulary lookup

What does "SQO" mean? What fields are related? Any gotchas?

### `get_rule` — named query rules

Validated WHERE clauses, required companion filters, context-specific patterns — all retrievable by ID or search.

### `list_views` — what's in the warehouse?

Discovers all views and tables. Flags which ones have annotations available.

### `health_check` — is your config still accurate?

Detects drift between your config and the live warehouse:

```
health_check()

> "2 unannotated fields, 1 stale annotation, 0 broken references"
> suggestion: "annotate quarterly_goal_id and sgm_territory"
```

## Config in 5 Minutes

The config file is where you teach the system your business logic. It's YAML, it's short, and you only write what your schema alone can't express.

```yaml
# Connect to your warehouse
connection:
  connector: bigquery
  project: your-project
  datasets: [analytics]

# Optional: pull in dbt descriptions automatically
dbt:
  manifest_path: ./target/manifest.json

# Teach the system about tricky fields
fields:
  is_sqo_unique:
    meaning: "Use for SQO volume counts"
    use_instead_of: "is_sqo"

  total_price:
    meaning: "Includes tax and shipping"
    use_instead_of: "subtotal_price"

# Document your views
views:
  orders_master:
    purpose: "Single source of truth for order metrics"
    grain: "One row per order"
    key_filters:
      active_orders: "status != 'cancelled'"
    dangerous_columns: [legacy_total]
    consumers: ["dashboard/revenue.ts", "reports/weekly-summary"]

# Define rules agents should follow
rules:
  - id: no_old_join
    type: ban_pattern
    pattern: "old_mapping_table"
    severity: error
    message: "Deprecated. Use Channel_Grouping_Name directly."

  - id: dedup_filter
    type: prefer_field
    found: "is_sqo"
    prefer: "is_sqo_unique"
    context: "volume counts"
    severity: error

  - id: record_type_guard
    type: require_filter
    when_contains: ["is_sqo", "is_joined"]
    required: "recordtypeid = '012Dn000000mrO3IAI'"
    severity: warning

# Define business vocabulary
terms:
  SQO: "Sales Qualified Opportunity"
  AUM: "Assets Under Management"
```

That's it. A production-scale example lives in [`examples/savvy-wealth.yaml`](examples/savvy-wealth.yaml).

### v1 rule types

| Type | What it catches | Example |
|---|---|---|
| `ban_pattern` | Substrings that should never appear | Deprecated table names |
| `prefer_field` | "You used X, use Y instead" | Wrong dedup flag |
| `require_filter` | "You queried X without required filter Y" | Missing record-type exclusion |
| `date_type_rule` | DATE vs TIMESTAMP mismatches | Wrong wrapper function |

## Works With dbt

If your team already maintains dbt descriptions, meta, and semantic models — great, schema-context-mcp ingests them automatically. Native config fills only the gaps that dbt can't express:

- "Use `is_sqo_unique`, not `is_sqo`" — dbt has no "use instead of" semantics
- "Never add `Underwritten_AUM__c + Amount`" — dbt doesn't express banned computation patterns
- "SQO queries require a `recordtypeid` filter" — dbt doesn't have required companion filters
- Intent-aware warnings routed to agents at query time

**Resolution priority:** native config > dbt meta > dbt description > warehouse description. Each source is tagged in every response so you always know what came from where.

## Trust Model

Every single annotation in every response carries two pieces of metadata:

**Provenance** — where it came from:
| Source | Meaning |
|---|---|
| `native_config` | Human-written annotation from your config |
| `dbt_meta` | From dbt manifest `meta` field |
| `dbt_description` | From dbt manifest `description` field |
| `warehouse_description` | Column description set in BigQuery |
| `live_schema` | Column exists but has zero annotations |

**Confidence** — how much to trust it:
| Level | Meaning |
|---|---|
| `high` | Human annotation confirmed by live schema |
| `medium` | Automated source or partial annotation |
| `low` | No annotation — just the column name and type |

No black boxes. No "the AI said so." You and your agents can see exactly where every piece of information came from and make informed decisions about trust.

## Eval Framework

schema-context-mcp ships with a built-in evaluation harness so you can *prove* your config works before going to production.

### Three tracks

**Track A — SQL correctness.** Does the agent write correct SQL using only MCP context? Checks for required patterns and banned patterns against reference queries.

**Track B — Knowledge retrieval.** Does the MCP return accurate answers to direct questions? Tests tool responses against golden assertions derived from your docs.

**Track C — Workflow replacement.** Can agents complete full workflows (analysis plans, feature scoping) using only MCP context, matching doc-based quality?

### Test case format

```yaml
id: count-active-orders
request: "Count active orders by region for Q1"
difficulty: basic

required_patterns:
  - pattern: "status != 'cancelled'"
    rule: active_filter

banned_patterns:
  - pattern: "legacy_total"
    rule: deprecated_field

knowledge_assertions:
  - question: "What is the correct dedup filter?"
    expected: "is_unique_order = 1"
```

### When something fails, you know exactly why

| Category | Meaning | What to fix |
|---|---|---|
| `config_gap` | Knowledge missing from config | Add an annotation |
| `surfacing_failure` | Knowledge exists but wasn't returned | Adjust intent routing |
| `evaluator_strict` | Evaluator flagged something acceptable | Relax the test case |
| `agent_reasoning` | Agent had the context, just reasoned wrong | Not your problem |

### Running evals

```bash
npx @mossrussell/schema-context-mcp eval \
  --cases ./tests/cases/ \
  --config ./config/schema-config.yaml
```

Sample test cases ship in `tests/cases/`. See the [onboarding guide](docs/onboarding-guide.md) for the full protocol.

### First-deploy hardening

The recommended deployment pattern:

1. **Bootstrap** — generate initial config from your existing docs
2. **Run three-track evals** — see what passes and what doesn't
3. **Categorize failures** — each one tells you exactly what to fix
4. **Apply targeted fixes** — add missing annotations, adjust routing, relax tests
5. **Re-run until stable** — repeat until the suite passes twice consecutively
6. **Archive legacy docs** — only after evals prove the MCP covers everything

## CLI Commands

| Command | What it does |
|---|---|
| `npx schema-context-mcp` | Start the MCP server |
| `npx schema-context-mcp onboard --project <id> --dataset <name> [--docs <dir>]` | Full onboarding: scaffold + bootstrap + starter evals |
| `npx schema-context-mcp bootstrap --docs <dir> --project <id> --dataset <name>` | Generate draft config from existing docs |
| `npx schema-context-mcp eval --cases <dir> --config <path> [--online]` | Run the eval suite |
| `npx schema-context-mcp refine --config <path> --cases <dir> [--auto-approve]` | Iterative refinement loop: eval, propose, approve, apply |
| `npx schema-context-mcp promote --config <path> --cases <dir>` | Generate a promotion readiness report (L0-L3) |

## Where This Fits

| Layer | What it does | Examples |
|---|---|---|
| **Warehouse MCPs** | Schema discovery + query execution | Google BQ MCP, mcp-server-bigquery |
| **Semantic layers** | Governed metrics and models for BI | dbt Semantic Layer, Cube, LookML |
| **schema-context-mcp** | Agent-facing semantics + tribal knowledge | **This project** |

It doesn't replace dbt Semantic Layer, Cube, or LookML. It *exposes* those semantics — plus the tribal knowledge those tools don't capture — to AI agents through MCP.

## What's Not in v1

| Feature | Why not yet |
|---|---|
| AST-based SQL parsing | Substring matching covers the 80% case — keeps things simple and auditable |
| Codebase scanning in health_check | Would broaden surface area significantly |
| Field lineage tool | Useful but not core to preventing wrong SQL |
| Snowflake / Postgres connectors | Interface exists and is ready — BigQuery is the v1 focus |

## Origin Story

Built by [Russell Moss](https://github.com/mossrussell) — a RevOps engineer who maintained 3,000+ lines of static markdown to teach AI agents about a Salesforce-backed BigQuery warehouse.

The files worked until they didn't: they went stale, ate context window, and couldn't validate themselves against reality. This MCP replaces that pattern with something live, structured, and portable.

---

**Questions? Issues?** [Open an issue](https://github.com/mossrussell/schema-context-mcp/issues) or check the [architecture docs](ARCHITECTURE.md) for the deep technical details.
