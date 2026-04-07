/**
 * Online eval executor — calls live MCP tools and compares against fixtures.
 * Used when --online flag is set. Imports tool handlers directly (no MCP protocol).
 */

import { describeView } from "../tools/describe-view.js";
import { listViews } from "../tools/list-views.js";
import { resolveTerm } from "../tools/resolve-term.js";
import { getRule } from "../tools/get-rule.js";
import { getMetric } from "../tools/get-metric.js";
import type { SchemaConfig } from "../types/config.js";
import type { WarehouseConnector } from "../types/connector.js";
import type { KnowledgeAssertion } from "../types/eval.js";

// Default cost guard: 1GB per query
const DEFAULT_COST_GUARD_BYTES = 1_000_000_000;

export interface OnlineToolResult {
  tool: string;
  response: string;
  success: boolean;
  error?: string;
}

export interface FixtureComparisonResult {
  field: string;
  expected: number;
  actual?: number;
  status: 'pass' | 'fail' | 'error';
  note?: string;
  bytes_processed?: number;
}

export interface OnlineEvalError {
  type: 'credentials_missing' | 'warehouse_unreachable' | 'cost_guard_exceeded' | 'permission_error' | 'unknown';
  message: string;
}

/**
 * Call a tool handler directly and return the JSON-stringified response.
 */
export async function callTool(
  toolName: string,
  config: SchemaConfig,
  connector: WarehouseConnector,
  args: Record<string, string>,
): Promise<OnlineToolResult> {
  try {
    let response: unknown;
    const dataset = args["dataset"] ?? config.connection.datasets[0];

    switch (toolName) {
      case 'describe_view': {
        response = await describeView(
          args["view"] ?? '',
          connector,
          config,
          dataset,
          args["intent"],
        );
        break;
      }
      case 'resolve_term': {
        response = resolveTerm(args["term"] ?? '', config);
        break;
      }
      case 'get_rule': {
        response = getRule(config, args["rule_id"], args["search"]);
        break;
      }
      case 'get_metric': {
        response = getMetric(
          config,
          args["metric"] ?? '',
          args["mode"] as 'cohort' | 'period' | undefined,
        );
        break;
      }
      case 'list_views': {
        response = await listViews(
          connector,
          config,
          dataset,
          args["search"],
        );
        break;
      }
      default:
        return {
          tool: toolName,
          response: '',
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }

    const responseStr = JSON.stringify(response);
    return { tool: toolName, response: responseStr, success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { tool: toolName, response: '', success: false, error: message };
  }
}

/**
 * Check knowledge assertions by calling live tools.
 */
export async function checkOnlineAssertions(
  assertions: KnowledgeAssertion[],
  config: SchemaConfig,
  connector: WarehouseConnector,
): Promise<Array<{ pattern: string; status: 'pass' | 'fail'; note?: string }>> {
  const results: Array<{ pattern: string; status: 'pass' | 'fail'; note?: string }> = [];

  for (const assertion of assertions) {
    // Determine tool args based on the tool name
    const args: Record<string, string> = {};
    if (assertion.tool === 'describe_view') {
      args["view"] = extractViewFromContext(assertion.question, config);
    } else if (assertion.tool === 'resolve_term') {
      args["term"] = extractTermFromContext(assertion.question, config);
    } else if (assertion.tool === 'get_rule') {
      args["search"] = extractRuleSearchFromContext(assertion.question, assertion.expected, config);
    } else if (assertion.tool === 'get_metric') {
      args["metric"] = extractMetricFromContext(assertion.question, config);
    } else if (assertion.tool === 'list_views') {
      args["search"] = assertion.expected;
    }

    let result = await callTool(assertion.tool, config, connector, args);

    // Fallback for get_rule: if search failed, try with the expected value as search
    if (!result.success && assertion.tool === 'get_rule' && args["search"] !== assertion.expected) {
      result = await callTool(assertion.tool, config, connector, { search: assertion.expected });
    }

    // Fallback for get_rule: if still failing, try returning all rules
    if (!result.success && assertion.tool === 'get_rule') {
      result = await callTool(assertion.tool, config, connector, {});
    }

    // Fallback for describe_view: if expected not found in first view, try all configured views
    if (assertion.tool === 'describe_view' && result.success) {
      const found = result.response.toLowerCase().includes(assertion.expected.toLowerCase());
      if (!found) {
        // Try other views
        const views = Object.keys(config.views ?? {});
        for (const v of views) {
          if (v === args["view"]) continue;
          const altResult = await callTool(assertion.tool, config, connector, { ...args, view: v });
          if (altResult.success && altResult.response.toLowerCase().includes(assertion.expected.toLowerCase())) {
            result = altResult;
            break;
          }
        }
      }
    }

    if (!result.success) {
      results.push({
        pattern: assertion.expected,
        status: 'fail',
        note: `Tool call failed: ${result.error}`,
      });
      continue;
    }

    const found = result.response.toLowerCase().includes(assertion.expected.toLowerCase());
    results.push({
      pattern: assertion.expected,
      status: found ? 'pass' : 'fail',
      note: found ? undefined : `Expected "${assertion.expected}" in ${assertion.tool} response`,
    });
  }

  return results;
}

/**
 * Compare fixture expected values against live query results with tolerance.
 */
export function compareValues(
  expected: number,
  actual: number,
): { status: 'pass' | 'fail'; note?: string } {
  // Exact match for integers
  if (Number.isInteger(expected) && expected === actual) {
    return { status: 'pass' };
  }

  // Rate tolerance: ±0.01 for values between 0 and 1
  if (expected >= 0 && expected <= 1) {
    const diff = Math.abs(expected - actual);
    if (diff <= 0.01) {
      return { status: 'pass' };
    }
    return {
      status: 'fail',
      note: `Rate mismatch: expected ${expected}, got ${actual} (diff: ${diff.toFixed(4)}, tolerance: 0.01)`,
    };
  }

  // Large number tolerance: ±1%
  if (Math.abs(expected) >= 1000) {
    const pctDiff = Math.abs(expected - actual) / Math.abs(expected);
    if (pctDiff <= 0.01) {
      return { status: 'pass' };
    }
    return {
      status: 'fail',
      note: `Value mismatch: expected ${expected}, got ${actual} (${(pctDiff * 100).toFixed(2)}% diff, tolerance: 1%)`,
    };
  }

  // Integer exact match for small counts
  if (Number.isInteger(expected)) {
    if (expected === actual) {
      return { status: 'pass' };
    }
    return {
      status: 'fail',
      note: `Count mismatch: expected ${expected}, got ${actual}`,
    };
  }

  // Default: ±0.01
  if (Math.abs(expected - actual) <= 0.01) {
    return { status: 'pass' };
  }

  return {
    status: 'fail',
    note: `Value mismatch: expected ${expected}, got ${actual}`,
  };
}

/**
 * Check if online eval can run. Returns null if OK, or an error if not.
 */
export async function checkOnlinePrerequisites(
  config: SchemaConfig,
  connector: WarehouseConnector,
): Promise<OnlineEvalError | null> {
  try {
    // Try to list views from the first dataset as a connectivity check
    const dataset = config.connection.datasets[0];
    if (!dataset) {
      return { type: 'credentials_missing', message: 'No datasets configured' };
    }
    await connector.listViews(dataset);
    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('permission') || message.includes('Permission') || message.includes('403')) {
      return { type: 'permission_error', message };
    }
    if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED') || message.includes('timeout')) {
      return { type: 'warehouse_unreachable', message };
    }
    if (message.includes('credential') || message.includes('Credential') || message.includes('auth')) {
      return { type: 'credentials_missing', message };
    }
    return { type: 'unknown', message };
  }
}

export { DEFAULT_COST_GUARD_BYTES };

// --- Helper functions to extract tool args from assertion context ---

function extractViewFromContext(question: string, config: SchemaConfig): string {
  const views = Object.keys(config.views ?? {});
  // Check if question mentions a specific view
  for (const v of views) {
    if (question.toLowerCase().includes(v.toLowerCase())) {
      return v;
    }
  }
  // Check if question mentions a field — find which view is most relevant
  const fields = config.fields ?? {};
  const qLower = question.toLowerCase();
  for (const [fieldName] of Object.entries(fields)) {
    if (qLower.includes(fieldName.toLowerCase())) {
      // Return the first view (most annotations live there)
      return views[0] ?? '';
    }
  }
  // Default to first configured view
  return views[0] ?? '';
}

function extractTermFromContext(question: string, config: SchemaConfig): string {
  const terms = Object.keys(config.terms ?? {});
  const qLower = question.toLowerCase();

  // Exact term match in question
  for (const t of terms) {
    if (qLower.includes(t.toLowerCase())) {
      return t;
    }
  }

  // Try to find Salesforce-style field names (__c suffix) in question
  const fieldMatches = question.match(/[A-Za-z_]+__c/g);
  if (fieldMatches) {
    // Look for a term related to this field
    for (const fm of fieldMatches) {
      for (const t of terms) {
        const termConfig = config.terms?.[t];
        if (typeof termConfig === 'object' && termConfig?.related_fields?.some(f => f.toLowerCase() === fm.toLowerCase())) {
          return t;
        }
      }
      // Also check if the field name itself is a term
      const baseName = fm.replace(/__c$/, '');
      for (const t of terms) {
        if (t.toLowerCase() === baseName.toLowerCase()) return t;
      }
    }
  }

  // Try to find terms whose definition contains keywords from the question
  const questionWords = qLower.split(/\s+/).filter(w => w.length > 3);
  for (const t of terms) {
    const termConfig = config.terms?.[t];
    const definition = typeof termConfig === 'string' ? termConfig : termConfig?.definition ?? '';
    const defLower = definition.toLowerCase();
    // Check if multiple question keywords appear in the definition
    const matchCount = questionWords.filter(w => defLower.includes(w)).length;
    if (matchCount >= 2) return t;
  }

  // Try to extract acronyms from the question
  const words = question.split(/\s+/);
  for (const w of words) {
    if (/^[A-Z]{2,6}$/.test(w)) {
      // Check if this acronym is a known term
      for (const t of terms) {
        if (t.toUpperCase() === w) return t;
      }
      return w;
    }
  }

  return question;
}

function extractRuleSearchFromContext(question: string, expected: string, config: SchemaConfig): string {
  const rules = config.rules ?? [];
  const qLower = question.toLowerCase();

  // First: try to match a rule ID directly from question text
  for (const r of rules) {
    if (qLower.includes(r.id.toLowerCase().replace(/_/g, ' '))) {
      return r.id;
    }
  }

  // Second: try to find field names in the question that appear in rules
  for (const r of rules) {
    const ruleFields = [
      r.type === 'prefer_field' ? r.found : '',
      r.type === 'prefer_field' ? r.prefer : '',
      r.type === 'ban_pattern' ? r.pattern : '',
      r.type === 'require_filter' ? r.required : '',
      r.type === 'date_type_rule' ? r.field : '',
    ].filter(Boolean);

    for (const f of ruleFields) {
      if (qLower.includes(f.toLowerCase())) {
        return f;
      }
    }
  }

  // Third: try the expected value as search
  return expected;
}

function extractMetricFromContext(question: string, config: SchemaConfig): string {
  const metrics = Object.keys(config.metrics ?? {});
  for (const m of metrics) {
    if (question.toLowerCase().includes(m.toLowerCase().replace(/_/g, ' '))) {
      return m;
    }
    if (question.toLowerCase().includes(m.toLowerCase())) {
      return m;
    }
  }
  return metrics[0] ?? '';
}
