import type { SchemaConfig, RuleConfig } from "../types/config.js";
import type { WarehouseConnector } from "../types/connector.js";
import type { ViewDescription } from "../types/responses.js";
import { mergeViewAnnotations } from "../config/merger.js";

function matchesAnyToken(ruleText: string, tokens: string[]): boolean {
  const ruleLower = ruleText.toLowerCase();
  return tokens.some((t) => ruleLower.includes(t) || t.includes(ruleLower));
}

function getIntentWarnings(intent: string | undefined, config: SchemaConfig): string[] {
  if (!intent) return [];

  const warnings: string[] = [];
  const intentLower = intent.toLowerCase();
  // Decompose compound intents: "count_sqos" -> ["count_sqos", "count", "sqos"]
  const tokens = [intentLower, ...intentLower.split(/[_\s-]+/).filter((t) => t.length > 2)];
  const rules: RuleConfig[] = config.rules ?? [];

  for (const rule of rules) {
    let isRelevant = false;

    switch (rule.type) {
      case 'ban_pattern':
        isRelevant = matchesAnyToken(rule.pattern, tokens);
        break;
      case 'prefer_field':
        isRelevant =
          matchesAnyToken(rule.found, tokens) ||
          matchesAnyToken(rule.prefer, tokens) ||
          (rule.context !== undefined && matchesAnyToken(rule.context, tokens));
        break;
      case 'require_filter':
        for (const trigger of rule.when_contains) {
          if (matchesAnyToken(trigger, tokens)) {
            isRelevant = true;
            break;
          }
        }
        break;
      case 'date_type_rule':
        isRelevant = matchesAnyToken(rule.field, tokens);
        break;
    }

    if (isRelevant) {
      warnings.push(rule.message);
    }
  }

  return warnings;
}

export async function describeView(
  viewName: string,
  connector: WarehouseConnector,
  config: SchemaConfig,
  dataset?: string,
  intent?: string,
): Promise<ViewDescription> {
  // Determine which dataset to query
  const targetDataset = dataset ?? config.connection.datasets[0];
  if (!targetDataset) {
    throw new Error('No dataset specified and no datasets configured');
  }

  // Get live schema from warehouse
  const liveSchema = await connector.getViewSchema(targetDataset, viewName);

  if (liveSchema.columns.length === 0) {
    // View not found — try other datasets if no dataset was explicitly specified
    if (!dataset) {
      for (const ds of config.connection.datasets) {
        if (ds === targetDataset) continue;
        try {
          const altSchema = await connector.getViewSchema(ds, viewName);
          if (altSchema.columns.length > 0) {
            const merged = mergeViewAnnotations(altSchema, config);
            return {
              view: viewName,
              ...merged,
              intent_warnings: getIntentWarnings(intent, config),
            };
          }
        } catch {
          // Try next dataset
        }
      }
    }
    throw new Error(`View "${viewName}" not found in dataset "${targetDataset}". Use list_views to discover available views.`);
  }

  const merged = mergeViewAnnotations(liveSchema, config);

  return {
    view: viewName,
    ...merged,
    intent_warnings: getIntentWarnings(intent, config),
  };
}
