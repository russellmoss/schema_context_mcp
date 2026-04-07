# schema-context-mcp v1 — Phased Implementation Guide

**Status**: Council-reviewed, ready for phased execution
**Date**: 2026-04-07
**Deliverable**: Execution-ready build guide for Claude Code — no code changes in this artifact

---

## 0. Pre-Implementation Preflight (Required Before Phase 1)

The exploration agents identified critical scaffolding issues that must be diagnosed and resolved before any code is written. Phase 0 is diagnostic-first: do not assume the answer is "switch to ESM" until the current package, compiler, source, and SDK module systems are verified.

### 0a. Verified Module-System Preflight

Claude Code must inspect all of the following before choosing a fix:

1. `package.json` for the `"type"` field
2. `tsconfig.json` for `"module"`, `"moduleResolution"`, and `"verbatimModuleSyntax"`
3. Any existing `.ts` / `.js` source files for import style (ESM vs CJS)
4. `node_modules/@modelcontextprotocol/sdk/package.json` for its `"type"` field
5. Report findings first, then decide the correct module-system alignment
6. Only after diagnosis, apply the fix with explicit rationale

The outcome may still be ESM alignment, but the guide must not assume that up front. The fix should align `package.json`, `tsconfig.json`, existing source import style, and the MCP SDK.

### 0b. Missing Dependencies

- **Zod** — Required by the MCP SDK for tool input schema definitions.
- **eslint** — The `npm run lint` script references eslint but no eslint packages are declared.
- **@google-cloud/bigquery** — Not yet in package.json. Will be added in Phase 2.
- **yaml** — For YAML config parsing. Will be added in Phase 3.

Install `zod`, `yaml`, and the eslint packages only after the module system is diagnosed, the fix is applied, `npm run build` compiles clean, and the module system is confirmed consistent.

### 0c. MCP SDK Patterns (Discovered by Exploration)
**Tool registration** uses `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "schema-context-mcp", version: "0.1.0" });

server.tool("describe_view", "Returns annotated schema for a view", {
  view: z.string(),
  intent: z.string().optional()
}, async ({ view, intent }) => {
  // handler logic
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Critical:** `console.log` must NEVER be called — stdout is reserved for MCP JSON-RPC. Use `console.error` for all diagnostic output.

**Handler return shape:** All tool handlers return `{ content: [{ type: "text", text: JSON.stringify(structuredData) }] }`. Structured data (provenance, confidence, etc.) is serialized as JSON in the text field.

### 0d. Authoritative Spec Docs

Three spec docs exist in `.claude/` that provide canonical response shapes:
- `.claude/mcp-tool-spec.md` — exact response shapes for all 7 tools
- `.claude/config-schema.md` — full YAML config schema with examples
- `.claude/eval-spec.md` — eval framework format, scoring model, failure attribution

**All Claude Code prompts in this guide should reference these spec docs.** They are the source of truth for response shapes and config format.

### 0e. Claude Code Prompt for Phase 0

```
Run a verified preflight for the module system before Phase 1.

Inspect, in order:
1. package.json for the "type" field
2. tsconfig.json for "module", "moduleResolution", and "verbatimModuleSyntax"
3. Any existing .ts/.js source files for import style (ESM vs CJS)
4. node_modules/@modelcontextprotocol/sdk/package.json for its "type" field

Then report your findings and decide the correct module-system alignment for this repo.
Do NOT assume the fix is "change to ESM" until after the inspection is complete.

Only after diagnosis:
5. Apply the module-system fix with rationale
6. Verify npm run build compiles clean
7. Confirm the module system is consistent across package.json, tsconfig.json, existing source files, and the MCP SDK
8. Only then run: npm install zod yaml
9. Only then run: npm install --save-dev eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser

Do NOT create any source files during Phase 0.
Do NOT proceed to Phase 1 until the module system is confirmed consistent.
```

**Validation:**
```bash
npm run build   # Must succeed after the chosen module-system fix
```

**Stop condition:** Do not proceed to Phase 1 until `npm run build` compiles clean AND the module system is confirmed consistent across `package.json`, `tsconfig.json`, existing source files, and the MCP SDK.

---

## 1. Feature Summary

schema-context-mcp v1 is a Node.js/TypeScript MCP server that replaces five static warehouse markdown docs (~1,500 lines total) with live, annotated schema context served through structured tool calls. It targets BigQuery as the v1 connector.

**What it builds:**
- A BigQuery connector that queries `INFORMATION_SCHEMA` at runtime (never caches schema in files)
- A YAML config loader supporting `connection`, `fields`, `views`, `rules`, `metrics`, `terms`, and optional `dbt` sections
- Seven MCP tools: `describe_view`, `health_check`, `resolve_term`, `get_rule`, `get_metric`, `lint_query`, `list_views`
- A three-track eval harness (SQL correctness, knowledge retrieval, workflow replacement) with failure attribution
- A doc-bootstrap command for one-shot migration from static docs to config

**What it does NOT build (v1 non-goals):**
- No AST-based SQL parsing
- No codebase scanning in `health_check`
- No autonomous self-healing or automatic config promotion
- No Snowflake/Postgres connectors (interface only)
- No field lineage tool
- No inferred annotations from query logs

**Trust model:** Every tool response includes `provenance` (source of each annotation) and `confidence` (high/medium/low). Resolution priority: native config > dbt meta > dbt description > warehouse description. This is non-negotiable across all phases.

---

## 2. Bootstrap Coverage Map

The five Savvy Wealth docs map into MCP coverage as follows:

During Phase 1, generate docs/bootstrap-coverage-checklist.md from the coverage map above. This file tracks which source doc sections have been migrated to config, which are pending, and which are intentionally deferred. Update it at the end of each phase.

### bq-views.md → `views` config + `describe_view` / `list_views`

| Content | MCP Config Section | MCP Tool | Eval Track | v1 Status |
|---|---|---|---|---|
| View purpose, grain, consumers | `views.*.purpose`, `views.*.grain`, `views.*.consumers` | `describe_view` | B (retrieval), C (workflow) | In scope |
| Key fields per view | `views.*.key_filters`, `views.*.dangerous_columns` | `describe_view` | B, A | In scope |
| Dataset organization | `list_views` response grouping | `list_views` | B | In scope |
| Orphaned/external-only views | View annotations with `status: external_only` | `list_views` | B | In scope |
| Raw tables (new_mapping deprecation) | `rules` (ban_pattern for new_mapping) | `get_rule`, `lint_query` | A, B | In scope |

### bq-field-dictionary.md → `fields` config + `describe_view`

| Content | MCP Config Section | MCP Tool | Eval Track | v1 Status |
|---|---|---|---|---|
| Field types (DATE vs TIMESTAMP) | `fields.*.type_info` | `describe_view` | A, B | In scope |
| Dedup flags (is_sqo_unique, is_primary_opp_record) | `fields.*.meaning`, `fields.*.use_instead_of` | `describe_view`, `get_rule` | A, B | In scope |
| Eligibility/progression flags | `fields.*.meaning` | `describe_view`, `get_metric` | A, B | In scope |
| FilterDate computation chain | `fields.FilterDate.meaning` | `describe_view` | B | In scope |
| AUM COALESCE rules | `rules` (ban_pattern for addition), `fields` | `get_rule`, `lint_query` | A, B | In scope |
| Re-engagement stage mapping | `views.vw_funnel_master.notes` | `describe_view` | B | In scope |
| Marketing_Segment vs Lead_Score_Tier | `terms`, `fields` | `resolve_term` | B | In scope |

### bq-patterns.md → `rules` config + `lint_query` / `get_rule`

| Content | MCP Config Section | MCP Tool | Eval Track | v1 Status |
|---|---|---|---|---|
| 12 critical rules / anti-patterns | `rules[]` (ban_pattern, prefer_field, require_filter) | `get_rule`, `lint_query` | A, B | In scope |
| Cohort vs period mode logic | `metrics` (mode-specific definitions) | `get_metric` | A, B | In scope |
| Record type filtering rules | `rules[]` (require_filter) | `get_rule`, `lint_query` | A, B, negative controls | In scope |
| Channel/source mapping | `rules[]` (ban_pattern for new_mapping) | `get_rule`, `lint_query` | A, B | In scope |
| Date handling patterns | `rules[]` (date_type_rule) | `get_rule`, `lint_query` | A, B | In scope |
| Forecast-specific patterns | `views.vw_forecast_p2` annotations | `describe_view` | A (A9) | In scope |
| Duration penalty, Monte Carlo details | Deferred — not core to preventing wrong SQL | — | — | Deferred |

### bq-activity-layer.md → `fields` + `rules` + `views` config

| Content | MCP Config Section | MCP Tool | Eval Track | v1 Status |
|---|---|---|---|---|
| Task linkage (WhoId/WhatId resolution) | `views.vw_sga_activity_performance` annotations | `describe_view` | A (A3, A8, A10), B | In scope |
| Direction classification (Outbound/Inbound) | `fields.direction` | `describe_view` | A, B | In scope |
| Channel classification (10 values) | `fields.activity_channel` | `describe_view` | B | In scope |
| Outbound automation exclusion filters | `rules[]` (require_filter) | `get_rule`, `lint_query` | A (A3), B | In scope |
| Attribution (executor vs owner) | `rules[]`, `fields` | `get_rule`, `describe_view` | A (A3, A7, A10), B | In scope |
| Quality signals (is_meaningful_connect, is_true_cold_call) | `fields` | `describe_view` | A (A10), B | In scope |
| Ghost contacts known issue | `views.vw_sga_activity_performance.known_issues` | `describe_view` | C (C4) | In scope |
| Ramp status logic | `fields.activity_ramp_status` | `describe_view` | B | In scope |

### bq-salesforce-mapping.md → `fields` + `views` config

| Content | MCP Config Section | MCP Tool | Eval Track | v1 Status |
|---|---|---|---|---|
| Sync cadence (6h core, weekly OFH, monthly FinTrx) | `views.*.freshness_notes` | `describe_view` | B | In scope |
| Field lineage (SF→BQ mapping) | `fields.*.source_info` | `describe_view` | B | In scope |
| SGA__c is a User ID gotcha | `fields.SGA__c`, `rules[]` | `describe_view`, `get_rule` | B | In scope |
| SQL__c means SQO status | `terms.SQL__c`, `fields.SQO_raw` | `resolve_term`, `describe_view` | B | In scope |
| Re-engagement dual-entry pattern | `views.vw_funnel_master` annotations | `describe_view` | B | In scope |
| Stage_Entered_Closed__c population gap | `fields.Stage_Entered_Closed__c.gotcha` | `describe_view` | B | In scope |
| Finance_View__c opp-wins precedence | `fields.Finance_View__c` | `describe_view` | B | In scope |
| CRD matching type mismatch | `fields` annotations | `describe_view` | B | In scope |
| Hightouch sync details | `views` freshness notes | `describe_view` | B | In scope |

---

## 3. Phase-by-Phase Implementation Plan

### Phase 1: Project Scaffolding & Core Types

**Goal:** Establish the TypeScript type contracts that every subsequent phase depends on. No MCP server yet — just types, interfaces, and the project skeleton.

**Files to create:**
- `src/types/config.ts` — `SchemaConfig`, `ViewConfig`, `FieldConfig`, `RuleConfig`, `MetricConfig`, `TermConfig`
- `src/types/connector.ts` — `WarehouseConnector` interface, `ColumnSchema`, `ViewSchema`
- `src/types/responses.ts` — `ProvenanceSource`, `ConfidenceLevel`, `AnnotatedColumn`, `ViewDescription`, `HealthCheckResult`, `RuleResult`, `MetricResult`, `LintFinding`, `TermDefinition`, `ViewListEntry`
- `src/types/eval.ts` — `EvalCase`, `EvalOutcome`, `FailureCategory`
- `src/index.ts` — empty MCP server shell (imports SDK, registers no tools yet)

**Claude Code prompt:**

```
Read these files first:
- README.md (tool specs, config schema, response examples)
- CLAUDE.md (conventions and anti-patterns)
- .claude/mcp-tool-spec.md (canonical response shapes for all 7 tools)
- .claude/config-schema.md (full YAML config schema with examples)
- .claude/eval-spec.md (eval framework format)

Then create the TypeScript type foundation for the schema-context-mcp server.

Create these files:

1. src/types/config.ts — Type definitions for the YAML config schema.
   Use .claude/config-schema.md as the authoritative reference.
   The config has these top-level sections: connection, fields, views, rules,
   metrics, terms, optional dbt. Rules have types: ban_pattern, prefer_field,
   require_filter, date_type_rule. Each rule has id, type, severity, message,
   and type-specific fields (pattern, found/prefer, when_contains/required, etc).
   The terms section supports both simple (string) and expanded (object with
   definition, related_fields, related_rules, gotcha) forms.

2. src/types/connector.ts — Interface for warehouse connectors.
   Define a WarehouseConnector interface with methods:
   - getViewSchema(dataset: string, view: string): Promise<ViewSchema>
   - listViews(dataset: string): Promise<ViewListEntry[]>
   - getColumnDescriptions(dataset: string, view: string): Promise<Map<string, string>>
   ViewSchema has: dataset, name, columns (array of {name, type, description?}).

3. src/types/responses.ts — Response types for all MCP tools.
   Use .claude/mcp-tool-spec.md as the authoritative reference for response shapes.
   Every response must include provenance and confidence.
   ProvenanceSource = 'native_config' | 'dbt_meta' | 'dbt_description' |
     'warehouse_description' | 'live_schema' | 'inferred'
   ConfidenceLevel = 'high' | 'medium' | 'low'
   Define: ViewDescription (for describe_view), HealthCheckResult, RuleResult,
   MetricResult, LintFinding, TermDefinition, ViewListEntry.
   Match the EXACT field names from mcp-tool-spec.md — e.g., describe_view
   uses "dangerous_columns" as array of {column, reason, use_instead, provenance,
   confidence}, not just string[].

4. src/types/eval.ts — Types for the eval framework.
   Use .claude/eval-spec.md as the authoritative reference.
   EvalCase with: id, request, difficulty, category, required_patterns,
   banned_patterns, expected_tool_calls, reference_sql, knowledge_assertions,
   negative_controls.
   EvalOutcome with: case_id, status (pass|partial|fail), failure_category, gaps,
   required_checks, banned_checks, negative_checks.
   FailureCategory = 'config_gap' | 'surfacing_failure' | 'evaluator_strict' | 'agent_reasoning'

5. src/index.ts — Minimal MCP server entry point.
   Use the MCP SDK pattern:
     import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
     import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
   Create a McpServer instance with name "schema-context-mcp" and version "0.1.0".
   Register no tools yet — add a comment: // Tool registrations will be added here
   Connect via StdioServerTransport.
   CRITICAL: Use console.error for logging, NEVER console.log (stdout is MCP JSON-RPC).

Do NOT add any business logic. Do NOT create config files or test cases. Types only + server shell.

Use strict TypeScript. The project uses "type": "module" in package.json,
"module": "nodenext" and "verbatimModuleSyntax": true in tsconfig,
so use explicit .js extensions in relative imports and use import type where appropriate.
Remember noUncheckedIndexedAccess is true — array index access returns T | undefined.
```

**Validation:**
```bash
npm run build   # Must compile clean with zero errors
npm run lint    # Must pass
```

**Stop condition:** All type files compile. `src/index.ts` starts and immediately exits (no tools registered). No runtime dependencies added.

---

### Phase 2: BigQuery Connector

**Goal:** Implement the BigQuery connector that queries `INFORMATION_SCHEMA` at runtime. This is the live schema layer.

**Files to create/modify:**
- `src/connectors/bigquery.ts` — implements `WarehouseConnector` interface
- `package.json` — add `@google-cloud/bigquery` dependency

**Claude Code prompt:**

```
Read src/types/connector.ts for the WarehouseConnector interface. Then implement
the BigQuery connector.

Create src/connectors/bigquery.ts that:

1. Implements the WarehouseConnector interface from src/types/connector.ts
2. Uses @google-cloud/bigquery client library
3. Constructor accepts: projectId, keyFilePath (optional — falls back to ADC)
4. getViewSchema(dataset, view) queries:
   SELECT column_name, data_type, description
   FROM `{project}.{dataset}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
   WHERE table_name = @viewName
   Use parameterized query for the WHERE clause. The FROM clause must use
   string literals for project/dataset (BQ does not support parameterized
   identifiers in FROM).
5. listViews(dataset) queries:
   SELECT table_name, table_type
   FROM `{project}.{dataset}.INFORMATION_SCHEMA.TABLES`
6. getColumnDescriptions(dataset, view) queries the same as getViewSchema
   but returns only column_name → description mapping.

CRITICAL CONSTRAINTS:
- All queries use parameterized syntax for WHERE values (never string interpolation
  for user-provided values)
- Project and dataset in FROM clauses use template literals (these are config values,
  not user input)
- No caching — always query live
- No schema inference — return exactly what INFORMATION_SCHEMA returns
- Handle connection errors gracefully (throw typed errors, don't crash)

Also: run `npm install @google-cloud/bigquery` to add the dependency.

Do NOT create any MCP tools. Do NOT modify src/index.ts. Connector only.
```

**Validation:**
```bash
npm run build   # Must compile clean
npm run lint
# Manual smoke test (requires BQ credentials):
# node -e "const m = await import('./dist/connectors/bigquery.js'); const { BigQueryConnector } = m; ..."
```

**Stop condition:** Connector compiles. All three methods are implemented with parameterized queries. No string interpolation of user input in SQL.

---

### Phase 3: Config Schema + Loader

**Goal:** Parse and validate the YAML config file. This is the annotation layer.

**Files to create/modify:**
- `src/config/loader.ts` — YAML parsing + validation
- `src/config/validator.ts` — config validation logic
- `config/schema-config.yaml` — empty starter config (connection section only)
- `package.json` — add `yaml` dependency

**Claude Code prompt:**

```
Read src/types/config.ts for the SchemaConfig type definition. Then implement
the config loader.

Create src/config/loader.ts that:

1. Reads a YAML file from a given path
2. Parses it using the `yaml` npm package
3. Validates the parsed object against the SchemaConfig type
4. Returns a typed SchemaConfig object
5. Throws descriptive errors for:
   - Missing required fields (connection.connector, connection.project)
   - Invalid rule types (must be ban_pattern, prefer_field, require_filter, date_type_rule)
   - Invalid severity values (must be error, warning, info)
   - Duplicate rule IDs
   - Missing required fields per rule type

Create src/config/validator.ts with the validation logic, separate from I/O.

Create config/schema-config.yaml with just:
  connection:
    connector: bigquery
    project: savvy-gtm-analytics
    datasets: [Tableau_Views, SavvyGTMData, savvy_analytics]

CRITICAL CONSTRAINTS:
- Do NOT add runtime defaults for missing annotations (no "inferred" annotations at load time)
- Do NOT merge sources at load time — merging happens at response time in tools
- Validation is strict: unknown top-level keys are warnings, invalid rule types are errors
- The loader does not touch the connector — it only reads YAML

Install the yaml package: npm install yaml

Do NOT create MCP tools. Do NOT modify src/index.ts beyond imports if needed.
```

**Validation:**
```bash
npm run build
npm run lint
# Test with starter config:
# node -e "const m = await import('./dist/config/loader.js'); console.log(JSON.stringify(m.loadConfig('./config/schema-config.yaml'), null, 2))"
```

**Stop condition:** Config loads and validates. Malformed YAML throws descriptive errors. No annotation merging at load time.

---

### Phase 4: Annotation Merger + `describe_view`

**Goal:** Build the primary tool. This is the most critical phase — it establishes the response contract, provenance tagging, and annotation merging that all other tools follow.

**Pre-step:** Before writing code, produce a short implementation plan covering: merger resolution logic, provenance assignment strategy, intent-routing approach, and dangerous_columns structured-object shape. Review the plan before applying code changes.

**Files to create/modify:**
- `src/config/merger.ts` — merges native config + warehouse descriptions, tags provenance
- `src/tools/describe-view.ts` — MCP tool handler
- `src/index.ts` — register `describe_view` tool

**Claude Code prompt:**

```
Read these files first:
- .claude/mcp-tool-spec.md (CANONICAL response shape for describe_view)
- .claude/config-schema.md (config format for views and fields)
- src/types/responses.ts (ViewDescription TypeScript type)
- src/types/config.ts (SchemaConfig)
- src/types/connector.ts (WarehouseConnector interface)
- src/connectors/bigquery.ts (connector implementation)
- src/config/loader.ts (config loader)
- README.md (describe_view spec — search for "describe_view")

Then implement the annotation merger and describe_view tool.

Create src/config/merger.ts that:

1. Takes a ViewSchema (from connector) and a SchemaConfig (from loader)
2. For each column, merges annotations from available sources
3. Resolution priority: native_config > dbt_meta > dbt_description > warehouse_description
4. Tags every annotation with its provenance source
5. Assigns confidence: high (native_config confirmed by live schema), medium (dbt or
   warehouse description), low (inferred or unconfirmed)
6. CRITICAL: Merging happens HERE at response time, NOT at config load time.
   This preserves provenance traceability.
7. Empty strings, whitespace-only strings, and "null" strings from any source
   do NOT override valid annotations from lower-priority sources.

Create src/tools/describe-view.ts that:

1. Accepts parameters: { view: string, dataset?: string, intent?: string }
2. Calls connector.getViewSchema() for live schema
3. Calls merger to combine live schema with config annotations
4. Returns a ViewDescription with ALL of these fields:
   - purpose (string, from config)
   - grain (string, from config)
   - dangerous_columns (array of structured objects, each with: column, reason,
     use_instead?, provenance, confidence — NOT plain strings)
   - key_filters (Record<string, { sql, provenance, confidence }>)
   - annotated_columns (array, each with: name, type,
     provenance, confidence, meaning?, use_instead_of?, gotcha?)
   - consumers (string[], from config, optional)
   - freshness_notes (string, from config, optional)
   - recommended_date_fields (Record<string, string>, from config, optional)
   - intent_warnings (string[], populated when intent param provided; empty array when no intent)
5. When intent is provided, scan rules for relevant warnings and surface them
   in intent_warnings (e.g., intent "count_sqos" surfaces dedup and recordtype rules)
6. Columns that exist in config but NOT in live schema are OMITTED from the
   response (they are stale — health_check will catch them)

Register describe_view in src/index.ts using the MCP SDK pattern:
  server.tool("describe_view", "Returns purpose, grain, key filters, dangerous
  columns, and annotated fields for a warehouse view. Always call this before
  writing SQL. Supports optional intent parameter for targeted warnings.", {
    view: z.string().describe("View or table name"),
    intent: z.string().optional().describe("What you're trying to do")
  }, async ({ view, intent }) => { ... });

The handler must return: { content: [{ type: "text", text: JSON.stringify(result) }] }
where result matches the ViewDescription type.
Use console.error for any logging — NEVER console.log.

CRITICAL CONSTRAINTS:
- Every annotated_column entry MUST have provenance and confidence
- Do NOT cache schema results
- Do NOT return columns that exist in config but not in live schema
- Do NOT invent annotations — if a column has no annotation, return it
  with provenance: 'live_schema' and confidence: 'low'
- The tool description MUST tell agents to call it before writing SQL

Do NOT implement any other tools yet.
```

**Validation:**
```bash
npm run build
npm run lint
# Start the MCP server and test with MCP Inspector:
# npx @modelcontextprotocol/inspector node dist/index.js
# Call describe_view with view: "vw_funnel_master", dataset: "Tableau_Views"
# Verify response has: purpose, grain, dangerous_columns, key_filters, annotated_columns, intent_warnings
# Verify each annotated_column has provenance and confidence
```

**Stop condition:** describe_view returns a complete ViewDescription. Every column has provenance + confidence. Intent parameter surfaces relevant warnings. Stale config columns are omitted. Response shape matches the contract in `src/types/responses.ts`.

After implementing describe_view, manually compare the actual JSON response from MCP Inspector against the canonical response shape in `.claude/mcp-tool-spec.md`. Verify:
- Every required field is present (even if empty/null for unconfigured views)
- provenance and confidence exist on every annotated_column entry
- dangerous_columns are objects with {column, reason, use_instead, provenance, confidence}, not plain strings
- intent_warnings is an empty array (not undefined) when no intent is provided
Document any deviations in `docs/response-contract-checklist.md`.

> **DO NOT CONTINUE IF:**
> - Any annotated_column is missing provenance or confidence
> - The response shape does not match `.claude/mcp-tool-spec.md` exactly
> - Columns in config but not in live schema are included in the response
> - `intent_warnings` is populated when no intent parameter was passed

**Human review checkpoint:** Review the merger resolution logic. Confirm that native config correctly overrides dbt and warehouse descriptions. Verify intent routing surfaces the right warnings for common intents.

---

### Phase 5: `health_check`

**Goal:** Detect drift between config and live schema.

**Files to create/modify:**
- `src/tools/health-check.ts` — MCP tool handler
- `src/index.ts` — register `health_check` tool

**Claude Code prompt:**

```
Read src/types/responses.ts for HealthCheckResult. Read the README section on
health_check. Then implement the health_check tool.

Create src/tools/health-check.ts that:

1. Accepts parameters: { dataset?: string } (optional — checks all configured datasets if omitted)
2. For each configured view, compares config annotations against live schema:
   - unannotated_fields: columns in live schema with no config annotation
   - stale_annotations: columns in config that don't exist in live schema
   - config_integrity: broken references, duplicate rule IDs, rules referencing
     non-existent fields
3. Returns HealthCheckResult matching the response contract:
   - unannotated_fields: Array<{ view, field, type }> — columns in live schema with no annotation
   - stale_annotations: Array<{ view, field, reason }> — config entries not in live schema
   - config_issues: Array<{ type, detail }> — broken refs, duplicate rules
   - summary: string (e.g., "2 unannotated fields, 1 stale annotation")
   - suggestion: string (actionable fix recommendation)
4. Suggestions should be specific: "annotate quarterly_goal_id in vw_funnel_master"
   not "add annotations"

Register in src/index.ts.

CRITICAL CONSTRAINTS:
- Config-vs-schema drift ONLY. No codebase scanning.
- Do NOT suggest removing fields from config that might be temporarily missing
  from schema (use "stale" language, not "delete")
- Do NOT attempt to auto-fix anything
- health_check must work even if the BigQuery connection fails (report connection
  error as a config_integrity issue)
```

**Validation:**
```bash
npm run build
npm run lint
# Test via MCP Inspector: call health_check
# Verify response has unannotated_fields, stale_annotations, config_issues, summary, suggestion
# Verify each unannotated_fields entry has view, field, type
```

**Stop condition:** health_check correctly categorizes drift into three buckets. Suggestions are actionable and specific. No codebase scanning.

---

### Phase 6: `list_views`

> **Build-order note:** The README lists `list_views` as step 9. This guide intentionally moves it to Phase 6 — immediately after `health_check` — because it is trivial to implement, provides early connector validation, and enables manual exploration throughout the remaining phases. This is an implementation-order deviation only; v1 product scope is unchanged.

**Goal:** View discovery with annotation status.

**Files to create/modify:**
- `src/tools/list-views.ts` — MCP tool handler
- `src/index.ts` — register `list_views` tool

**Claude Code prompt:**

```
Read src/types/responses.ts for ViewListEntry. Read the README list_views section.
Then implement the tool.

Create src/tools/list-views.ts that:

1. Accepts parameters: { dataset?: string, search?: string }
2. Queries connector.listViews() for all views in configured datasets
3. Cross-references with config to mark annotation status
4. Returns object matching the response contract:
   - views: Array<{ name, dataset, type ('VIEW' or 'BASE TABLE'),
     annotated (boolean), column_count (number) }>
   - total: number (total views found)
   - annotated: number (views with config entries)
5. If search parameter provided, filter results by substring match on name
6. Sort results: annotated views first, then alphabetical

Register in src/index.ts.

CRITICAL: list_views queries the connector — it shows what actually exists
in the warehouse. Annotation status is a bonus, not a requirement.
```

**Validation:**
```bash
npm run build
npm run lint
# Test: list_views({}) — returns all views across configured datasets
# Test: list_views({ search: "funnel" }) — filters to matching views
# Verify response has views array, total count, annotated count
# Verify each entry has name, dataset, type, annotated, column_count
```

**Stop condition:** View discovery works. Response shape matches contract (views array with total/annotated counts). Annotation status is correctly flagged. Search filtering works.

---

### Phase 7: `resolve_term`

**Goal:** Domain vocabulary lookup from the `terms` config section.

**Files to create/modify:**
- `src/tools/resolve-term.ts` — MCP tool handler
- `src/index.ts` — register `resolve_term` tool

**Claude Code prompt:**

```
Read src/types/responses.ts for TermDefinition. Read the README resolve_term section.
Then implement the tool.

Create src/tools/resolve-term.ts that:

1. Accepts parameters: { term: string }
2. Looks up the term in config.terms (case-insensitive match)
3. Also searches fields and rules for related entries (e.g., term "SQO" finds
   fields with "sqo" in the name, rules mentioning "sqo")
4. Returns TermDefinition matching the response contract:
   - term: string (normalized)
   - definition: string (from config.terms, or "Not found")
   - found: boolean (true if term exists in config)
   - related_fields: string[] (field names containing the term)
   - related_rules: string[] (rule IDs mentioning the term)
   - gotchas: string[] (relevant warnings, e.g., "SQL__c means SQO status")
   - provenance: 'native_config'
   - confidence: 'high' if exact match, 'medium' if fuzzy/related only
5. If term is not found, return found: false, definition: "Not found",
   confidence: 'high' (confident that it's not defined). Do NOT hallucinate a definition.

Register in src/index.ts.

CRITICAL: Never invent definitions. If a term isn't in the config, say so explicitly.
```

**Validation:**
```bash
npm run build
npm run lint
# Test: resolve_term({ term: "SQO" }) — should return definition + related fields
# Test: resolve_term({ term: "nonexistent" }) — should return not-found with high confidence
```

**Stop condition:** Term lookup works for exact and case-insensitive matches. Unknown terms return explicit not-found. No hallucinated definitions.

---

### Phase 8: `get_rule`

**Goal:** Named rule retrieval from the `rules` config section.

**Files to create/modify:**
- `src/tools/get-rule.ts` — MCP tool handler
- `src/index.ts` — register `get_rule` tool

**Claude Code prompt:**

```
Read src/types/responses.ts for RuleResult. Read the README get_rule section.
Then implement the tool.

Create src/tools/get-rule.ts that:

1. Accepts parameters: { rule_id?: string, search?: string }
2. If rule_id provided: exact lookup by ID
3. If search provided: find rules whose message, pattern, or found/prefer fields
   contain the search string (case-insensitive substring match)
4. Returns RuleResult (or array of RuleResult) with:
   - id: string
   - type: 'ban_pattern' | 'prefer_field' | 'require_filter' | 'date_type_rule'
   - severity: 'error' | 'warning' | 'info'
   - message: string
   - pattern/found/prefer/when_contains/required: (type-specific fields)
   - provenance: 'native_config'
   - confidence: 'high'
5. If rule not found, return explicit not-found response.

Register in src/index.ts.

CRITICAL: Return rule definitions EXACTLY as configured. Do NOT reword, summarize,
or expand the rule message. The config is authoritative.
```

**Validation:**
```bash
npm run build
npm run lint
# Test: get_rule({ rule_id: "no_old_join" }) — exact match
# Test: get_rule({ search: "sqo" }) — finds dedup_filter and record_type_guard
```

**Stop condition:** Rule retrieval by ID and search work. Response shape matches contract. Rules are returned verbatim from config.

---

### Phase 9: `get_metric`

**Goal:** Metric definitions with computation logic and mode guidance.

**Files to create/modify:**
- `src/tools/get-metric.ts` — MCP tool handler
- `src/index.ts` — register `get_metric` tool

**Claude Code prompt:**

```
Read src/types/responses.ts for MetricResult. Read the README get_metric section.
Then implement the tool.

Create src/tools/get-metric.ts that:

1. Accepts parameters: { metric: string, mode?: 'cohort' | 'period' }
2. Looks up metric in config.metrics
3. Returns MetricResult with:
   - name: string
   - numerator: string (description or field reference)
   - denominator: string (description or field reference)
   - mode: 'cohort' | 'period' | 'both' (which modes apply)
   - mode_guidance: string (when to use each mode)
   - gotchas: string[] (mode-specific warnings)
   - date_anchor: string (which date field anchors the calculation)
   - related_rules: string[] (rule IDs that affect this metric)
   - provenance: 'native_config'
   - confidence: 'high'
4. If mode is specified, return mode-specific numerator/denominator/guidance.
   For cohort mode: numerator is a progression flag, denominator is eligibility flag.
   For period mode: different population logic.
5. Return the formula EXACTLY as written in config — do NOT evaluate or rewrite it.

Register in src/index.ts.

CRITICAL: Metric definitions must be deterministic — same metric + same mode
always produces the same response. Do NOT add computation logic beyond lookup.
```

**Validation:**
```bash
npm run build
npm run lint
# Test: get_metric({ metric: "sql_to_sqo", mode: "cohort" })
# Verify: numerator references sql_to_sqo_progression, denominator references eligible_for_sql_conversions
# Test: get_metric({ metric: "nonexistent" }) — clear not-found
```

**Stop condition:** Metric lookup works. Mode-specific responses are correct. Formulas returned verbatim.

**Human review checkpoint:** Review metric definitions in config before proceeding. Confirm numerator/denominator/date_anchor are correct for each metric. This is business logic — get it right here.

---

### Phase 10: `lint_query`

**Goal:** Heuristic SQL linting against configured rules. Substring-based only.

**Pre-step:** Before writing code, produce a short implementation plan covering: comment-stripping approach, per-rule-type matching logic, and the exact response shape from the contract. Review the plan before applying code changes.

**Files to create/modify:**
- `src/tools/lint-query.ts` — MCP tool handler
- `src/index.ts` — register `lint_query` tool

**Claude Code prompt:**

```
Read src/types/responses.ts for LintFinding. Read the README lint_query section.
Then implement the tool.

Create src/tools/lint-query.ts that:

1. Accepts parameters: { sql: string }
2. Pre-processes the SQL:
   - Strip SQL comments (-- line comments and /* block comments */)
   - Normalize to lowercase for matching
3. Checks the normalized SQL against all configured rules:
   - ban_pattern: if rule.pattern substring found -> violation
   - prefer_field: if rule.found substring found AND rule.prefer NOT found -> violation
   - require_filter: if ANY rule.when_contains substring found AND rule.required NOT found -> violation
   - date_type_rule: if rule.field found with wrong wrapper -> violation
4. Returns object with:
   - warnings: array of { rule_id, type, severity, message, confidence: 'medium',
     provenance: 'native_config' }
   - passed: boolean (true if no warnings)
   - note: "Heuristic linting — substring-based, not AST. Treat as guidance."
   Match the EXACT response shape from .claude/mcp-tool-spec.md.

Register in src/index.ts.

CRITICAL CONSTRAINTS:
- SUBSTRING MATCHING ONLY. No regex. No AST parsing. No SQL parser libraries.
- Strip comments before matching (avoid false positives on commented-out code)
- Case-insensitive matching (lowercase normalization)
- Every finding must trace to a configured rule ID — no free-form "AI" findings
- Confidence is always 'medium' for lint findings (acknowledge substring limitations)
- Do NOT auto-fix or rewrite SQL. Return findings only.
- prefer_field uses a "without" check: only flag if the preferred field is absent
```

**Validation:**
```bash
npm run build
npm run lint
# Test with SQL containing "is_sqo = 1" without "is_sqo_unique" -> should flag prefer_field
# Test with SQL containing "new_mapping" -> should flag ban_pattern
# Test with SQL containing "is_sqo_unique = 1" and "recordtypeid" -> should be clean
# Test with commented-out bad pattern: "-- is_sqo = 1" -> should NOT flag
```

**Stop condition:** All four rule types lint correctly. Comments are stripped. Case-insensitive. No AST, no regex, no auto-fix. Confidence is 'medium'.

> **DO NOT CONTINUE IF:**
> - Any regex is used (substring only)
> - Any SQL parser library is imported
> - Any AST construction is attempted
> - lint_query modifies or rewrites the input SQL
> - Confidence on lint findings is anything other than 'medium'

---

### Phase 11a: Savvy Wealth Config Bootstrap — Views + Terms

**Goal:** Generate the `views` and `terms` sections first, using only the source docs relevant to those sections.

**Files to create/modify:**
- `config/schema-config.yaml` — bootstrap config draft

**Claude Code prompt:**

```
Read ONLY these files first:
- docs/bootstrap/savvy/bq-views.md
- README.md (config schema reference)
- .claude/config-schema.md (authoritative YAML shape)

Then update config/schema-config.yaml with:

1. views section for all 7+ relevant views
   - include purpose, grain, consumers, key_filters, dangerous_columns, freshness_notes
   - dangerous_columns entries must be structured objects with: column, reason,
     optional use_instead — not plain strings
2. terms section for all 10+ business terms grounded in the source doc

CRITICAL CONSTRAINTS:
- Read bq-views.md only for this subphase. Do NOT pull in the other bootstrap docs yet.
- Every view entry must stay grounded in the source doc.
- dangerous_columns must be structured objects ({column, reason, use_instead?}), not plain strings.
- freshness_notes must be captured wherever the source doc gives operational cadence or caveats.
- Do NOT generate fields, rules, or metrics in this subphase.
```

**Validation:**
```bash
npm run build
# Validate config loads without errors:
# node -e "const m = await import('./dist/config/loader.js'); const c = m.loadConfig('./config/schema-config.yaml'); console.log('Views:', Object.keys(c.views || {}).length, 'Terms:', Object.keys(c.terms || {}).length)"
# Spot-check 2-3 generated view/term entries against docs/bootstrap/savvy/bq-views.md
```

**Stop condition:** At least 7 views and 10 terms are present, the config still validates, and 2-3 spot-checks match the source doc.

---

### Phase 11b: Savvy Wealth Config Bootstrap — Fields

**Goal:** Generate the `fields` section only, using the field- and activity-specific docs.

**Files to create/modify:**
- `config/schema-config.yaml` — bootstrap config draft

**Claude Code prompt:**

```
Read ONLY these files first:
- docs/bootstrap/savvy/bq-field-dictionary.md
- docs/bootstrap/savvy/bq-activity-layer.md
- README.md (config schema reference)
- .claude/config-schema.md (authoritative YAML shape)

Then update config/schema-config.yaml with the fields section.

Generate all 25+ field annotations with:
- meaning
- type_info
- use_instead_of
- gotcha

CRITICAL CONSTRAINTS:
- Read only the two source docs above for this subphase.
- Keep DATE vs TIMESTAMP annotations explicit.
- Preserve dedup flag semantics (`is_sqo_unique`, `is_joined_unique`, `is_primary_opp_record`).
- Do NOT generate rules or metrics in this subphase.
```

**Validation:**
```bash
npm run build
# Validate config loads without errors:
# node -e "const m = await import('./dist/config/loader.js'); const c = m.loadConfig('./config/schema-config.yaml'); console.log('Fields:', Object.keys(c.fields || {}).length)"
# Verify DATE vs TIMESTAMP annotations are correct
# Verify dedup flag annotations are present and not conflated
```

**Stop condition:** At least 25 fields are annotated, DATE vs TIMESTAMP annotations are correct, dedup flags are clearly annotated, and the config validates.

---

### Phase 11c: Savvy Wealth Config Bootstrap — Rules

**Goal:** Generate the `rules` section only, using the rules/patterns docs.

**Files to create/modify:**
- `config/schema-config.yaml` — bootstrap config draft

**Claude Code prompt:**

```
Read ONLY these files first:
- docs/bootstrap/savvy/bq-patterns.md
- docs/bootstrap/savvy/bq-activity-layer.md
- README.md (config schema reference)
- .claude/config-schema.md (authoritative YAML shape)

Then update config/schema-config.yaml with the rules section.

Generate all 12+ rules using typed primitives only:
- ban_pattern
- prefer_field
- require_filter
- date_type_rule

CRITICAL CONSTRAINTS:
- Read only the two source docs above for this subphase.
- No free-text rules.
- Every rule must map cleanly to one of the four allowed primitives.
- Do NOT generate metrics in this subphase.
```

**Validation:**
```bash
npm run build
# Validate config loads without errors:
# node -e "const m = await import('./dist/config/loader.js'); const c = m.loadConfig('./config/schema-config.yaml'); console.log('Rules:', (c.rules || []).length)"
# Verify every rule type is one of: ban_pattern, prefer_field, require_filter, date_type_rule
# Verify no free-text rules were created
```

**Stop condition:** At least 12 rules are defined, every rule uses a valid type primitive, no free-text rules remain, and the config validates.

---

### Phase 11d: Savvy Wealth Config Bootstrap — Metrics

**Goal:** Generate the `metrics` section only, using the metric-specific parts of the docs.

**Files to create/modify:**
- `config/schema-config.yaml` — bootstrap config draft

**Claude Code prompt:**

```
Read ONLY these files first:
- docs/bootstrap/savvy/bq-patterns.md (cohort vs period section)
- docs/bootstrap/savvy/bq-field-dictionary.md (eligibility/progression flags)
- README.md (config schema reference)
- .claude/config-schema.md (authoritative YAML shape)

Then update config/schema-config.yaml with the metrics section.

Generate all conversion-rate metric definitions with cohort + period modes.
For each metric, define:
- numerator
- denominator
- date_anchor
for each declared mode.

CRITICAL CONSTRAINTS:
- Read only the two source docs above for this subphase.
- Keep cohort and period definitions separate where the source docs separate them.
- Do NOT invent denominator logic that is not grounded in the docs.
```

**Validation:**
```bash
npm run build
# Validate config loads without errors:
# node -e "const m = await import('./dist/config/loader.js'); const c = m.loadConfig('./config/schema-config.yaml'); console.log('Metrics:', Object.keys(c.metrics || {}).length)"
# Verify each metric has numerator, denominator, and date_anchor for each declared mode
```

**Stop condition:** Every declared metric has numerator, denominator, and date_anchor for each mode, and the config validates.

---

### Phase 11e: Savvy Wealth Config Bootstrap — Review + Normalize

**Goal:** Review the complete generated config against all bootstrap docs, normalize gaps, and tag the reviewed bootstrap artifact.

**Pre-step:** Before making changes, produce a short plan listing: which source doc sections to cross-reference, what gap categories to check (missing rules, missing dangerous_columns, malformed primitives, missing freshness_notes, metric correctness), and the review sequence. Review the plan before applying fixes.

**Files to create/modify:**
- `config/schema-config.yaml` — reviewed bootstrap config
- `docs/bootstrap-coverage-checklist.md` — update migration status

**Claude Code prompt:**

```
Read the complete generated config/schema-config.yaml.
Then cross-reference it against ALL five source docs:
- docs/bootstrap/savvy/bq-views.md
- docs/bootstrap/savvy/bq-field-dictionary.md
- docs/bootstrap/savvy/bq-patterns.md
- docs/bootstrap/savvy/bq-activity-layer.md
- docs/bootstrap/savvy/bq-salesforce-mapping.md

Check for:
- missing rules
- missing dangerous_columns
- missing freshness_notes
- malformed rule types
- incorrect metric definitions

Fix any gaps found.
Update docs/bootstrap-coverage-checklist.md with migrated / pending / intentionally deferred status.
Tag the reviewed result as v0.1.0-bootstrap.

CRITICAL CONSTRAINTS:
- Keep all rules on typed primitives only: ban_pattern, prefer_field, require_filter, date_type_rule.
- Do NOT add golden test values to config.
- The human review checkpoint happens here against the full config, not earlier.
```

**Validation:**
```bash
npm run build
# Validate config loads without errors:
# node -e "const m = await import('./dist/config/loader.js'); const c = m.loadConfig('./config/schema-config.yaml'); console.log('Views:', Object.keys(c.views || {}).length, 'Fields:', Object.keys(c.fields || {}).length, 'Rules:', (c.rules || []).length, 'Terms:', Object.keys(c.terms || {}).length, 'Metrics:', Object.keys(c.metrics || {}).length)"
# Cross-check the complete config against all five source docs
# Tag reviewed bootstrap artifact as v0.1.0-bootstrap
```

**Stop condition:** Config covers all five source docs. All rules use typed primitives. No free-text rules. All critical fields annotated. Human review completes here before proceeding.

> **DO NOT CONTINUE IF:**
> - Any rule uses a type other than ban_pattern, prefer_field, require_filter, or date_type_rule
> - Any metric is missing numerator or denominator for its declared modes
> - Fewer than 12 rules are defined
> - Fewer than 7 views are annotated
> - Fewer than 20 fields are annotated

**Human review checkpoint (CRITICAL):** This is the most important human review. Compare the generated config against each source doc section by section. Check for:
- Missing rules (especially negative rules like "never add AUM fields")
- Malformed rule primitives
- Missing dangerous-column annotations
- Missing sync cadence notes
- Correct metric numerator/denominator/anchor definitions
Tag as `v0.1.0-bootstrap` after review.

---

### Phase 12: Eval Runner

**Goal:** Build the three-track eval harness with failure attribution and scoring.

**Pre-step:** Before writing code, produce a short implementation plan covering: runner CLI interface, YAML case loading strategy, per-track scoring logic, failure attribution decision tree, and output format. Review the plan before applying code changes.

**Files to create/modify:**
- `src/eval/runner.ts` — eval harness entry point
- `src/eval/loader.ts` — YAML test case loader
- `src/eval/scorer.ts` — pattern matching and scoring
- `src/eval/attribution.ts` — failure categorization
- `tests/cases/track-a/` — SQL correctness test cases (from testing-protocol.md)
- `tests/cases/track-b/` — knowledge retrieval assertions
- `tests/cases/track-c/` — workflow replacement scenarios
- `tests/cases/negative-controls/` — negative control cases
- `tests/fixtures/golden-results.yaml` — golden result fixtures
- `tests/fixtures/true-north.yaml` — business-approved true-north fixtures (Q1 2025, Q2 2025)

**Claude Code prompt:**

```
Read src/types/eval.ts for EvalCase and EvalOutcome types. Read testing-protocol.md
for the full test case specifications and scoring model. Then implement the eval runner.

Create src/eval/runner.ts that:

1. Accepts CLI args: --cases <dir> --config <path> [--track a|b|c] [--case <id>]
   [--fixtures <dir>]
2. Loads YAML test cases from the cases directory
3. Loads golden-results.yaml and true-north.yaml from the fixtures directory
4. For each case, runs the appropriate checks:
   - Track A: required_patterns (must be present), banned_patterns (must be absent),
     negative_controls
   - Track B: knowledge_assertions (expected answers)
   - Track C: workflow validation (structural checks)
   - Fixture checks: compare collected/executed outputs against golden-results
     and true-north fixtures when matched by case ID or period
4. For fixture comparisons:
   - Exact match for integer counts (sqls, sqos, signed_advisors, etc.)
   - Optional tolerance for percentage-based values (conversion rates) —
     default ±0.005 unless overridden per fixture
   - Report mismatches with expected vs actual and delta
5. Scores each case: pass / partial / fail
6. Attributes failures: config_gap, surfacing_failure, evaluator_strict, agent_reasoning
7. True-north fixture failures are flagged as promotion-relevant
   (distinct from development-only golden-result failures)
8. Emits structured output (JSON) with per-case and suite-level scores
9. Exits with code 1 if any case fails (for CI integration)

Create src/eval/loader.ts — reads YAML test case files.

Create src/eval/scorer.ts — implements pattern matching:
- required_patterns: substring check (case-insensitive) on SQL or tool response
- banned_patterns: substring check with optional "without" clause
- knowledge_assertions: contains-check on tool response text
- negative_controls: must-not-contain checks

Create src/eval/attribution.ts — categorizes failures based on:
- Is the knowledge in the config? No → config_gap
- Is the knowledge in the config but not returned? → surfacing_failure
- Is the test too strict? → evaluator_strict
- Did the agent have context but reason wrong? → agent_reasoning

Create test case YAML files from testing-protocol.md:
- tests/cases/track-a/*.yaml — all 10 cases (A1-A10)
- tests/cases/track-b/*.yaml — all 22 knowledge assertions
- tests/cases/track-c/*.yaml — all 4 workflow cases
- tests/cases/negative-controls/*.yaml — all 5 negative controls
- tests/fixtures/golden-results.yaml — golden result baselines
- tests/fixtures/true-north.yaml — business-approved true-north values
  (Q1 2025 + Q2 2025 topline funnel and conversion rates)

CRITICAL CONSTRAINTS:
- Eval cases are YAML, not JS/TS
- The runner evaluates pattern presence/absence — it does NOT execute SQL
- The runner does NOT call MCP tools itself — it evaluates pre-collected responses
  OR it can be wired to call tools (runner modes: "offline" for pattern checks,
  "online" for live tool calls)
- Failure attribution must use the exact 4 categories, no others
- Process must exit(1) on any failure
- Do NOT add golden or true-north values to schema-config.yaml — they stay in fixtures
- True-north fixture mismatches must be clearly labeled as promotion-blocking failures
  in the output
```

**Validation:**
```bash
npm run build
npm run lint
# Run eval against the config:
# node dist/eval/runner.js --cases tests/cases/track-b --config config/schema-config.yaml
# Verify structured JSON output with per-case scores
# Verify exit code 1 for failures, 0 for all-pass
```

**Stop condition:** Runner loads cases and fixtures, scores them, attributes failures, and exits with correct code. All test case YAML files match testing-protocol.md. True-north fixtures load and compare correctly.

> **DO NOT CONTINUE IF:**
> - Track B knowledge retrieval passes fewer than 18/22 assertions
> - The runner does not exit(1) on any failure
> - Failure attribution uses categories other than the four defined types
> - Test cases or fixtures reference values that belong in fixtures, not config
> - True-north fixture loading or comparison is not implemented

---

### Phase 13: Doc-Bootstrap Command

**Goal:** One-shot command to generate initial config from existing static docs.

**Files to create/modify:**
- `src/bootstrap/extract.ts` — doc extraction logic
- `src/bootstrap/emit-config.ts` — YAML config generation
- `src/index.ts` — register bootstrap as a CLI command (not an MCP tool)

**Claude Code prompt:**

```
Read the README "Getting Started" section and testing-protocol.md Phase 0.
Then implement the doc-bootstrap command.

Create src/bootstrap/extract.ts that:

1. Reads markdown files from a specified directory
2. Extracts structured knowledge: view purposes, field types, rules, terms
3. Tags every extracted annotation with provenance: 'bootstrap' and
   confidence: 'low' (bootstrap extractions need human review)
4. Does NOT infer semantics — extraction only

Create src/bootstrap/emit-config.ts that:

1. Takes extracted knowledge and emits a schema-config.yaml
2. Uses the correct config schema format
3. Every annotation has provenance and confidence tags
4. Includes TODO comments for fields that need human review

Wire this as a CLI subcommand: schema-context-mcp bootstrap --docs <dir> --output <path>

CRITICAL CONSTRAINTS:
- This is EXTRACTION, not inference. Do not add annotations beyond what the docs state.
- Every generated annotation must have confidence: 'low' by default
- The output must be valid YAML that passes the config validator
- Do NOT auto-promote to production config. Output is a draft for human review.
```

**Validation:**
```bash
npm run build
# Test bootstrap:
# node dist/index.js bootstrap --docs docs/bootstrap/savvy --output /tmp/test-config.yaml
# Validate output loads:
# node -e "const m = await import('./dist/config/loader.js'); m.loadConfig('/tmp/test-config.yaml')"
```

**Stop condition:** Bootstrap generates valid YAML from markdown docs. All annotations have low confidence. Output passes validation.

---

## 4. File Touch Map

| Phase | Files Created/Modified |
|---|---|
| 1. Scaffolding | `src/types/config.ts`, `src/types/connector.ts`, `src/types/responses.ts`, `src/types/eval.ts`, `src/index.ts` |
| 2. BQ Connector | `src/connectors/bigquery.ts`, `package.json` |
| 3. Config Loader | `src/config/loader.ts`, `src/config/validator.ts`, `config/schema-config.yaml`, `package.json` |
| 4. describe_view | `src/config/merger.ts`, `src/tools/describe-view.ts`, `src/index.ts` |
| 5. health_check | `src/tools/health-check.ts`, `src/index.ts` |
| 6. list_views | `src/tools/list-views.ts`, `src/index.ts` |
| 7. resolve_term | `src/tools/resolve-term.ts`, `src/index.ts` |
| 8. get_rule | `src/tools/get-rule.ts`, `src/index.ts` |
| 9. get_metric | `src/tools/get-metric.ts`, `src/index.ts` |
| 10. lint_query | `src/tools/lint-query.ts`, `src/index.ts` |
| 11a. Config Bootstrap — Views + Terms | `config/schema-config.yaml` |
| 11b. Config Bootstrap — Fields | `config/schema-config.yaml` |
| 11c. Config Bootstrap — Rules | `config/schema-config.yaml` |
| 11d. Config Bootstrap — Metrics | `config/schema-config.yaml` |
| 11e. Config Bootstrap — Review + Normalize | `config/schema-config.yaml`, `docs/bootstrap-coverage-checklist.md` |
| 12. Eval Runner | `src/eval/runner.ts`, `src/eval/loader.ts`, `src/eval/scorer.ts`, `src/eval/attribution.ts`, `tests/cases/**/*.yaml`, `tests/fixtures/golden-results.yaml`, `tests/fixtures/true-north.yaml` |
| 13. Doc Bootstrap | `src/bootstrap/extract.ts`, `src/bootstrap/emit-config.ts`, `src/index.ts` |

---

## 5. Response Contract Checkpoints

> **Authoritative source:** `.claude/mcp-tool-spec.md` defines the canonical response shapes.
> The TypeScript types in `src/types/responses.ts` must match these shapes exactly.
> The contracts below summarize the spec for quick reference — when in doubt, defer to mcp-tool-spec.md.

### `describe_view`

```typescript
// Matches .claude/mcp-tool-spec.md describe_view response shape
{
  view: string;
  purpose: string;                    // from config
  grain: string;                      // from config
  intent_warnings: string[];          // populated when intent param provided
  dangerous_columns: Array<{          // from config — objects, not plain strings
    column: string;
    reason: string;
    use_instead?: string;
    provenance: ProvenanceSource;
    confidence: ConfidenceLevel;
  }>;
  key_filters: Record<string, {       // from config
    sql: string;
    provenance: ProvenanceSource;
    confidence: ConfidenceLevel;
  }>;
  annotated_columns: Array<{
    name: string;
    type: string;                     // from live schema
    meaning?: string;                 // from config fields section
    use_instead_of?: string;          // from config fields section
    gotcha?: string;                  // from config fields section
    provenance: ProvenanceSource;     // which source provided the annotation
    confidence: ConfidenceLevel;      // how grounded the annotation is
  }>;
  consumers?: string[];               // from config
  recommended_date_fields?: Record<string, string>;  // from config
}
```

**Validation check:** Every `annotated_columns` entry MUST have non-null `provenance` and `confidence`. A response with any column missing these fields is a bug.

### `health_check`

```typescript
// Matches .claude/mcp-tool-spec.md health_check response shape
{
  unannotated_fields: Array<{
    view: string;
    field: string;
    type: string;
  }>;
  stale_annotations: Array<{
    view: string;
    field: string;
    reason: string;
  }>;
  config_issues: Array<{
    type: string;                    // e.g., "broken_reference", "duplicate_rule"
    detail: string;
  }>;
  summary: string;                   // e.g., "2 unannotated fields, 1 stale annotation"
  suggestion: string;                // actionable fix
}
```

**Validation check:** Three drift categories always present, even if empty. Suggestions are specific to individual fields/views.

### `get_metric`

```typescript
{
  name: string;
  numerator: string;                 // field or formula reference
  denominator: string;               // field or formula reference
  mode: 'cohort' | 'period' | 'both';
  mode_guidance: string;             // when to use each mode
  date_anchor: string;               // which date field anchors the calculation
  gotchas: string[];                 // mode-specific warnings
  related_rules: string[];           // rule IDs that affect this metric
  provenance: 'native_config';
  confidence: 'high';
}
```

**Validation check:** numerator and denominator are returned verbatim from config. mode_guidance is present.

### `get_rule`

```typescript
{
  id: string;
  type: 'ban_pattern' | 'prefer_field' | 'require_filter' | 'date_type_rule';
  severity: 'error' | 'warning' | 'info';
  message: string;
  // Type-specific fields:
  pattern?: string;                  // ban_pattern
  found?: string;                    // prefer_field
  prefer?: string;                   // prefer_field
  context?: string;                  // prefer_field
  when_contains?: string[];          // require_filter
  required?: string;                 // require_filter
  provenance: 'native_config';
  confidence: 'high';
}
```

**Validation check:** Rule returned verbatim. Type-specific fields match the rule type.

### `lint_query`

```typescript
// Matches .claude/mcp-tool-spec.md lint_query response shape
{
  warnings: Array<{
    rule_id: string;
    type: 'ban_pattern' | 'prefer_field' | 'require_filter' | 'date_type_rule';
    severity: 'error' | 'warning';
    message: string;
    confidence: 'medium';            // Always medium — substring matching
    provenance: 'native_config';
  }>;
  passed: boolean;                   // true if no warnings
  note: "Heuristic linting — substring-based, not AST. Treat as guidance.";
}
```

**Validation check:** Every violation traces to a configured rule ID. `confidence` is always `'medium'`. No free-form findings.

### `resolve_term`

```typescript
{
  term: string;
  definition: string;                // from config.terms, or "Not found"
  found: boolean;
  related_fields: string[];
  related_rules: string[];
  gotchas: string[];
  provenance: 'native_config';
  confidence: 'high' | 'medium';    // high for exact match, medium for fuzzy
}
```

**Validation check:** Unknown terms return `found: false` with `confidence: 'high'`. No hallucinated definitions.

### `list_views`

```typescript
// Matches .claude/mcp-tool-spec.md list_views response shape
{
  views: Array<{
    name: string;
    dataset: string;
    type: string;                    // 'VIEW' or 'BASE TABLE'
    annotated: boolean;
    column_count: number;
  }>;
  total: number;
  annotated: number;
}
```

**Validation check:** View list comes from live schema. Annotation status cross-referenced with config.

---

During Phase 4, generate `docs/response-contract-checklist.md` from the response contracts above. Use this as a manual verification artifact after each tool is implemented. Check off each required field in the response shape.

---

## 6. Eval Plan by Phase

### Progressive Eval Matrix

| After Phase | Eval Cases Runnable | Command |
|---|---|---|
| 4 (`describe_view`) | Track B: describe-view subset (5 cases) | `node dist/eval/runner.js --cases tests/cases/track-b/describe-view` |
| 5 (`health_check`) | + health_check shape test | Manual verification via MCP Inspector |
| 6 (`list_views`) | + Track B: view discovery (3 cases) | Full Track B: `node dist/eval/runner.js --cases tests/cases/track-b` |
| 7 (`resolve_term`) | + Track B: term lookups (4 cases) | `node dist/eval/runner.js --cases tests/cases/track-b/terms` |
| 8 (`get_rule`) | + Track B: rule lookups (6 cases) | `node dist/eval/runner.js --cases tests/cases/track-b/rules` |
| 9 (`get_metric`) | + Track B: metric lookups (3 cases), Track A: A5 | `node dist/eval/runner.js --cases tests/cases/track-b` |
| 10 (`lint_query`) | + Track A: A1, A2, A3, A4 + negative controls | `node dist/eval/runner.js --cases tests/cases/track-a/basic` |
| 12 (Eval runner) | ALL tracks, ALL negative controls | `node dist/eval/runner.js --cases tests/cases --config config/schema-config.yaml` |

### Track Priorities

1. **Track B first** — knowledge retrieval validates that the config contains the right information. If Track B fails, Track A and C will fail for the wrong reasons.
2. **Track A basic cases second** — A1 (SQO count), A2 (Joined count), A3 (SGA activity), A4 (pipeline AUM). These validate the most common failure modes.
3. **Track A intermediate/advanced third** — A5-A10. These require more config depth.
4. **Negative controls alongside Track A** — run them as soon as lint_query is available.
5. **Track C last** — workflow replacement requires all tools to be working. Only meaningful after Tracks A and B are stable.

### Required Negative Controls

- `neg-prospect-no-recordtype` — must NOT apply recordtypeid to lead-level metrics
- `neg-aum-uses-primary-opp` — must use is_primary_opp_record for AUM (not flag as error)
- `neg-effort-uses-executor` — must use task_executor_name, not SGA_Owner_Name__c for effort
- `neg-closedate-legitimate` — asking about CloseDate itself is valid
- `neg-cohort-no-recordtype` — cohort mode eligibility flags handle record types internally

### Golden Result Fixtures and True-North Fixtures

Two fixture types live in `tests/fixtures/`. Neither belongs in `config/schema-config.yaml`, `fields`, `rules`, `metrics`, or MCP tool responses.

**Golden fixtures** (`tests/fixtures/golden-results.yaml`) — fixed expected outputs for stable historical windows. Used for regression checks during development:
- Q1 2026 SQO count by channel (from dashboard)
- Q1 2026 Joined count (from dashboard)
- Q4 2025 SQL-to-SQO cohort conversion rate (from prior analysis)

**True-north fixtures** (`tests/fixtures/true-north.yaml`) — highest-trust, business-approved outputs for approved historical periods. Used as **promotion-grade validation checks**. A true-north failure blocks promotion.

#### True-North Fixture Format

```yaml
true_north:
  - id: q1_2025_topline_funnel
    period: Q1 2025
    type: topline_funnel
    expected:
      sqls: 122
      sqos: 96
      signed_advisors: 11
      signed_aum: 472900000
      advisors_joined: 12
      joined_aum: 462900000
      open_pipeline_aum: 26500000000
    source: business_approved
    owner: RevOps
    last_verified: 2026-04-07

  - id: q1_2025_conversion_rates
    period: Q1 2025
    type: conversion_rates_resolved_only
    expected:
      contacted_to_mql: 0.056
      mql_to_sql: 0.323
      sql_to_sqo: 0.708
      sqo_to_joined: 0.122
    source: business_approved
    owner: RevOps
    last_verified: 2026-04-07

  - id: q2_2025_topline_funnel
    period: Q2 2025
    type: topline_funnel
    expected:
      sqls: 155
      sqos: 110
      signed_advisors: 19
      signed_aum: 1500000000
      advisors_joined: 12
      joined_aum: 578000000
      open_pipeline_aum: 26500000000
    source: business_approved
    owner: RevOps
    last_verified: 2026-04-07

  - id: q2_2025_conversion_rates
    period: Q2 2025
    type: conversion_rates_resolved_only
    expected:
      contacted_to_mql: 0.048
      mql_to_sql: 0.402
      sql_to_sqo: 0.686
      sqo_to_joined: 0.120
    source: business_approved
    owner: RevOps
    last_verified: 2026-04-07
```

#### Boundary: Config vs Fixtures

| Data type | Where it lives | Purpose |
|---|---|---|
| Semantic logic (rules, metrics, field meaning) | `config/schema-config.yaml` | Teaches the MCP what queries should look like |
| Historical expected outcomes (counts, rates) | `tests/fixtures/true-north.yaml` | Validates that queries produce correct numbers |
| Regression baselines | `tests/fixtures/golden-results.yaml` | Catches regressions during development |

True-north values validate the system. They do not teach it. Never copy numeric expected outcomes into semantic config definitions.

---

## 7. Human Review Checkpoints

| Checkpoint | Phase | What to Review | Why |
|---|---|---|---|
| Config schema types | 1 | `src/types/config.ts` — are the TypeScript types complete and correct? | Foundation for everything. Wrong types propagate everywhere. |
| Merger resolution logic | 4 | `src/config/merger.ts` — does native config correctly override? Are empty strings handled? | Incorrect resolution priority is a silent, pervasive bug. |
| Metric definitions | 9 + 11e | Numerator/denominator/anchor for each metric in config | Business logic — the eval can't catch wrong definitions, only missing ones. |
| Business rule encoding | 11e | All 12+ rules in `config/schema-config.yaml` | Rules are the core value prop. Wrong rules are worse than no rules. |
| Pre-promotion readiness | 12 | Full config diff vs bootstrap docs. Run testing-protocol.md promotion gate. All true-north fixtures must pass. | Final human sign-off before archiving legacy docs. True-north failure blocks promotion. |

---

## 8. Low-Risk Auto-Fix Boundary

### Allowed for automated patch generation (no human approval needed):

- Adding missing field annotations (meaning, type_info, gotcha)
- Adding missing ban_pattern / prefer_field / require_filter rules
- Strengthening intent surfacing (adjusting which rules surface for which intents)
- Adding dangerous_column entries
- Relaxing evaluator strictness (loosening test case patterns)
- Fixing TypeScript compilation errors
- Adding missing term definitions

### Must remain human-approved:

- Changing metric definitions (numerator, denominator, mode behavior, date anchor)
- Changing business rule semantics (altering what a rule means or when it fires)
- Changing resolution priority order
- Promoting config to production (archiving legacy docs)
- Any change with production blast radius
- Changing the provenance/confidence contract
- Changing MCP tool names or response shapes
- Copying numeric expected outcomes from eval fixtures into config definitions

### True-North Boundary

Semantic and business logic (rules, metrics, field meanings, dangerous columns) belongs in `config/schema-config.yaml`. Historical expected outcomes (counts, conversion rates, AUM totals) belong in `tests/fixtures/true-north.yaml`. The system must not "repair" config by copying numeric expected outcomes into semantic definitions — this causes overfitting and semantic pollution. If a true-north check fails, the fix is in query logic or config rules, not in hardcoding the expected number.

---

## 9. Final Readiness Checklist

Before moving from guide to phased implementation:

- [ ] `npm run build` compiles clean (type foundation exists from Phase 1 types)
- [ ] BigQuery credentials available (service account JSON or ADC configured)
- [ ] Bootstrap docs confirmed present at `docs/bootstrap/savvy/bq-*.md`
- [ ] README.md reviewed and understood by the person executing the guide
- [ ] testing-protocol.md reviewed and understood
- [ ] CLAUDE.md reviewed for anti-patterns and conventions
- [ ] @modelcontextprotocol/sdk installed and importable
- [ ] Git branch created for implementation (recommended: `feat/v1-implementation`)
- [ ] Human reviewer identified for Phase 11e config review
- [ ] Human reviewer identified for pre-promotion readiness gate
- [ ] True-north fixtures for all approved historical periods pass before promotion

---

## 10. Phase Status Tracker

Maintain a running file at `docs/phase-status.md` throughout execution. Update it at the end of each phase. Format:

```markdown
| Phase | Status | Validations Run | Blockers | Human Review | Date Completed |
|---|---|---|---|---|---|
| 0. Preflight | complete | npm run build clean | — | n/a | 2026-04-07 |
| 1. Scaffolding | in progress | — | — | — | — |
| ... | not started | — | — | — | — |
```

Status values: `not started` / `in progress` / `complete` / `blocked`

This is a build-management aid. Create it at the start of Phase 0 and update it as each phase completes. If a phase is blocked, record the blocker and do not advance.

---

## 11. Risks and Blockers

### Major Risks

1. **describe_view response shape drift** — Phase 4 is the critical path. If the response contract is wrong here, every downstream tool and eval case is built on a bad foundation. Mitigation: strict type checking, human review of merger logic.

2. **Config bootstrap quality** — Phases 11a-11e generate and normalize the config from source docs. If critical rules are missed, eval failures will be attributed to config_gap but the fix requires human judgment. Mitigation: section-by-section review against each source doc.

3. **lint_query scope creep** — Phase 10 is high risk because AI agents are strongly drawn to building AST parsers or regex engines for SQL linting. The prompt must be extremely explicit about substring-only matching. Mitigation: the prompt includes five explicit CRITICAL constraints against scope creep.

4. **Metric definition correctness** — Cohort vs period mode logic is subtle. Wrong numerator/denominator combinations produce silently wrong conversion rates. Mitigation: human review checkpoint specifically for metrics.

5. **BigQuery credentials** — The connector requires GCP credentials. If these aren't available during development, tools that depend on live schema queries can't be tested. Mitigation: consider a mock connector for local development (but keep it out of production code paths).

### Minor Risks

- Empty string handling in merger (council flagged this — falsy/whitespace strings must not override valid annotations)
- Comment stripping in lint_query (false positives on commented-out code)
- Case sensitivity in rule matching
- INFORMATION_SCHEMA parameterization limits (FROM clause can't be parameterized)

---

## 12. What to Execute First

**Phase 1 (Project Scaffolding & Core Types)** should be executed first. It:

- Establishes the type contracts that constrain all subsequent phases
- Creates the MCP server shell
- Has zero external dependencies (no BQ credentials needed)
- Is fully validatable with `npm run build`
- Takes ~15 minutes of Claude Code execution

After Phase 1, proceed to Phase 2 (BQ Connector) -> Phase 3 (Config Loader) -> Phase 4 (`describe_view`) -> Phase 5 (`health_check`) -> Phase 6 (`list_views`). Phase 4 is the first major milestone: a working `describe_view` tool that returns annotated schema context. Phase 6 (`list_views`) should follow immediately after Phase 5 because it is simple, gives immediate feedback on connector correctness, and is useful for manual exploration throughout the rest of the build.

**Do not skip to later phases.** Each phase depends on the types and interfaces established in earlier phases. The build order is intentional.

---

## Appendix: Council Review Incorporation

This guide was reviewed by Gemini 3.1 Pro and Codex (GPT-5.4). Key feedback incorporated:

### From Gemini:
- **list_views earlier**: Adopted. `list_views` now moves to Phase 6 immediately after `health_check` because it is trivial, gives fast connector feedback, and helps manual exploration throughout the remaining phases.
- **Empty string handling in merger**: Added explicit constraint in Phase 4 prompt: "Empty strings, whitespace-only strings, and 'null' strings from any source do NOT override valid annotations."
- **Comment stripping in lint_query**: Added to Phase 10 prompt as a required pre-processing step.
- **Sync cadence as operational metadata**: Added `freshness_notes` to describe_view response contract and config bootstrap requirements.
- **Tool description specificity**: Added explicit guidance for MCP tool descriptions that tell agents when to call each tool.

### From Codex:
- **Progressive eval matrix**: Adopted the phase-by-phase eval plan instead of waiting for Phase 12, and updated it for the new Phase 6 `list_views` ordering.
- **Riskiest phases identified**: Phases 4 (`describe_view`), 10 (`lint_query`), and 11e (config review) are the highest-risk phases. Extra validation constraints added.
- **src/ organization pattern**: Adopted the "types + connectors + config + tools + eval + bootstrap" layout from CLAUDE.md, with explicit separation of types from handlers.
- **Phase gates**: Every phase has one required validation check. No "mostly works" advancement.
- **Exit code discipline**: Eval runner must exit(1) on failures for CI integration.






