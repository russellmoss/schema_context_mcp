# Remote Deployment Guide

Deploy schema-context-mcp as a remote MCP server so teammates connect with just a URL and API key — no npm installs, no service account keys, no warehouse credentials on their machines.

---

## Table of Contents

- [Why Go Remote](#why-go-remote)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Server Implementation](#server-implementation)
  - [Project Setup](#project-setup)
  - [Auth Middleware](#auth-middleware)
  - [Query Validator](#query-validator)
  - [Audit Logger](#audit-logger)
  - [MCP Server with HTTP Transport](#mcp-server-with-http-transport)
- [Dockerfile](#dockerfile)
- [Deployment](#deployment)
- [API Key Management](#api-key-management)
  - [Option A: Standalone Admin CLI](#option-a-standalone-admin-cli)
  - [Option B: Integrated with a Web Dashboard](#option-b-integrated-with-a-web-dashboard)
- [User Onboarding](#user-onboarding)
- [Security Model](#security-model)
- [Updating Schema Context](#updating-schema-context)
- [Troubleshooting](#troubleshooting)

---

## Why Go Remote

The default schema-context-mcp setup runs locally: each user installs the npm package, configures a GCP service account key, and points at their own `schema-config.yaml`. This works, but it means:

- Every user needs Node.js 18+ and `npm install`
- Every user needs a BigQuery service account key on their machine
- Config drift — someone forgets to pull the latest `schema-config.yaml`
- No visibility into what queries agents are running against your warehouse
- Revoking access means hunting down key files

A remote deployment flips this model. One admin deploys a server that bundles the schema config and warehouse credentials. Everyone else gets a URL and an API key. The admin controls access, enforces query guardrails, and has a full audit trail.

| | Local | Remote |
|---|---|---|
| User setup | npm install + config + service account key | Drop a `.mcp.json` file |
| Credential exposure | Service account key on every laptop | Key stays on the server |
| Config consistency | Each user pulls their own copy | Single config baked into the image |
| Query visibility | None | Full audit log |
| Access revocation | Rotate the service account key | Revoke the API key |
| Time to productive | 10-30 minutes | Under 1 minute |

---

## Architecture

```
  User's Machine                          Cloud Run
  ┌──────────────┐                ┌──────────────────────────────┐
  │ Claude Code   │  HTTPS/SSE    │  Express + MCP SDK           │
  │ or any MCP    │──────────────>│                              │
  │ client        │  Bearer token │  ┌──────────────────────┐   │
  │               │               │  │ Auth Middleware       │   │
  │ .mcp.json     │               │  │ (API key → DB lookup) │   │
  │ has URL + key │               │  └──────────┬───────────┘   │
  └──────────────┘                │             │               │
                                  │  ┌──────────▼───────────┐   │
                                  │  │ Query Validator       │   │
                                  │  │ (SELECT-only, dataset │   │
                                  │  │  allowlist, cost cap) │   │
                                  │  └──────────┬───────────┘   │
                                  │             │               │
                                  │  ┌──────────▼───────────┐   │
                                  │  │ MCP Tools             │   │
                                  │  │ • schema_context      │   │
                                  │  │ • execute_sql         │   │
                                  │  │ • list_datasets       │   │
                                  │  │ • list_tables         │   │
                                  │  │ • describe_table      │   │
                                  │  └──────────┬───────────┘   │
                                  │             │               │
                                  │  ┌──────────▼───────────┐   │
                                  │  │ BigQuery              │   │
                                  │  │ (via Cloud Run SA)    │   │
                                  │  └──────────────────────┘   │
                                  │                              │
                                  │  ┌──────────────────────┐   │
                                  │  │ Audit Log             │   │
                                  │  │ (BigQuery table)      │   │
                                  │  └──────────────────────┘   │
                                  └──────────────────────────────┘
```

**Transport:** The server exposes two transports — Streamable HTTP on `/mcp` and legacy SSE on `/sse` — so it works with any MCP client regardless of which protocol version it supports.

**Auth:** Per-user API keys validated against a database (Postgres or a simple JSON store). Keys are SHA-256 hashed before storage.

**Query safety:** A validator sits between the MCP tools and BigQuery. It enforces SELECT-only queries, blocks DML/DDL, enforces a dataset allowlist, and auto-injects `LIMIT 1000` when no LIMIT is present.

**Audit:** Every query is logged to a BigQuery table — who ran it, what SQL, how many bytes scanned, success or failure.

---

## Prerequisites

- **GCP project** with BigQuery enabled
- **Cloud Run** enabled in your GCP project (or any container hosting platform)
- **A database for API keys** — Postgres (Neon, Cloud SQL, Supabase, etc.) or a simple JSON file for small teams
- **Your `schema-config.yaml`** — the same config you'd use for local schema-context-mcp
- **gcloud CLI** installed and authenticated
- **Docker** (for local testing; Cloud Build handles production builds)

---

## Server Implementation

### Project Setup

```bash
mkdir schema-context-remote && cd schema-context-remote
npm init -y
npm install @modelcontextprotocol/sdk express @google-cloud/bigquery crypto
npm install -D typescript @types/express @types/node
```

**`tsconfig.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

**`package.json`** additions:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

### Auth Middleware

The auth middleware extracts the `Authorization: Bearer sk-xxx` header, SHA-256 hashes the token, and looks it up in your database.

**`src/auth.ts`:**
```typescript
import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";

export interface ApiKeyRecord {
  id: string;
  user_email: string;
  key_hash: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: {
    email: string;
    keyId: string;
  };
}

// Replace with your actual database lookup
export interface KeyStore {
  findByHash(hash: string): Promise<ApiKeyRecord | null>;
  updateLastUsed(id: string): Promise<void>;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function createAuthMiddleware(keyStore: KeyStore) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.slice(7); // Strip "Bearer "
    const hash = hashApiKey(token);

    try {
      const record = await keyStore.findByHash(hash);

      if (!record) {
        res.status(401).json({ error: "Invalid API key" });
        return;
      }

      if (!record.is_active) {
        res.status(403).json({ error: "API key has been revoked" });
        return;
      }

      req.user = {
        email: record.user_email,
        keyId: record.id,
      };

      // Fire-and-forget — don't block the request
      keyStore.updateLastUsed(record.id).catch(() => {});

      next();
    } catch (err) {
      console.error("Auth lookup failed:", err);
      res.status(500).json({ error: "Internal auth error" });
    }
  };
}
```

### Query Validator

The validator enforces guardrails on any SQL that passes through the `execute_sql` tool. It runs before the query reaches BigQuery.

**`src/query-validator.ts`:**
```typescript
export interface ValidatorConfig {
  allowedDatasets: string[];
  maxLimitRows: number;
}

export class QueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryValidationError";
  }
}

export function validateQuery(sql: string, config: ValidatorConfig): string {
  // Strip leading SQL comments (-- and /* */ style) to prevent comment-based bypass
  let stripped = sql.replace(/^\s*--[^\n]*\n/gm, "");
  stripped = stripped.replace(/^\s*\/\*[\s\S]*?\*\//gm, "");
  stripped = stripped.trim();

  // Must start with SELECT or WITH (case-insensitive)
  const upperStripped = stripped.toUpperCase();
  if (!upperStripped.startsWith("SELECT") && !upperStripped.startsWith("WITH")) {
    throw new QueryValidationError(
      "Only SELECT and WITH (CTE) queries are allowed. " +
      "INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, EXECUTE, and CALL are blocked."
    );
  }

  // Block DML, DDL, and execution statements anywhere in the query
  const blocked = [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+\S+\s+SET\b/i,
    /\bDELETE\s+FROM\b/i,
    /\bDROP\s+(TABLE|VIEW|SCHEMA|DATABASE)\b/i,
    /\bCREATE\s+(TABLE|VIEW|SCHEMA|DATABASE|FUNCTION|PROCEDURE)\b/i,
    /\bALTER\s+(TABLE|VIEW|SCHEMA)\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /\bMERGE\s+INTO\b/i,
    /\bEXECUTE\b/i,
    /\bCALL\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
  ];

  for (const pattern of blocked) {
    if (pattern.test(stripped)) {
      throw new QueryValidationError(
        `Query contains a blocked statement: ${pattern.source}`
      );
    }
  }

  // Enforce dataset allowlist — look for project.dataset.table or dataset.table references
  if (config.allowedDatasets.length > 0) {
    // Extract all backtick-quoted or bare dataset references
    // Matches: `project.dataset.table`, `dataset.table`, dataset.table
    const tableRefs = stripped.matchAll(
      /`?(?:[\w-]+\.)?(?<dataset>[\w-]+)\.[\w-]+`?/g
    );
    for (const match of tableRefs) {
      const dataset = match.groups?.dataset;
      if (dataset && !config.allowedDatasets.includes(dataset)) {
        throw new QueryValidationError(
          `Dataset "${dataset}" is not in the allowlist. ` +
          `Allowed datasets: ${config.allowedDatasets.join(", ")}`
        );
      }
    }
  }

  // Auto-inject LIMIT if not present
  const hasLimit = /\bLIMIT\s+\d+/i.test(stripped);
  if (!hasLimit) {
    // Remove trailing semicolons before appending
    stripped = stripped.replace(/;\s*$/, "");
    stripped = `${stripped}\nLIMIT ${config.maxLimitRows}`;
  }

  return stripped;
}
```

### Audit Logger

Writes every query execution to a BigQuery table. Uses fire-and-forget inserts so logging never blocks the response.

**`src/audit.ts`:**
```typescript
import { BigQuery } from "@google-cloud/bigquery";

export interface AuditEntry {
  user_email: string;
  tool_name: string;
  sql: string | null;
  bytes_billed: number | null;
  success: boolean;
  error_message: string | null;
  duration_ms: number;
}

export class AuditLogger {
  private bigquery: BigQuery;
  private dataset: string;
  private table: string;

  constructor(projectId: string, dataset = "mcp_audit", table = "query_log") {
    this.bigquery = new BigQuery({ projectId });
    this.dataset = dataset;
    this.table = table;
  }

  /**
   * Fire-and-forget — caller does not await this. Failures are logged to
   * stderr but never propagate to the user.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.bigquery
        .dataset(this.dataset)
        .table(this.table)
        .insert([
          {
            ...entry,
            timestamp: new Date().toISOString(),
          },
        ]);
    } catch (err) {
      console.error("Audit log insert failed:", err);
    }
  }
}
```

**Create the audit table in BigQuery:**

```sql
CREATE TABLE IF NOT EXISTS mcp_audit.query_log (
  timestamp    TIMESTAMP NOT NULL,
  user_email   STRING    NOT NULL,
  tool_name    STRING    NOT NULL,
  sql          STRING,
  bytes_billed INT64,
  success      BOOL      NOT NULL,
  error_message STRING,
  duration_ms  INT64     NOT NULL
)
PARTITION BY DATE(timestamp)
OPTIONS (
  description = 'Audit log for remote MCP server queries',
  partition_expiration_days = 90
);
```

### MCP Server with HTTP Transport

The main server file wires everything together: Express, auth middleware, MCP SDK with dual transport, query validation, and audit logging.

**`src/index.ts`:**
```typescript
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { BigQuery } from "@google-cloud/bigquery";
import { z } from "zod";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import {
  createAuthMiddleware,
  type KeyStore,
  type AuthenticatedRequest,
} from "./auth.js";
import { validateQuery, type ValidatorConfig } from "./query-validator.js";
import { AuditLogger, type AuditEntry } from "./audit.js";

// --- Configuration -----------------------------------------------------------

const PORT = parseInt(process.env.PORT || "8080", 10);
const PROJECT_ID = process.env.BIGQUERY_PROJECT || "";
const CONFIG_PATH = process.env.SCHEMA_CONFIG || "/app/config/schema-config.yaml";
const ALLOWED_DATASETS = (process.env.ALLOWED_DATASETS || "").split(",").filter(Boolean);
const AUDIT_DATASET = process.env.AUDIT_DATASET || "mcp_audit";
const MAX_LIMIT_ROWS = 1000;
const MAX_BYTES_BILLED = 1_000_000_000; // 1 GB
const JOB_TIMEOUT_MS = 120_000; // 2 minutes

// --- Load schema config ------------------------------------------------------

function loadSchemaConfig(path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf-8");
  return parseYaml(raw) as Record<string, unknown>;
}

const schemaConfig = loadSchemaConfig(CONFIG_PATH);

// --- BigQuery client ---------------------------------------------------------

const bigquery = new BigQuery({ projectId: PROJECT_ID });

// --- Audit logger ------------------------------------------------------------

const auditLogger = new AuditLogger(PROJECT_ID, AUDIT_DATASET);

// --- Query validator config --------------------------------------------------

const validatorConfig: ValidatorConfig = {
  allowedDatasets: ALLOWED_DATASETS,
  maxLimitRows: MAX_LIMIT_ROWS,
};

// --- Key store (replace with your implementation) ----------------------------

// This is a placeholder. See the "API Key Management" section for full
// implementations using Postgres or a JSON file.
async function createKeyStore(): Promise<KeyStore> {
  // Example: Postgres-backed key store
  // const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // return {
  //   findByHash: async (hash) => {
  //     const res = await pool.query(
  //       'SELECT * FROM mcp_api_keys WHERE key_hash = $1', [hash]
  //     );
  //     return res.rows[0] || null;
  //   },
  //   updateLastUsed: async (id) => {
  //     await pool.query(
  //       'UPDATE mcp_api_keys SET last_used_at = NOW() WHERE id = $1', [id]
  //     );
  //   },
  // };
  throw new Error("KeyStore not implemented — see API Key Management section");
}

// --- MCP server factory ------------------------------------------------------

function createMcpServer(userEmail: string) {
  const server = new McpServer({
    name: "schema-context-remote",
    version: "1.0.0",
  });

  // Tool: execute_sql
  server.tool(
    "execute_sql",
    "Execute a read-only SQL query against BigQuery. Queries are validated " +
    "(SELECT-only, dataset allowlist, cost cap) and audit logged.",
    {
      sql: z.string().describe("The SQL query to execute"),
    },
    async ({ sql }) => {
      const start = Date.now();
      let validatedSql: string;

      try {
        validatedSql = validateQuery(sql, validatorConfig);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Validation failed";
        auditLogger.log({
          user_email: userEmail,
          tool_name: "execute_sql",
          sql,
          bytes_billed: null,
          success: false,
          error_message: msg,
          duration_ms: Date.now() - start,
        }).catch(() => {});
        return { content: [{ type: "text", text: `Query blocked: ${msg}` }] };
      }

      try {
        const [job] = await bigquery.createQueryJob({
          query: validatedSql,
          maximumBytesBilled: String(MAX_BYTES_BILLED),
          jobTimeoutMs: String(JOB_TIMEOUT_MS),
        });

        const [rows] = await job.getQueryResults();
        const metadata = await job.getMetadata();
        const bytesBilled = Number(
          metadata[0]?.statistics?.query?.totalBytesBilled || 0
        );

        auditLogger.log({
          user_email: userEmail,
          tool_name: "execute_sql",
          sql: validatedSql,
          bytes_billed: bytesBilled,
          success: true,
          error_message: null,
          duration_ms: Date.now() - start,
        }).catch(() => {});

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  rows: rows.slice(0, MAX_LIMIT_ROWS),
                  row_count: rows.length,
                  bytes_billed: bytesBilled,
                  truncated: rows.length >= MAX_LIMIT_ROWS,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Query failed";
        auditLogger.log({
          user_email: userEmail,
          tool_name: "execute_sql",
          sql: validatedSql,
          bytes_billed: null,
          success: false,
          error_message: msg,
          duration_ms: Date.now() - start,
        }).catch(() => {});
        return { content: [{ type: "text", text: `Query error: ${msg}` }] };
      }
    }
  );

  // Tool: list_datasets
  server.tool(
    "list_datasets",
    "List all BigQuery datasets in the project.",
    {},
    async () => {
      const [datasets] = await bigquery.getDatasets();
      const names = datasets
        .map((d) => d.id)
        .filter((id): id is string => id !== undefined);

      return {
        content: [{ type: "text", text: JSON.stringify(names, null, 2) }],
      };
    }
  );

  // Tool: list_tables
  server.tool(
    "list_tables",
    "List all tables and views in a BigQuery dataset.",
    {
      dataset: z.string().describe("The dataset ID"),
    },
    async ({ dataset }) => {
      if (
        ALLOWED_DATASETS.length > 0 &&
        !ALLOWED_DATASETS.includes(dataset)
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Dataset "${dataset}" is not in the allowlist.`,
            },
          ],
        };
      }

      const [tables] = await bigquery.dataset(dataset).getTables();
      const result = tables.map((t) => ({
        id: t.id,
        type: t.metadata?.type,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Tool: describe_table
  server.tool(
    "describe_table",
    "Get schema (columns, types, descriptions) for a BigQuery table or view.",
    {
      dataset: z.string().describe("The dataset ID"),
      table: z.string().describe("The table or view name"),
    },
    async ({ dataset, table }) => {
      if (
        ALLOWED_DATASETS.length > 0 &&
        !ALLOWED_DATASETS.includes(dataset)
      ) {
        return {
          content: [
            {
              type: "text",
              text: `Dataset "${dataset}" is not in the allowlist.`,
            },
          ],
        };
      }

      const [metadata] = await bigquery
        .dataset(dataset)
        .table(table)
        .getMetadata();

      const fields = metadata.schema?.fields || [];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                table: `${dataset}.${table}`,
                description: metadata.description || null,
                row_count: metadata.numRows || null,
                fields: fields.map(
                  (f: { name: string; type: string; description?: string; mode?: string }) => ({
                    name: f.name,
                    type: f.type,
                    description: f.description || null,
                    mode: f.mode || "NULLABLE",
                  })
                ),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool: schema_context
  server.tool(
    "schema_context",
    "Get annotated schema context from the schema-config.yaml — includes view " +
    "purposes, field meanings, gotchas, business rules, metrics, and dangerous " +
    "columns. This is the primary tool for understanding your data warehouse.",
    {
      view: z
        .string()
        .optional()
        .describe("Specific view name to look up (e.g. 'dataset.view_name')"),
      term: z
        .string()
        .optional()
        .describe("Business term to resolve (e.g. 'SQO', 'ARR')"),
      metric: z
        .string()
        .optional()
        .describe("Metric name to look up"),
      section: z
        .enum(["views", "rules", "terms", "metrics", "all"])
        .optional()
        .describe("Config section to return (default: 'all')"),
    },
    async ({ view, term, metric, section }) => {
      // Filter schema config based on parameters
      let result: Record<string, unknown> = {};

      const s = section || "all";

      if (view) {
        const views = (schemaConfig as Record<string, unknown>).views as Record<string, unknown> || {};
        result = { view: views[view] || `View "${view}" not found in config` };
      } else if (term) {
        const terms = (schemaConfig as Record<string, unknown>).terms as Record<string, unknown> || {};
        result = { term: terms[term] || `Term "${term}" not found in config` };
      } else if (metric) {
        const metrics = (schemaConfig as Record<string, unknown>).metrics as Record<string, unknown> || {};
        result = { metric: metrics[metric] || `Metric "${metric}" not found in config` };
      } else if (s === "all") {
        result = schemaConfig;
      } else {
        result = {
          [s]: (schemaConfig as Record<string, unknown>)[s] || `Section "${s}" not found`,
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  return server;
}

// --- Express app -------------------------------------------------------------

async function main() {
  const app = express();
  const keyStore = await createKeyStore();
  const authMiddleware = createAuthMiddleware(keyStore);

  // Health check — no auth required
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", tools: 5 });
  });

  // --- Streamable HTTP transport on /mcp -----------------------------------

  app.post("/mcp", authMiddleware, async (req: AuthenticatedRequest, res) => {
    const userEmail = req.user?.email || "unknown";

    const server = createMcpServer(userEmail);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless — no session management
    });

    res.on("close", () => {
      transport.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Handle GET and DELETE for session management (required by spec)
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method not allowed — use POST" });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method not allowed" });
  });

  // --- Legacy SSE transport on /sse ----------------------------------------

  const sseTransports = new Map<string, SSEServerTransport>();

  app.get("/sse", authMiddleware, async (req: AuthenticatedRequest, res) => {
    const userEmail = req.user?.email || "unknown";
    const server = createMcpServer(userEmail);
    const transport = new SSEServerTransport("/messages", res);

    sseTransports.set(transport.sessionId, transport);

    res.on("close", () => {
      sseTransports.delete(transport.sessionId);
    });

    await server.connect(transport);
  });

  app.post("/messages", authMiddleware, async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = sseTransports.get(sessionId);

    if (!transport) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await transport.handlePostMessage(req, res, req.body);
  });

  // --- Start ---------------------------------------------------------------

  app.use(express.json());

  app.listen(PORT, () => {
    console.log(`MCP server listening on port ${PORT}`);
    console.log(`  Streamable HTTP: POST /mcp`);
    console.log(`  Legacy SSE:      GET  /sse`);
    console.log(`  Health check:    GET  /health`);
    console.log(`  Project:         ${PROJECT_ID}`);
    console.log(`  Allowed datasets: ${ALLOWED_DATASETS.join(", ") || "(all)"}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

> **Note:** This creates a new MCP server per request (stateless mode). Each request is authenticated independently. For the SSE transport, a lightweight session is maintained for the duration of the SSE connection.

---

## Dockerfile

Multi-stage build on Node.js 20 Alpine. The schema config is copied into the image at build time. BigQuery authentication uses Cloud Run's `--service-account` flag — no key file is baked into the container.

```dockerfile
# ---- Build stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ---- Production stage ----
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output
COPY --from=build /app/dist ./dist

# Copy schema config into the image
COPY config/schema-config.yaml ./config/schema-config.yaml

# Non-root user
RUN addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

ENV NODE_ENV=production
ENV PORT=8080
ENV SCHEMA_CONFIG=/app/config/schema-config.yaml

EXPOSE 8080

CMD ["node", "dist/index.js"]
```

**Build and test locally:**

```bash
docker build -t schema-context-remote .
docker run -p 8080:8080 \
  -e BIGQUERY_PROJECT=your-project-id \
  -e ALLOWED_DATASETS=dataset_a,dataset_b \
  -e DATABASE_URL=postgres://... \
  schema-context-remote
```

---

## Deployment

### Deploy to Cloud Run

```bash
# Set your variables
export PROJECT_ID=your-gcp-project
export REGION=us-central1
export SERVICE_NAME=schema-context-mcp
export SERVICE_ACCOUNT=schema-context-mcp@${PROJECT_ID}.iam.gserviceaccount.com

# Create a dedicated service account (one-time)
gcloud iam service-accounts create schema-context-mcp \
  --display-name="Schema Context MCP Server"

# Grant BigQuery read access
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/bigquery.dataViewer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/bigquery.jobUser"

# If using audit logging to BigQuery, also grant write access to the audit dataset
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/bigquery.dataEditor" \
  --condition="expression=resource.name.startsWith('projects/${PROJECT_ID}/datasets/mcp_audit'),title=audit-write-only"

# Build and deploy
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME

gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --region $REGION \
  --service-account $SERVICE_ACCOUNT \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "BIGQUERY_PROJECT=${PROJECT_ID},ALLOWED_DATASETS=dataset_a,dataset_b,AUDIT_DATASET=mcp_audit,DATABASE_URL=your-postgres-url" \
  --timeout 300
```

> `--allow-unauthenticated` is intentional. Auth is handled at the app layer via API keys. Cloud Run's built-in IAM auth doesn't support the `Authorization: Bearer` header format that MCP clients send.

### `deploy.sh`

Save this as a convenience script:

```bash
#!/usr/bin/env bash
set -euo pipefail

# --- Configuration (edit these) ---
PROJECT_ID="your-gcp-project"
REGION="us-central1"
SERVICE_NAME="schema-context-mcp"
SERVICE_ACCOUNT="schema-context-mcp@${PROJECT_ID}.iam.gserviceaccount.com"
ALLOWED_DATASETS="dataset_a,dataset_b"
DATABASE_URL="${DATABASE_URL:?Set DATABASE_URL env var}"

# --- Build ---
echo "Building container..."
gcloud builds submit --tag "gcr.io/${PROJECT_ID}/${SERVICE_NAME}" --quiet

# --- Deploy ---
echo "Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "gcr.io/${PROJECT_ID}/${SERVICE_NAME}" \
  --region "${REGION}" \
  --service-account "${SERVICE_ACCOUNT}" \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "BIGQUERY_PROJECT=${PROJECT_ID},ALLOWED_DATASETS=${ALLOWED_DATASETS},DATABASE_URL=${DATABASE_URL}" \
  --timeout 300 \
  --quiet

# --- Output ---
URL=$(gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" --format="value(status.url)")
echo ""
echo "Deployed: ${URL}"
echo "Health:   ${URL}/health"
echo "MCP:      ${URL}/mcp"
```

```bash
chmod +x deploy.sh
DATABASE_URL=postgres://... ./deploy.sh
```

---

## API Key Management

### Option A: Standalone Admin CLI

For small teams or early setup. Keys are stored in Postgres (or a JSON file for prototyping).

**`admin.ts`:**
```typescript
import { randomBytes, createHash } from "crypto";
import pg from "pg";

const KEY_PREFIX = "sk-savvy-";

function generateApiKey(): { plaintext: string; hash: string } {
  const random = randomBytes(20).toString("hex");
  const plaintext = `${KEY_PREFIX}${random}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "init": {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mcp_api_keys (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_email TEXT NOT NULL,
          key_hash   TEXT NOT NULL UNIQUE,
          is_active  BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_used_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_key_hash ON mcp_api_keys(key_hash);
      `);
      console.log("Table created.");
      break;
    }

    case "add-user": {
      const emailIdx = args.indexOf("--email");
      if (emailIdx === -1 || !args[emailIdx + 1]) {
        console.error("Usage: admin add-user --email user@example.com");
        process.exit(1);
      }
      const email = args[emailIdx + 1];
      const { plaintext, hash } = generateApiKey();

      await pool.query(
        "INSERT INTO mcp_api_keys (user_email, key_hash) VALUES ($1, $2)",
        [email, hash]
      );

      console.log(`Key created for ${email}`);
      console.log(`API Key: ${plaintext}`);
      console.log("");
      console.log("Send this key to the user. It will not be shown again.");
      break;
    }

    case "remove-user": {
      const rmIdx = args.indexOf("--email");
      if (rmIdx === -1 || !args[rmIdx + 1]) {
        console.error("Usage: admin remove-user --email user@example.com");
        process.exit(1);
      }
      const rmEmail = args[rmIdx + 1];
      const res = await pool.query(
        "UPDATE mcp_api_keys SET is_active = false WHERE user_email = $1 AND is_active = true",
        [rmEmail]
      );
      console.log(`Deactivated ${res.rowCount} key(s) for ${rmEmail}`);
      break;
    }

    case "rotate-key": {
      const rotIdx = args.indexOf("--email");
      if (rotIdx === -1 || !args[rotIdx + 1]) {
        console.error("Usage: admin rotate-key --email user@example.com");
        process.exit(1);
      }
      const rotEmail = args[rotIdx + 1];

      // Deactivate old keys
      await pool.query(
        "UPDATE mcp_api_keys SET is_active = false WHERE user_email = $1 AND is_active = true",
        [rotEmail]
      );

      // Issue new key
      const { plaintext: newKey, hash: newHash } = generateApiKey();
      await pool.query(
        "INSERT INTO mcp_api_keys (user_email, key_hash) VALUES ($1, $2)",
        [rotEmail, newHash]
      );

      console.log(`Old key(s) revoked. New key for ${rotEmail}:`);
      console.log(`API Key: ${newKey}`);
      console.log("");
      console.log("Send this key to the user. It will not be shown again.");
      break;
    }

    case "list-users": {
      const rows = await pool.query(
        `SELECT user_email, is_active, created_at, last_used_at
         FROM mcp_api_keys
         ORDER BY created_at DESC`
      );
      console.table(rows.rows);
      break;
    }

    default:
      console.log("Usage: admin <init|add-user|remove-user|rotate-key|list-users>");
      console.log("");
      console.log("Commands:");
      console.log("  init                          Create the API keys table");
      console.log("  add-user --email EMAIL        Generate a new API key");
      console.log("  remove-user --email EMAIL     Revoke all keys for a user");
      console.log("  rotate-key --email EMAIL      Revoke old key, issue new one");
      console.log("  list-users                    Show all keys and status");
  }

  await pool.end();
}

main().catch(console.error);
```

**Usage:**
```bash
# First-time setup
npx tsx admin.ts init

# Add a teammate
npx tsx admin.ts add-user --email alice@example.com
# Output: API Key: sk-savvy-a1b2c3d4e5f6...  (shown once)

# Rotate a compromised key
npx tsx admin.ts rotate-key --email alice@example.com

# Revoke access
npx tsx admin.ts remove-user --email alice@example.com

# See who has access
npx tsx admin.ts list-users
```

### Option B: Integrated with a Web Dashboard

If you have an existing user management UI (Next.js, Remix, etc.), add a Prisma model and manage keys from your dashboard.

**Prisma schema addition:**
```prisma
model McpApiKey {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  keyHash    String   @unique @map("key_hash")
  keyPrefix  String   @map("key_prefix")  // "sk-savvy-a1b2" — for display
  label      String?                       // "Claude Code - laptop"
  isActive   Boolean  @default(true) @map("is_active")
  createdAt  DateTime @default(now()) @map("created_at")
  lastUsedAt DateTime? @map("last_used_at")
  expiresAt  DateTime? @map("expires_at")

  @@map("mcp_api_keys")
}
```

**Key generation utility:**
```typescript
import { randomBytes, createHash } from "crypto";

const KEY_PREFIX = "sk-savvy-";

export function generateMcpApiKey() {
  const random = randomBytes(20).toString("hex");
  const plaintext = `${KEY_PREFIX}${random}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const displayPrefix = plaintext.slice(0, KEY_PREFIX.length + 4); // "sk-savvy-a1b2"

  return { plaintext, hash, displayPrefix };
}
```

**Dashboard actions (example with Next.js Server Actions):**
```typescript
// Generate a new key
async function generateKey(userId: string, label?: string) {
  const { plaintext, hash, displayPrefix } = generateMcpApiKey();

  await prisma.mcpApiKey.create({
    data: {
      userId,
      keyHash: hash,
      keyPrefix: displayPrefix,
      label: label || "Default",
    },
  });

  // Return plaintext ONCE — the UI shows it in a modal with a copy button
  return { key: plaintext, prefix: displayPrefix };
}

// Revoke a key
async function revokeKey(keyId: string, userId: string) {
  await prisma.mcpApiKey.update({
    where: { id: keyId, userId },
    data: { isActive: false },
  });
}

// Rotate: revoke old, issue new
async function rotateKey(keyId: string, userId: string) {
  await revokeKey(keyId, userId);
  return generateKey(userId);
}

// List keys for the user's settings page
async function listKeys(userId: string) {
  return prisma.mcpApiKey.findMany({
    where: { userId },
    select: {
      id: true,
      keyPrefix: true,
      label: true,
      isActive: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
```

The dashboard shows a table of keys (prefix, label, created, last used, active status) with Generate / Revoke / Rotate buttons. When a key is generated, the plaintext is shown once in a modal — it cannot be retrieved after the user closes it.

---

## User Onboarding

Once a teammate has their API key, setup takes 30 seconds:

### 1. Create `.mcp.json` in the project root

```json
{
  "mcpServers": {
    "your-server-name": {
      "type": "http",
      "url": "https://schema-context-mcp-abc123-uc.a.run.app/mcp",
      "headers": {
        "Authorization": "Bearer sk-savvy-a1b2c3d4e5f6..."
      }
    }
  }
}
```

> **`.gitignore` this file** — it contains a secret. Add `.mcp.json` to your project's `.gitignore`.

### 2. Open Claude Code

```bash
cd your-project
claude
```

Claude Code automatically discovers `.mcp.json` and connects to the remote server. The user should see the server's tools in `/mcp`:

```
schema-context-mcp: 5 tools
  - execute_sql
  - list_datasets
  - list_tables
  - describe_table
  - schema_context
```

### 3. Start asking questions

No install. No credentials. No setup beyond the JSON file.

```
> What datasets do we have?
> Describe the opportunity_history view
> What does SQO mean?
> SELECT opportunity_id, amount FROM sales.opportunities WHERE stage = 'Closed Won'
```

### Template onboarding message for teammates

```
Hey — I set up a remote MCP server so you can query our data warehouse
directly from Claude Code. Here's your setup:

1. Save the attached .mcp.json to your project root
2. Add .mcp.json to your .gitignore
3. Open Claude Code — the tools should appear automatically

Your API key: sk-savvy-xxxxxxxxxxxx (don't share this)
Server health: https://schema-context-mcp-abc123-uc.a.run.app/health

The server has 5 tools:
- schema_context — annotated schema, business terms, metrics, rules
- execute_sql — run read-only queries (SELECT only, 1GB cost cap)
- list_datasets / list_tables / describe_table — explore the warehouse

Let me know if you hit any issues.
```

---

## Security Model

The remote server implements defense in depth — multiple overlapping layers so that no single failure exposes the warehouse.

### What the server enforces

| Layer | Control | Details |
|---|---|---|
| **Authentication** | Per-user API keys | SHA-256 hashed, stored in database, revocable per-user |
| **Authorization** | Active user check | Deactivated keys are rejected even if the hash matches |
| **Query parsing** | SELECT-only enforcement | Queries must start with `SELECT` or `WITH` after comment stripping |
| **DML/DDL blocking** | Pattern matching | `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `MERGE`, `EXECUTE`, `CALL`, `GRANT`, `REVOKE` are all blocked |
| **Comment stripping** | Pre-validation | Leading `--` and `/* */` comments are stripped before validation to prevent bypass |
| **Dataset allowlist** | Parse-time enforcement | Queries referencing datasets outside the allowlist are rejected |
| **IAM allowlist** | Runtime enforcement | The Cloud Run service account only has access to allowed datasets |
| **Cost cap** | `maximumBytesBilled: 1GB` | BigQuery rejects queries that would scan more than 1 GB |
| **Timeout** | `jobTimeoutMs: 120000` | Queries running longer than 2 minutes are killed |
| **Row cap** | `LIMIT 1000` auto-injection | Queries without a LIMIT clause get `LIMIT 1000` appended |
| **Audit trail** | BigQuery logging | Every query logged with user, SQL, bytes, success/failure |
| **Container isolation** | Non-root process | Server runs as a non-root user inside the container |
| **No baked credentials** | Cloud Run SA | BigQuery auth uses workload identity, not a key file in the image |

### What the server explicitly cannot do

- **Write to any BigQuery table** (except the audit log): The service account has `dataViewer`, not `dataEditor`. The query validator also blocks DML/DDL at the application layer.
- **Access datasets outside the allowlist**: Blocked at both parse-time (application) and runtime (IAM).
- **Expose service account credentials**: No key file exists in the container. Credentials are injected by the Cloud Run runtime via workload identity.
- **Return unbounded result sets**: All queries are capped at 1,000 rows.
- **Execute stored procedures or scripts**: `EXECUTE`, `CALL`, and BigQuery scripting patterns are blocked.
- **Run queries that exceed the cost cap**: BigQuery's `maximumBytesBilled` is a server-side enforcement — it cannot be bypassed by the query.

### Recommendations

- **Rotate keys regularly** — set an expiration policy (e.g., 90 days) and enforce it in the key store.
- **Monitor the audit log** — set up alerts for unusual query volume, large byte scans, or repeated failures.
- **Restrict the Cloud Run service URL** — if your team is on a VPN or Cloud IAP, layer network-level restrictions on top of app-layer auth.
- **Keep the dataset allowlist minimal** — only include datasets that agents actually need.

---

## Updating Schema Context

The schema config is baked into the Docker image at build time. To update it:

```bash
# 1. Edit the config
vim config/schema-config.yaml

# 2. Commit and push
git add config/schema-config.yaml
git commit -m "Update schema config: add new view annotations"
git push

# 3. Redeploy
./deploy.sh
```

The new config takes effect as soon as Cloud Run routes traffic to the new revision (typically under 30 seconds after deploy completes).

> **Important:** The config is frozen in the Docker image — it is not auto-pulled from git or a remote URL at runtime. This is intentional: it means you always know exactly what config is deployed, and a bad config push doesn't immediately affect all users. You must explicitly redeploy to update.

If you want to preview config changes before deploying:

```bash
# Build and test locally
docker build -t schema-context-remote:test .
docker run -p 8080:8080 \
  -e BIGQUERY_PROJECT=your-project \
  -e DATABASE_URL=your-db-url \
  schema-context-remote:test

# Hit the health check
curl http://localhost:8080/health

# Test the schema_context tool directly
curl -X POST http://localhost:8080/mcp \
  -H "Authorization: Bearer your-test-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 Missing or invalid Authorization header` | No `Authorization` header or wrong format | Ensure `.mcp.json` has `"headers": {"Authorization": "Bearer sk-savvy-..."}` |
| `401 Invalid API key` | Key doesn't match any hash in the database | Re-generate the key with `admin.ts add-user` or rotate from the dashboard. The old key cannot be recovered. |
| `403 API key has been revoked` | Key exists but `is_active = false` | Issue a new key with `admin.ts rotate-key --email user@example.com` |
| Server doesn't appear in `/mcp` | `.mcp.json` not in project root, or JSON syntax error | Verify the file exists at the project root (not a subdirectory), and validate JSON syntax. Restart Claude Code after adding the file. |
| `/mcp` shows server with `failed` status | Server is unreachable or returning errors | Check `curl https://your-server.run.app/health`. If it fails, check Cloud Run logs: `gcloud run services logs read schema-context-mcp --region us-central1 --limit 50` |
| `Dataset "xxx" is not in the allowlist` | Query references a dataset not in `ALLOWED_DATASETS` | Add the dataset to the `ALLOWED_DATASETS` env var and redeploy, or adjust the query to use an allowed dataset. |
| `Query blocked: Only SELECT and WITH queries are allowed` | Agent tried to run a DML/DDL statement | This is working as intended. Instruct the agent that only read queries are allowed. |
| Wrong MCP tool being used | Agent calls `execute_sql` when `schema_context` would be better, or vice versa | Add a system prompt hint: "Use `schema_context` to understand the warehouse structure. Use `execute_sql` only when you need to run an actual query." |
| Slow first response (5-15 seconds) | Cloud Run cold start (instance scaling from 0) | Set `--min-instances 1` in the deploy command to keep one instance warm. This costs ~$0.50/day. |
| `Query error: Query exceeded resource limits` | Query would scan more than the 1 GB cost cap | Add filters or narrow the query scope. The `maximumBytesBilled` limit is intentional — it prevents runaway costs. |
| `Query error: Operation timed out` | Query ran longer than 120 seconds | Simplify the query. Consider adding `WHERE` clauses, reducing joins, or querying a smaller date range. |
| Connection drops mid-conversation | Cloud Run's default request timeout | The deploy command sets `--timeout 300` (5 min). For very long SSE sessions, consider increasing this or switching to the Streamable HTTP transport. |
