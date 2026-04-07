# schema-context-mcp — Agent Standing Instructions

## Project Overview
MCP server providing AI agents with live, annotated warehouse schema context. Node.js/TypeScript. BigQuery v1 connector with interface for future Snowflake/Postgres. Replaces static markdown docs with structured tool calls.

## Architecture
src/
├── connectors/        # Warehouse connectors (BigQuery v1, interface for others)
├── tools/             # MCP tool implementations (describe_view, get_metric, lint_query, etc.)
├── config/            # YAML config parser, dbt artifact ingestion, annotation merger
├── eval/              # Built-in eval harness (3 tracks: SQL correctness, knowledge retrieval, workflow replacement)
└── index.ts           # MCP server entry point

config/                # User-facing config files (schema-config.yaml)
tests/                 # Test cases and examples
examples/              # Example configs (config.yaml)

## Key Files
- src/index.ts — MCP server setup, tool registration
- src/config/parser.ts — YAML config loading and validation
- src/config/merger.ts — Merges native config + dbt + warehouse descriptions, applies resolution priority
- src/connectors/bigquery.ts — BigQuery INFORMATION_SCHEMA queries
- src/tools/describe-view.ts — Primary tool: view purpose, grain, filters, dangerous columns, annotated fields
- src/tools/lint-query.ts — Heuristic SQL linting against known rules
- src/eval/runner.ts — Eval harness entry point

## Conventions
- All BigQuery queries use parameterized syntax — never string interpolation
- Every tool response includes provenance (source of each annotation) and confidence (high/medium/low)
- Resolution priority: native config > dbt meta > dbt description > warehouse description
- YAML config uses typed rule primitives (ban_pattern, prefer_field, require_filter) — not free-text
- Tool names are snake_case, match the README spec exactly
- No external runtime dependencies beyond MCP SDK and BigQuery client
- Tests use the built-in eval framework, not Jest (eval cases are YAML, not JS)

## Anti-Patterns
- Don't cache schema in files — always query INFORMATION_SCHEMA at runtime
- Don't merge annotation sources at config load time — merge at response time so provenance is traceable
- Don't use regex for lint_query v1 — substring matching only, with explicit confidence
- Don't add AST parsing — deferred to post-v1
- Don't add codebase scanning to health_check — deferred to post-v1

## Build & Validate
npm run build          # tsc
npm run lint           # eslint
npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml
