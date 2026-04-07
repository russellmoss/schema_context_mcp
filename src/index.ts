#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config/loader.js";
import { BigQueryConnector } from "./connectors/bigquery.js";
import { describeView } from "./tools/describe-view.js";
import { healthCheck } from "./tools/health-check.js";
import { listViews } from "./tools/list-views.js";
import { resolveTerm } from "./tools/resolve-term.js";
import { getRule } from "./tools/get-rule.js";
import { getMetric } from "./tools/get-metric.js";
import { lintQuery } from "./tools/lint-query.js";
import type { SchemaConfig } from "./types/config.js";
import type { WarehouseConnector } from "./types/connector.js";

const server = new McpServer({
  name: "schema-context-mcp",
  version: "0.1.0",
});

// Config and connector are initialized lazily on first tool call
let config: SchemaConfig | null = null;
let connector: WarehouseConnector | null = null;

function getConfig(): SchemaConfig {
  if (!config) {
    const configPath = process.env["SCHEMA_CONFIG"] ?? "./config/schema-config.yaml";
    config = loadConfig(configPath);
    console.error(`Loaded config from ${configPath}`);
  }
  return config;
}

function getConnector(): WarehouseConnector {
  if (!connector) {
    const cfg = getConfig();
    connector = new BigQueryConnector(cfg.connection.project, cfg.connection.key_file);
    console.error(`Initialized BigQuery connector for project ${cfg.connection.project}`);
  }
  return connector;
}

// --- describe_view ---
server.tool(
  "describe_view",
  "Returns purpose, grain, key filters, dangerous columns, and annotated fields for a warehouse view. Always call this before writing SQL. Supports optional intent parameter for targeted warnings.",
  {
    view: z.string().describe("View or table name (e.g., orders_summary)"),
    dataset: z.string().optional().describe("Dataset to query (defaults to first configured dataset)"),
    intent: z.string().optional().describe("What you're trying to do (e.g., count_sqos, pipeline_aum)"),
  },
  async ({ view, dataset, intent }) => {
    try {
      const result = await describeView(view, getConnector(), getConfig(), dataset, intent);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
    }
  },
);

// --- health_check ---
server.tool(
  "health_check",
  "Detects drift between config annotations and live warehouse schema. Call this to find unannotated fields, stale annotations, and config integrity issues.",
  {
    dataset: z.string().optional().describe("Check a specific dataset (defaults to all configured datasets)"),
  },
  async ({ dataset }) => {
    try {
      const result = await healthCheck(getConnector(), getConfig(), dataset);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
    }
  },
);

// --- list_views ---
server.tool(
  "list_views",
  "Discovers all views and tables in the warehouse. Shows annotation status, column counts, and supports search filtering.",
  {
    dataset: z.string().optional().describe("Filter to a specific dataset"),
    search: z.string().optional().describe("Filter views by name substring"),
  },
  async ({ dataset, search }) => {
    try {
      const result = await listViews(getConnector(), getConfig(), dataset, search);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
    }
  },
);

// --- resolve_term ---
server.tool(
  "resolve_term",
  "Looks up business domain terms and returns definitions, related fields, related rules, and gotchas. Use this when you encounter unfamiliar domain vocabulary.",
  {
    term: z.string().describe("Business term to look up (e.g., ARR, churn, MQL)"),
  },
  async ({ term }) => {
    try {
      const result = resolveTerm(term, getConfig());
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
    }
  },
);

// --- get_metric ---
server.tool(
  "get_metric",
  "Returns metric definitions with computation logic, numerator/denominator, mode-specific guidance, and gotchas. Use this before computing conversion rates or funnel metrics.",
  {
    metric: z.string().describe("Metric name (e.g., conversion_rate)"),
    mode: z.enum(["cohort", "period"]).optional().describe("Computation mode — changes which fields/logic are returned"),
  },
  async ({ metric, mode }) => {
    try {
      const result = getMetric(getConfig(), metric, mode);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
    }
  },
);

// --- get_rule ---
server.tool(
  "get_rule",
  "Returns named query rules — validated WHERE clauses, required companions, banned patterns. Use this to understand specific query constraints.",
  {
    rule_id: z.string().optional().describe("Exact rule ID to look up"),
    search: z.string().optional().describe("Search rules by keyword"),
  },
  async ({ rule_id, search }) => {
    try {
      const result = getRule(getConfig(), rule_id, search);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
    }
  },
);

// --- lint_query ---
server.tool(
  "lint_query",
  "Lightweight heuristic SQL linting against configured rules. Checks for banned patterns, preferred fields, required filters, and date type issues. Substring-based, not AST.",
  {
    sql: z.string().describe("SQL query to lint"),
  },
  async ({ sql }) => {
    try {
      const result = lintQuery(sql, getConfig());
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
    }
  },
);

function getCliArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

async function runBootstrap(): Promise<void> {
  const { extractFromDocs, reportCoverage, logCoverageReport } = await import("./bootstrap/extract.js");
  const { emitConfig } = await import("./bootstrap/emit-config.js");
  const { writeFileSync } = await import("node:fs");

  const args = process.argv.slice(2);
  const docsDir = getCliArg(args, '--docs');
  const outputPath = getCliArg(args, '--output') ?? './config/schema-config.yaml';
  const projectId = getCliArg(args, '--project') ?? 'your-project-id';
  const datasetArg = getCliArg(args, '--dataset') ?? 'your_dataset';
  const connectorType = getCliArg(args, '--connector') ?? 'bigquery';

  // Support comma-separated datasets
  const datasets = datasetArg.split(',').map(d => d.trim()).filter(Boolean);

  if (!docsDir) {
    console.error('Usage: schema-context-mcp bootstrap --docs <dir> [--output <path>] [--project <id>] [--dataset <name,...>] [--connector <type>]');
    process.exit(1);
  }

  console.error(`Extracting knowledge from ${docsDir}...`);
  const knowledge = extractFromDocs(docsDir);
  console.error(`Found: ${knowledge.views.length} views, ${knowledge.fields.length} fields, ${knowledge.rules.length} rules, ${knowledge.terms.length} terms`);

  // Coverage report
  const coverage = reportCoverage(knowledge, docsDir);
  logCoverageReport(coverage);

  const yamlOutput = emitConfig(knowledge, projectId, datasets, connectorType);
  writeFileSync(outputPath, yamlOutput, 'utf-8');
  console.error(`Config written to ${outputPath}`);
  console.error('WARNING: All annotations have low confidence. Review before using in production.');
}

async function runOnboard(): Promise<void> {
  const { checkPrerequisites, logPrerequisitesReport } = await import("./onboarding/prerequisites.js");
  const { scaffoldProject } = await import("./onboarding/scaffold.js");
  const { generateStarterEvals, writeStarterEvals } = await import("./onboarding/starter-evals.js");
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");

  const args = process.argv.slice(2);
  const projectId = getCliArg(args, '--project');
  const datasetArg = getCliArg(args, '--dataset');
  const connectorType = getCliArg(args, '--connector') ?? 'bigquery';
  const targetDir = getCliArg(args, '--target') ?? '.';
  const docsDir = getCliArg(args, '--docs');
  const teamPrefix = getCliArg(args, '--team') ?? 'team';

  if (!projectId || !datasetArg) {
    console.error('Usage: schema-context-mcp onboard --project <id> --dataset <name,...> [--connector <type>] [--target <dir>] [--docs <dir>] [--team <prefix>]');
    process.exit(1);
  }

  const datasets = datasetArg.split(',').map(d => d.trim()).filter(Boolean);

  // Step 1: Scaffold project structure
  console.error('Step 1: Scaffolding project...');
  const created = scaffoldProject({ targetDir, project: projectId, datasets, connector: connectorType });
  console.error(`  Created ${created.length} files`);

  // Step 2: Prerequisites check (only if connector is available)
  console.error('\nStep 2: Checking prerequisites...');
  try {
    const { BigQueryConnector } = await import("./connectors/bigquery.js");
    const connector = new BigQueryConnector(projectId);
    const report = await checkPrerequisites(connector, datasets);
    logPrerequisitesReport(report);
    if (!report.all_passed) {
      console.error('WARNING: Some datasets are not accessible. Continuing with scaffold only.');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  Prerequisites check skipped: ${message}`);
    console.error('  This is OK — you can run health_check later once credentials are configured.');
  }

  // Step 3: Bootstrap from docs (if provided)
  if (docsDir) {
    console.error('\nStep 3: Bootstrapping from source docs...');
    if (!existsSync(docsDir)) {
      console.error(`  ERROR: Docs directory not found: ${docsDir}`);
    } else {
      const { extractFromDocs, reportCoverage, logCoverageReport } = await import("./bootstrap/extract.js");
      const { emitConfig } = await import("./bootstrap/emit-config.js");
      const { writeFileSync } = await import("node:fs");

      const knowledge = extractFromDocs(docsDir);
      console.error(`  Found: ${knowledge.views.length} views, ${knowledge.fields.length} fields, ${knowledge.rules.length} rules, ${knowledge.terms.length} terms`);

      const coverage = reportCoverage(knowledge, docsDir);
      logCoverageReport(coverage);

      // Write bootstrapped config (overwrites scaffolded template)
      const configPath = join(targetDir, 'config', 'schema-config.yaml');
      const yamlOutput = emitConfig(knowledge, projectId, datasets, connectorType);
      writeFileSync(configPath, yamlOutput, 'utf-8');
      console.error(`  Bootstrapped config written to ${configPath}`);

      // Step 4: Generate starter eval cases from source docs
      console.error('\nStep 4: Generating starter eval cases from source docs...');
      const starterAssertions = generateStarterEvals(knowledge, teamPrefix);
      if (starterAssertions.length > 0) {
        const starterPath = join(targetDir, 'tests', 'cases', 'track-b', 'starter-assertions.yaml');
        writeStarterEvals(starterAssertions, starterPath);
        console.error(`  Generated ${starterAssertions.length} Track B assertions → ${starterPath}`);
        console.error('  NOTE: These assertions are grounded in source docs, not config. Review before using.');
      } else {
        console.error('  No assertions generated (no views/fields/rules extracted from docs).');
      }
    }
  } else {
    console.error('\nStep 3: No --docs provided. Skipping bootstrap.');
    console.error('  Fill in config/schema-config.yaml manually using the template comments.');
  }

  console.error('\n--- Onboarding Complete ---');
  console.error('Next steps:');
  console.error('  1. Review and edit config/schema-config.yaml');
  console.error('  2. Write eval cases in tests/cases/');
  console.error('  3. Run: npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml');
  console.error('  4. Track progress in onboarding-checklist.md');
}

async function runRefine(): Promise<void> {
  const { runRefinementLoop } = await import("./refinement/loop.js");

  const args = process.argv.slice(2);
  const configPath = getCliArg(args, '--config') ?? './config/schema-config.yaml';
  const casesPath = getCliArg(args, '--cases') ?? './tests/cases';
  const maxIterations = parseInt(getCliArg(args, '--max-iterations') ?? '10', 10);
  const autoApprove = args.includes('--auto-approve');
  const logPath = getCliArg(args, '--log') ?? './refinement-log.yaml';
  const docsDir = getCliArg(args, '--docs');

  await runRefinementLoop({
    configPath,
    casesPath,
    maxIterations,
    autoApprove,
    logPath,
    docsDir,
  });
}

async function runPromote(): Promise<void> {
  const { evaluatePromotion, computeCoverage } = await import("./promotion/criteria.js");
  const { generateReport, writeReport } = await import("./promotion/report.js");
  const { loadEvalCases, loadFixtures } = await import("./eval/loader.js");
  const { checkRequiredPatterns, checkBannedPatterns, checkNegativeControls, checkKnowledgeAssertions, computeOverallStatus } = await import("./eval/scorer.js");
  const { healthCheck } = await import("./tools/health-check.js");
  const { existsSync } = await import("node:fs");

  const args = process.argv.slice(2);
  const configPath = getCliArg(args, '--config') ?? './config/schema-config.yaml';
  const casesPath = getCliArg(args, '--cases') ?? './tests/cases';
  const fixturesPath = getCliArg(args, '--fixtures') ?? './tests/fixtures';
  const outputPath = getCliArg(args, '--output') ?? './promotion-report.md';
  const hasHumanSignoff = args.includes('--human-signoff');
  const hasRealTask = args.includes('--real-task');
  const configInGit = args.includes('--config-in-git');

  const cfg = loadConfig(configPath);
  const conn = new BigQueryConnector(cfg.connection.project, cfg.connection.key_file);

  // Run eval suite
  console.error('Running eval suite...');
  const cases = loadEvalCases(casesPath);
  let trackAPass = 0, trackATotal = 0;
  let trackBPass = 0, trackBTotal = 0;
  let trackCPass = 0, trackCTotal = 0;
  let negPass = 0, negTotal = 0;

  for (const c of cases) {
    const content = c.reference_sql ?? '';
    const reqChecks = checkRequiredPatterns(content, c.required_patterns);
    const banChecks = checkBannedPatterns(content, c.banned_patterns);
    const negChecks = checkNegativeControls(content, c.negative_controls);
    const kChecks = c.knowledge_assertions
      ? checkKnowledgeAssertions(JSON.stringify(cfg), c.knowledge_assertions)
      : [];
    const allReq = [...reqChecks, ...kChecks];
    const status = computeOverallStatus(allReq, banChecks, negChecks);

    // Classify track
    const isNeg = c.id.startsWith('neg-');
    const isTrackC = c.id.startsWith('workflow-') || c.category === 'activity_analysis';
    const isTrackB = !isNeg && !isTrackC && c.knowledge_assertions !== undefined && !c.required_patterns;
    const isTrackA = !isNeg && !isTrackC && !isTrackB;

    if (isNeg) { negTotal++; if (status === 'pass') negPass++; }
    else if (isTrackC) { trackCTotal++; if (status === 'pass') trackCPass++; }
    else if (isTrackB) { trackBTotal++; if (status === 'pass') trackBPass++; }
    else if (isTrackA) { trackATotal++; if (status === 'pass') trackAPass++; }
  }

  const evalTotal = cases.length;
  const evalPass = trackAPass + trackBPass + trackCPass + negPass;

  const evalSummary = {
    total: evalTotal, pass: evalPass, fail: evalTotal - evalPass,
    track_a_pass: trackAPass, track_a_total: trackATotal,
    track_b_pass: trackBPass, track_b_total: trackBTotal,
    track_c_pass: trackCPass, track_c_total: trackCTotal,
    negative_pass: negPass, negative_total: negTotal,
  };
  console.error(`Eval: ${evalPass}/${evalTotal} pass`);

  // Run health check
  console.error('Running health check...');
  let healthSummary = { connection_errors: 0, config_issues: 0, unannotated_fields: 0, stale_annotations: 0 };
  try {
    const hc = await healthCheck(conn, cfg);
    healthSummary = {
      connection_errors: hc.config_issues.filter(i => i.type === 'permission_error').length,
      config_issues: hc.config_issues.length,
      unannotated_fields: hc.unannotated_fields.length,
      stale_annotations: hc.stale_annotations.length,
    };
    console.error(`Health: ${hc.summary}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Health check failed: ${msg}`);
    healthSummary.connection_errors = 1;
  }

  // Compute coverage
  const totalLiveFields = healthSummary.unannotated_fields + Object.keys(cfg.fields ?? {}).length;
  const coverage = computeCoverage(cfg, totalLiveFields);
  console.error(`Coverage: ${coverage.coverage_pct}% (${coverage.annotated_fields}/${coverage.total_live_fields})`);

  // Check fixtures
  let fixtures = { true_north_exists: false, true_north_count: 0, golden_exists: false, golden_count: 0, online_verified: false };
  if (existsSync(fixturesPath)) {
    const fx = loadFixtures(fixturesPath);
    fixtures = {
      true_north_exists: fx.true_north.length > 0,
      true_north_count: fx.true_north.length,
      golden_exists: fx.golden.length > 0,
      golden_count: fx.golden.length,
      online_verified: false, // Would require --online run
    };
  }

  // Evaluate promotion
  const promotion = evaluatePromotion(evalSummary, healthSummary, coverage, fixtures, hasHumanSignoff, hasRealTask, configInGit);
  console.error(`\nPromotion Level: ${promotion.level} — ${promotion.level_name}`);

  if (promotion.blockers.length > 0) {
    console.error('Blockers:');
    for (const b of promotion.blockers) console.error(`  - ${b}`);
  }
  if (promotion.conditions.length > 0) {
    console.error('Conditions:');
    for (const c of promotion.conditions) console.error(`  - ${c}`);
  }

  // Generate report
  const report = generateReport({
    promotion, evalSummary, healthSummary, coverage, fixtures, configPath,
    generatedAt: new Date().toISOString(),
  });
  writeReport(report, outputPath);
  console.error(`\nReport written to ${outputPath}`);
}

async function runEval(): Promise<void> {
  // Delegate to the eval runner, passing through all CLI args after 'eval'
  const { runEvalCli } = await import("./eval/runner.js");
  await runEvalCli();
}

async function main(): Promise<void> {
  // Check for subcommands
  if (process.argv[2] === 'bootstrap') {
    await runBootstrap();
    return;
  }

  if (process.argv[2] === 'onboard') {
    await runOnboard();
    return;
  }

  if (process.argv[2] === 'refine') {
    await runRefine();
    return;
  }

  if (process.argv[2] === 'promote') {
    await runPromote();
    return;
  }

  if (process.argv[2] === 'eval') {
    await runEval();
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("schema-context-mcp server started");
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
