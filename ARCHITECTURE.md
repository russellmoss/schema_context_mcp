# schema-context-mcp Architecture

## Overview

schema-context-mcp is a Model Context Protocol (MCP) server that provides AI agents with live, annotated warehouse schema context through structured tool calls. It replaces static markdown documentation files with a runtime service that merges human-curated annotations with live warehouse metadata, tagging every piece of information with its provenance and confidence level.

The server targets BigQuery as its v1 warehouse connector, with an interface designed for future Snowflake/Postgres support.

### The Problem It Solves

AI agents writing SQL against a data warehouse need to know more than just column names and types. They need to know:

- Which deduplication flag to use for volume counts vs. rate calculations
- Which date fields are DATE vs. TIMESTAMP (and what wrapper to use)
- Which columns are dangerous to use without specific filters
- What business terms mean in context ("SQL__c" means SQO status, not the query language)
- What filters are required for certain metric types (e.g., recordtypeid for SQO metrics)

Previously, this knowledge lived in static markdown files that agents read at the start of every session. These files were ~1,500 lines across 5 documents. schema-context-mcp replaces them with structured, queryable tool calls where every annotation carries provenance and confidence metadata.

### Design Principles

1. **Live schema, never cached.** Every tool call queries `INFORMATION_SCHEMA` at runtime. Schema is never written to files or cached in memory across requests.

2. **Provenance on everything.** Every annotation in every response includes a `provenance` field (where the information came from) and a `confidence` field (how grounded it is). Agents can make informed decisions about how much to trust each piece of context.

3. **Merge at response time, not load time.** Annotations from different sources (native config, warehouse descriptions, dbt) are merged when a tool is called, not when the config is loaded. This preserves traceability: you can always see which source contributed each annotation.

4. **Config teaches the system, fixtures validate it.** Business logic (rules, metrics, field meanings) lives in `schema-config.yaml`. Historical expected outcomes (counts, conversion rates) live in `tests/fixtures/`. These two never cross: the system must produce correct numbers from its logic, not from memorized answers.

5. **Substring matching, not AST parsing.** The linter uses substring matching against configured rules. This is a deliberate v1 constraint: it's simple, predictable, auditable, and sufficient for the high-value rules. AST parsing is deferred.

---

## System Architecture

```
                                    MCP Client (Claude Code, IDE, etc.)
                                              |
                                         JSON-RPC / stdio
                                              |
                                    +-------------------+
                                    |   src/index.ts    |
                                    |   (MCP Server)    |
                                    +-------------------+
                                     |        |        |
                          +----------+   +----+----+   +-----------+
                          |              |         |               |
                   Config Layer    Tool Layer   Connector    Eval Framework
                          |              |         |               |
              +-----------+--+    +------+------+  |        +-----+------+
              |              |    |      |      |  |        |     |      |
          loader.ts    merger.ts  7 tools       |  |    runner  scorer  attribution
          validator.ts           (see below)    |  |    loader
              |                       |         |  |
              v                       v         v  |
       schema-config.yaml     Response Types   BQ  |
       (YAML on disk)         (with provenance)|   |
                                               v   |
                                     BigQuery INFORMATION_SCHEMA
                                                   |
                                        tests/cases/**/*.yaml
                                        tests/fixtures/*.yaml
```

### Communication Protocol

The server uses MCP (Model Context Protocol) over stdio. The MCP SDK handles JSON-RPC framing, tool discovery, and parameter validation.

**Critical constraint:** `console.log` is never called anywhere in the server. Stdout is reserved exclusively for MCP JSON-RPC messages. All diagnostic output uses `console.error`.

Every tool handler returns the same shape:

```typescript
{ content: [{ type: "text", text: JSON.stringify(structuredResult) }] }
```

The structured result is serialized as JSON in the text field. Agents parse this JSON to get typed, provenance-tagged data.

---

## Directory Structure

```
schema-context-mcp/
|
+-- src/
|   +-- index.ts                  # MCP server entry point, tool registration, lazy init
|   +-- types/
|   |   +-- config.ts             # TypeScript types for schema-config.yaml
|   |   +-- connector.ts          # WarehouseConnector interface
|   |   +-- responses.ts          # Response types for all 7 tools (with provenance/confidence)
|   |   +-- eval.ts               # Eval framework types (EvalCase, EvalOutcome, FailureCategory)
|   +-- connectors/
|   |   +-- bigquery.ts           # BigQuery INFORMATION_SCHEMA connector
|   +-- config/
|   |   +-- loader.ts             # YAML config file reader
|   |   +-- validator.ts          # Config validation (types, required fields, rule integrity)
|   |   +-- merger.ts             # Annotation merger (native config + warehouse desc -> response)
|   +-- tools/
|   |   +-- describe-view.ts      # Primary tool: annotated view schema
|   |   +-- health-check.ts       # Config-vs-schema drift detection
|   |   +-- list-views.ts         # View discovery with annotation status
|   |   +-- resolve-term.ts       # Business term lookup
|   |   +-- get-rule.ts           # Rule retrieval by ID or search
|   |   +-- get-metric.ts         # Metric definition with mode guidance
|   |   +-- lint-query.ts         # Heuristic SQL linting
|   +-- bootstrap/
|   |   +-- extract.ts            # Markdown doc extraction
|   |   +-- emit-config.ts        # YAML config generation from extracted knowledge
|   +-- onboarding/
|   |   +-- prerequisites.ts      # Credentials and dataset accessibility checks
|   |   +-- scaffold.ts           # Template copy and project/dataset substitution
|   |   +-- starter-evals.ts      # Doc-grounded Track B assertion generation
|   +-- refinement/
|   |   +-- loop.ts               # Eval → classify → propose → gate → re-run loop
|   |   +-- proposer.ts           # Config patch proposal generation
|   |   +-- gate.ts               # Human approval gate with logging
|   +-- promotion/
|   |   +-- criteria.ts           # L0-L3 promotion level evaluation
|   |   +-- report.ts             # Markdown promotion report generation
|   +-- eval/
|       +-- runner.ts             # Eval harness CLI (--online, --report)
|       +-- loader.ts             # YAML test case and fixture loader
|       +-- scorer.ts             # Pattern matching and scoring
|       +-- attribution.ts        # Failure categorization with sub-categories
|       +-- online.ts             # Live tool-call evaluation
|
+-- templates/
|   +-- schema-config.template.yaml
|   +-- true-north.template.yaml
|   +-- golden-results.template.yaml
|   +-- onboarding-checklist.md
|   +-- bootstrap-coverage-checklist.md
|   +-- promotion-checklist.md
|   +-- eval-cases/               # Track A/B/C and negative control templates
|
+-- examples/
|   +-- config.yaml               # Production-scale reference config
|
+-- config/
|   +-- schema-config.yaml        # The config: connection, views, fields, rules, terms, metrics
|
+-- tests/
|   +-- cases/
|   |   +-- track-a/              # SQL correctness test cases (A1-A10)
|   |   +-- track-b/              # Knowledge retrieval assertions (22 cases)
|   |   +-- track-c/              # Workflow replacement scenarios (4 cases)
|   |   +-- negative-controls/    # Constraint boundary tests (5 cases)
|   +-- fixtures/
|       +-- golden-results.yaml   # Regression baselines (development)
|       +-- true-north.yaml       # Business-approved expected outcomes (promotion gate)
|
+-- docs/
|   +-- implementation-guide-v1.md    # 13-phase build plan (executed)
|   +-- phase-status.md               # Phase completion tracker
|   +-- bootstrap-coverage-checklist.md
|   +-- bootstrap/example/             # Source-of-truth docs (5 files)
|
+-- .claude/
|   +-- mcp-tool-spec.md          # Canonical response shapes for all 7 tools
|   +-- config-schema.md          # Full YAML config schema reference
|   +-- eval-spec.md              # Eval framework specification
|
+-- dist/                         # Compiled JavaScript (tsc output)
+-- package.json
+-- tsconfig.json
+-- eslint.config.js
```

---

## Initialization and Lifecycle

### Startup

```
node dist/index.js                                           # Normal MCP server mode
node dist/index.js bootstrap --docs <dir> --output <path>    # Doc bootstrap mode
node dist/index.js onboard --project <id> --dataset <name>   # Full onboarding
node dist/index.js refine --config <path> --cases <dir>      # Refinement loop
node dist/index.js promote --config <path> --cases <dir>     # Promotion report
```

In MCP server mode, the server:

1. Creates an `McpServer` instance with name `"schema-context-mcp"` and version `"0.1.0"`
2. Registers all 7 tools with Zod schemas for input validation
3. Connects via `StdioServerTransport`
4. Waits for incoming JSON-RPC tool calls

### Lazy Initialization

Config and connector are **not** initialized at startup. They are created on the first tool call:

```
First tool call
  -> getConfig()          // reads schema-config.yaml, caches in module-level variable
  -> getConnector()       // creates BigQueryConnector using config.connection, caches
  -> tool handler runs    // uses both
```

The config path is read from `SCHEMA_CONFIG` env var, defaulting to `./config/schema-config.yaml`. The BigQuery connector uses the config's `connection.project` and optional `connection.key_file` (falling back to Application Default Credentials).

### No Caching of Schema

The connector queries BigQuery `INFORMATION_SCHEMA` on every tool call. There is no schema cache. This ensures agents always see the current warehouse state.

---

## Config System

### schema-config.yaml

The YAML config is the core knowledge artifact. It has 7 top-level sections:

```yaml
connection:    # Required: warehouse connection details
dbt:           # Optional: dbt manifest/semantic manifest paths
fields:        # Optional: per-field annotations (meaning, type, gotchas)
views:         # Optional: per-view annotations (purpose, grain, filters, dangerous columns)
rules:         # Optional: typed query rules (ban_pattern, prefer_field, require_filter, date_type_rule)
terms:         # Optional: business domain vocabulary
metrics:       # Optional: metric definitions with cohort/period modes
```

### Config Loading Pipeline

```
schema-config.yaml
  -> loader.ts (readFileSync + yaml.parse)
  -> validator.ts (type checking, rule validation, duplicate detection)
  -> SchemaConfig (typed object, used by all tools)
```

Validation is strict:
- Unknown top-level keys produce warnings
- Missing `connection.connector` or `connection.project` produce errors
- Invalid rule types, duplicate rule IDs, and missing required rule fields produce errors
- Validation errors are aggregated and thrown as `AggregateConfigError`

### What the Config Does NOT Do

- Does not cache schema (always live queries)
- Does not merge annotations at load time (merging is at response time)
- Does not contain expected business outcomes (those live in test fixtures)
- Does not generate or infer annotations (extraction is the bootstrap command's job)

---

## Annotation Merger

The merger (`src/config/merger.ts`) is the core logic that combines live warehouse schema with config annotations at response time.

### Resolution Priority

```
native_config  >  dbt_meta  >  dbt_description  >  warehouse_description  >  live_schema
```

For v1, only `native_config` and `warehouse_description` are active (no dbt integration yet).

### Per-Column Merge Logic

For each column returned by the live warehouse query:

1. Check if the column has a `fields` config entry
2. If native config has a non-empty `meaning` -> `provenance: native_config, confidence: high`
3. If native config has `gotcha` or `use_instead_of` but no meaning -> `provenance: native_config, confidence: medium`
4. If no native config but warehouse has a description -> `provenance: warehouse_description, confidence: medium`
5. If nothing -> `provenance: live_schema, confidence: low`

### Empty String Handling

The `isNonEmpty()` guard rejects:
- Empty strings (`""`)
- Whitespace-only strings (`"   "`)
- The literal string `"null"` (case-insensitive)

This prevents low-quality values from lower-priority sources from being silently suppressed by empty/null values from higher-priority sources.

### Stale Column Exclusion

Columns that exist in config but NOT in the live schema are excluded from the response. They are not errors; they are stale. The `health_check` tool detects and reports them separately.

---

## Tools

### 1. describe_view (Primary Tool)

**Purpose:** Returns annotated schema for a warehouse view. Agents should call this before writing SQL.

**Parameters:** `view` (required), `dataset` (optional), `intent` (optional)

**Response:** `ViewDescription` with purpose, grain, intent_warnings, dangerous_columns, key_filters, annotated_columns, consumers, freshness_notes, recommended_date_fields

**Key behaviors:**
- Calls the BigQuery connector for live schema, then calls the merger
- Intent parameter triggers token decomposition: `"count_sqos"` becomes `["count_sqos", "count", "sqos"]` and each token is matched against rule fields to surface relevant warnings
- Falls back across configured datasets if the view isn't found in the first one
- Dangerous columns are structured objects: `{column, reason, use_instead?, provenance, confidence}`
- intent_warnings is always an array (empty `[]` when no intent, never undefined)

### 2. health_check

**Purpose:** Detects drift between config and live warehouse schema.

**Parameters:** `dataset` (optional, defaults to all configured datasets)

**Response:** `HealthCheckResult` with unannotated_fields, stale_annotations, config_issues, summary, suggestion

**Scope:** Config-vs-schema drift only. No codebase scanning. No auto-fixing.

### 3. list_views

**Purpose:** Discovers views/tables in the warehouse and flags annotation status.

**Parameters:** `dataset` (optional), `search` (optional)

**Response:** `ViewListResult` with views array (name, dataset, type, annotated, column_count), total, annotated count. Sorted: annotated views first, then alphabetical.

### 4. resolve_term

**Purpose:** Business domain vocabulary lookup.

**Parameters:** `term` (required)

**Response:** `TermDefinition` with term, definition, found (boolean), related_fields, related_rules, gotchas, provenance, confidence

**Key behaviors:**
- Case-insensitive lookup in config.terms
- Also searches fields and rules for related entries by substring matching
- Unknown terms return `found: false` with `confidence: high` (confident it's not defined)
- Never invents definitions

### 5. get_metric

**Purpose:** Metric definitions with computation logic and mode guidance.

**Parameters:** `metric` (required), `mode` (optional: `"cohort"` | `"period"`)

**Response:** `MetricResult` with name, numerator, denominator, mode, mode_guidance, date_anchor, gotchas, related_rules, provenance, confidence

**Key behaviors:**
- Mode-specific: cohort mode returns progression/eligibility flag names, period mode returns date-anchor logic
- If no mode specified and both exist, returns `mode: "both"` with combined gotchas
- Returns formulas exactly as written in config (no evaluation or rewriting)

### 6. get_rule

**Purpose:** Named query rule retrieval.

**Parameters:** `rule_id` (optional), `search` (optional)

**Response:** `RuleResult` (or array) with id, type, severity, message, type-specific fields, provenance, confidence

**Key behaviors:**
- Exact lookup by ID or case-insensitive search across rule text
- Returns rule definitions verbatim from config
- Type-specific fields vary: `pattern` for ban_pattern, `found`/`prefer` for prefer_field, `when_contains`/`required` for require_filter, `field`/`wrong_wrapper`/`correct_wrapper` for date_type_rule

### 7. lint_query

**Purpose:** Lightweight heuristic SQL linting against configured rules.

**Parameters:** `sql` (required)

**Response:** `LintResult` with warnings array (rule_id, type, severity, message, confidence, provenance), passed (boolean), note

**Key behaviors:**
- Strips SQL comments (`--` line comments, `/* */` block comments) before matching
- Normalizes to lowercase for all matching
- Substring matching only: no regex, no AST parsing, no SQL parser libraries
- Four rule types:
  - `ban_pattern`: if `pattern` substring found -> violation
  - `prefer_field`: if `found` present AND `prefer` absent -> violation
  - `require_filter`: if any `when_contains` trigger present AND `required` absent -> violation
  - `date_type_rule`: if `field` present AND `wrong_wrapper` present -> violation
- Confidence is always `"medium"` (acknowledges substring limitations)
- Every finding traces to a configured rule ID. No free-form "AI" findings.

---

## Connector Layer

### WarehouseConnector Interface

```typescript
interface WarehouseConnector {
  getViewSchema(dataset: string, view: string): Promise<ViewSchema>;
  listViews(dataset: string): Promise<ViewListEntry[]>;
  getColumnDescriptions(dataset: string, view: string): Promise<Map<string, string>>;
}
```

v1 implements `BigQueryConnector`. The interface supports future Snowflake/Postgres connectors.

### BigQuery Implementation

- Queries `INFORMATION_SCHEMA.COLUMN_FIELD_PATHS` for column names, types, and descriptions
- Queries `INFORMATION_SCHEMA.TABLES` joined with `COLUMN_FIELD_PATHS` for view listing with column counts
- Uses **parameterized queries** for all WHERE clause values (`@viewName`)
- Project and dataset in FROM clauses use template literals (these are config values, not user input)
- Authentication: constructor accepts `keyFilePath` for service account JSON, or falls back to Application Default Credentials (ADC)
- No caching: always queries live
- Errors are caught and rethrown with context (e.g., `"Failed to get schema for Tableau_Views.vw_funnel_master: ..."`)

---

## Provenance and Confidence Model

Every annotation in every tool response carries two metadata fields:

### ProvenanceSource

| Value | Meaning |
|-------|---------|
| `native_config` | Human-curated annotation from schema-config.yaml |
| `dbt_meta` | From dbt manifest `meta` field (not yet active in v1) |
| `dbt_description` | From dbt manifest `description` field (not yet active in v1) |
| `warehouse_description` | From BigQuery INFORMATION_SCHEMA.COLUMN_FIELD_PATHS.description |
| `live_schema` | Column exists in warehouse but has no annotation from any source |
| `inferred` | System-inferred (not used in v1) |

### ConfidenceLevel

| Value | Meaning |
|-------|---------|
| `high` | Human annotation confirmed by live schema presence |
| `medium` | Automated source (warehouse desc) or partial annotation (gotcha only) |
| `low` | No annotation; only the column name and type are known |

### Resolution Priority

When multiple sources provide a value for the same field, the highest-priority source wins:

```
native_config > dbt_meta > dbt_description > warehouse_description > live_schema
```

Empty strings, whitespace, and the literal string `"null"` from any source do NOT override valid values from lower-priority sources.

---

## Rule System

Rules are typed primitives with well-defined matching semantics. The config uses four rule types:

### ban_pattern

A substring that must never appear in SQL.

```yaml
- id: no_new_mapping
  type: ban_pattern
  pattern: "new_mapping"
  severity: error
  message: "Deprecated. Use Channel_Grouping_Name directly."
```

Lint behavior: if `pattern` is found in the query -> violation.

### prefer_field

"You used X, consider Y instead."

```yaml
- id: sqo_volume_dedup
  type: prefer_field
  found: "is_sqo"
  prefer: "is_sqo_unique"
  context: "volume counts"
  severity: error
  message: "Use is_sqo_unique for SQO volume counts."
```

Lint behavior: if `found` is present AND `prefer` is absent -> violation. If both are present, no violation (the agent already used the preferred form).

### require_filter

"You queried X without Y."

```yaml
- id: re_engagement_exclusion
  type: require_filter
  when_contains:
    - "is_sqo"
    - "is_joined"
  required: "recordtypeid"
  severity: warning
  message: "Add recordtypeid filter to exclude re-engagement."
```

Lint behavior: if ANY `when_contains` trigger is found AND `required` is absent -> violation.

### date_type_rule

DATE vs. TIMESTAMP enforcement.

```yaml
- id: date_converted_date_raw
  type: date_type_rule
  field: "converted_date_raw"
  expected_type: DATE
  wrong_wrapper: "TIMESTAMP(converted_date_raw)"
  correct_wrapper: "DATE(converted_date_raw)"
  severity: error
  message: "converted_date_raw is DATE type."
```

Lint behavior: if `field` is found AND `wrong_wrapper` is found -> violation.

---

## Eval Framework

The eval harness validates that the config and tools produce correct results. It has three tracks plus negative controls.

### Three Tracks

| Track | What It Tests | How It Tests |
|-------|---------------|-------------|
| **Track A: SQL Correctness** | Does the agent write correct SQL using MCP context? | Checks reference SQL for required_patterns (must be present) and banned_patterns (must be absent) |
| **Track B: Knowledge Retrieval** | Does the MCP return accurate answers? | Checks config JSON for expected substrings in response to knowledge questions |
| **Track C: Workflow Replacement** | Can full workflows use only MCP context? | Requires online mode with live tool calls (structural checks in offline mode) |

### Negative Controls

Tests where the agent must NOT apply a rule that would otherwise seem correct:

- Must NOT apply recordtypeid to lead-level metrics
- MUST use is_primary_opp_record for AUM (not flag as error)
- MUST use task_executor_name for effort measurement
- Asking about CloseDate itself is legitimate (even though it's dangerous for dating)
- Cohort eligibility flags handle recordtypeid internally

### Failure Attribution

Every failure is categorized into exactly one of four buckets:

| Category | Meaning | Fix |
|----------|---------|-----|
| `config_gap` | Knowledge missing from config | Add annotation or rule to schema-config.yaml |
| `surfacing_failure` | Knowledge exists in config but tool didn't return it | Adjust intent routing or merger logic |
| `evaluator_strict` | Evaluator flagged something acceptable | Relax test case pattern |
| `agent_reasoning` | Agent had sufficient context but reasoned wrong | Not a config problem |

### Fixture System

Two fixture types, both in `tests/fixtures/`:

**Golden fixtures** (`golden-results.yaml`): Development regression baselines. Populated from live dashboard queries. Changes during development are expected.

**True-north fixtures** (`true-north.yaml`): Business-approved expected outcomes. A true-north failure blocks promotion. These contain Q1 2025 and Q2 2025 topline funnel numbers and conversion rates, verified by RevOps.

**Boundary rule:** Fixtures validate the system. They do not teach it. Numeric expected outcomes never appear in `schema-config.yaml`.

### Running the Eval

```bash
# Full suite
node dist/eval/runner.js --cases tests/cases/ --config config/schema-config.yaml

# With fixtures
node dist/eval/runner.js --cases tests/cases/ --config config/schema-config.yaml --fixtures tests/fixtures/

# Single track
node dist/eval/runner.js --cases tests/cases/ --config config/schema-config.yaml --track b

# Single case
node dist/eval/runner.js --cases tests/cases/ --config config/schema-config.yaml --case count-sqos-by-channel
```

Exit code 1 on any failure (for CI integration).

---

## Bootstrap Command

The bootstrap command generates an initial config draft from existing static markdown documentation.

```bash
node dist/index.js bootstrap --docs docs/bootstrap/example --output /tmp/draft-config.yaml
```

This is extraction, not inference. Every generated annotation has `confidence: low` by default. The output is a draft for human review, not a production-ready config.

### Bootstrap Pipeline

```
Markdown docs
  -> extract.ts (parse headings, tables, numbered rules)
  -> ExtractedKnowledge (views, fields, rules, terms)
  -> emit-config.ts (convert to YAML format)
  -> Draft schema-config.yaml
```

---

## Data Flow for a Typical Tool Call

Here is the complete flow when an agent calls `describe_view("vw_funnel_master", intent="count_sqos")`:

```
1. MCP client sends JSON-RPC call
     |
2. MCP SDK validates params against Zod schema
     |
3. Tool handler calls getConfig() (lazy: loads YAML, validates, caches)
     |
4. Tool handler calls getConnector() (lazy: creates BigQueryConnector, caches)
     |
5. describeView() called
     |
6. connector.getViewSchema("Tableau_Views", "vw_funnel_master")
     -> BQ query: SELECT column_name, data_type, description
                  FROM INFORMATION_SCHEMA.COLUMN_FIELD_PATHS
                  WHERE table_name = @viewName
     -> Returns: ViewSchema { columns: [{name, type, description?}, ...] }
     |
7. mergeViewAnnotations(liveSchema, config)
     -> For each live column:
        - Check config.fields[columnName] for meaning/gotcha/use_instead_of
        - Apply resolution priority
        - Tag provenance and confidence
     -> Build dangerous_columns (structured objects, skip stale)
     -> Build key_filters (from config.views)
     -> Returns: MergedViewAnnotation
     |
8. getIntentWarnings("count_sqos", config)
     -> Decompose: ["count_sqos", "count", "sqos"]
     -> Match tokens against rule.found, rule.prefer, rule.context, etc.
     -> Returns: ["Use is_sqo_unique...", "Use is_joined_unique...", ...]
     |
9. Assemble ViewDescription
     -> view, purpose, grain, intent_warnings, dangerous_columns,
        key_filters, annotated_columns, consumers, freshness_notes,
        recommended_date_fields
     |
10. Return { content: [{ type: "text", text: JSON.stringify(result) }] }
```

---

## Module System and Build

- **ESM**: `package.json` has `"type": "module"`. The MCP SDK is ESM-only.
- **TypeScript**: `tsconfig.json` uses `module: "nodenext"`, `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`. All imports use explicit `.js` extensions.
- **Build**: `npm run build` runs `tsc`. Output goes to `dist/`.
- **Lint**: `npm run lint` runs ESLint with `@typescript-eslint`.
- **No test runner**: Eval cases are YAML, not JavaScript. The eval framework IS the test runner.

### Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework (tool registration, stdio transport) |
| `@google-cloud/bigquery` | BigQuery client library |
| `yaml` | YAML config parsing |
| `zod` | Tool input schema validation (required by MCP SDK) |

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SCHEMA_CONFIG` | `./config/schema-config.yaml` | Path to the config file |
| `GOOGLE_APPLICATION_CREDENTIALS` | (none) | GCP service account key path (if not using config.connection.key_file) |

---

## Security Considerations

- **No string interpolation of user input in SQL.** All WHERE clause values use parameterized queries (`@viewName`). Project and dataset identifiers in FROM clauses are config values, not user input.
- **stdout is never used for logging.** `console.log` is banned. Stdout is exclusively for MCP JSON-RPC. All diagnostics go to `console.error`.
- **Config validation is strict.** Unknown keys warn, invalid types error, duplicate rules error. Malformed configs fail loudly at first tool call, not silently at runtime.
- **No auto-fix, no auto-promotion.** health_check reports drift but never modifies config. bootstrap generates drafts but never overwrites production config. The eval runner reports failures but never changes rules.

---

## Known Limitations (v1)

| Limitation | Reason | Mitigation |
|------------|--------|------------|
| Substring-only lint matching | Deliberate simplicity; AST deferred | Confidence always `"medium"`; note in response |
| No codebase scanning in health_check | Scope constraint; deferred | health_check only covers config-vs-schema drift |
| Intent routing uses token matching | No semantic understanding of intent | Token decomposition on `_` helps; agents can also call get_rule directly |
| No dbt integration | v1 targets native config only | Interface and priority chain are ready; dbt fields exist in types |
| No Snowflake/Postgres connectors | v1 targets BigQuery only | WarehouseConnector interface supports future connectors |
| No field lineage tool | Deferred | Field lineage info is in field annotations (source_info) |
| No autonomous self-healing | Deliberate constraint | Changes require human review |
| `prefer_field` rules can false-positive | `SGA_Owner_Name__c` fires even for legitimate lead-level use | Severity is `warning`, message scopes the context |

---

## Extending the System

### Adding a New Warehouse Connector

1. Create `src/connectors/snowflake.ts` (or similar)
2. Implement the `WarehouseConnector` interface (3 methods)
3. Update `src/index.ts` to select connector based on `config.connection.connector`
4. Add the connector type to the `ConnectionConfig.connector` union in `src/types/config.ts`

### Adding a New Tool

1. Define the response type in `src/types/responses.ts`
2. Create `src/tools/your-tool.ts` with the implementation
3. Register in `src/index.ts` with `server.tool(name, description, zodSchema, handler)`
4. Add eval cases in `tests/cases/`
5. Update `.claude/mcp-tool-spec.md` with the response shape

### Adding a New Rule Type

1. Add the type to `RuleType` union in `src/types/config.ts`
2. Add the interface (e.g., `YourRule extends BaseRule`)
3. Add it to the `RuleConfig` discriminated union
4. Add validation in `src/config/validator.ts`
5. Add matching logic in `src/tools/lint-query.ts`
6. Add intent matching in `src/tools/describe-view.ts`

---

## Onboarding System

The onboarding system provides a structured path from "I have a warehouse" to "I have a production-ready annotated config with eval coverage."

### Architecture

```
onboard command
  |
  +-- scaffold.ts      → Copy templates, substitute project/dataset
  +-- prerequisites.ts → Check credentials, dataset accessibility
  +-- extract.ts       → Parse source docs into ExtractedKnowledge
  +-- emit-config.ts   → Generate draft schema-config.yaml
  +-- starter-evals.ts → Generate Track B assertions from source docs

refine command
  |
  +-- loop.ts          → Run eval → classify → propose → gate → apply → re-run
  +-- proposer.ts      → Generate config patch proposals from failures
  +-- gate.ts          → Human approval gate, --auto-approve support, logging

promote command
  |
  +-- criteria.ts      → Evaluate state against L0-L3 promotion criteria
  +-- report.ts        → Generate markdown promotion report
```

### Onboarding Flow

```
1. onboard --project X --dataset Y --docs ./docs/
   → Scaffolds project structure
   → Checks warehouse connectivity
   → Bootstraps config from docs
   → Generates doc-grounded Track B assertions

2. Human Review (required gate)
   → Review config, classify rules, add metrics

3. refine --config ./config.yaml --cases ./tests/cases/
   → Runs eval → proposes config patches → human approves → re-runs
   → Stops when all cases pass or max iterations reached

4. promote --config ./config.yaml --cases ./tests/cases/
   → Evaluates against L0-L3 criteria
   → Generates markdown promotion report
```

### Promotion Levels

| Level | Name | Key Criteria |
|---|---|---|
| L0 | Not Ready | Eval failures, connection errors, or no eval cases |
| L1 | Ready with Conditions | Offline evals pass, but coverage < 50% or no true-north |
| L2 | Ready for Internal Deployment | Offline + online pass, coverage ≥ 70%, human sign-off |
| L3 | Ready for Production Agents | L2 + Track C pass, golden fixtures stable, config versioned |

### Automation Boundaries

The refinement loop may only propose additions (new fields, views, terms). It may never:
- Classify rules into typed primitives (human only)
- Author metric definitions (human only)
- Modify or delete existing config entries (human only)
- Relax test assertions (human only)
- Auto-approve dangerous_column entries (human only)

---

### Adding Config Annotations

The config is the primary extension point. To teach the system about a new field, view, or rule:

1. Edit `config/schema-config.yaml`
2. Run `npm run build && node dist/eval/runner.js --cases tests/cases/ --config config/schema-config.yaml`
3. If Track B knowledge assertions fail, the config needs more coverage
4. If Track A SQL cases fail, the rules or field annotations need adjustment

No code changes are needed for most config improvements.
