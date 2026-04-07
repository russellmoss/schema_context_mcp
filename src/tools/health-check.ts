import type { SchemaConfig } from "../types/config.js";
import type { WarehouseConnector } from "../types/connector.js";
import type { HealthCheckResult, UnannotatedField, StaleAnnotation, ConfigIssue } from "../types/responses.js";

export async function healthCheck(
  connector: WarehouseConnector,
  config: SchemaConfig,
  dataset?: string,
): Promise<HealthCheckResult> {
  const unannotated_fields: UnannotatedField[] = [];
  const stale_annotations: StaleAnnotation[] = [];
  const config_issues: ConfigIssue[] = [];

  const datasetsToCheck = dataset ? [dataset] : config.connection.datasets;
  const fieldsConfig = config.fields ?? {};
  const viewsConfig = config.views ?? {};

  // Check each configured dataset (permissions check + schema scan combined)
  for (const ds of datasetsToCheck) {
    let liveViews: Array<{ name: string; dataset: string; type: string; column_count: number }>;
    try {
      liveViews = await connector.listViews(ds);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      config_issues.push({
        type: 'permission_error',
        detail: `Dataset "${ds}" is not accessible: ${message}`,
      });
      continue;
    }

    const liveViewNames = new Set(liveViews.map((v) => v.name));

    // For each configured view in this dataset context, check for stale annotations
    for (const [viewName, viewCfg] of Object.entries(viewsConfig)) {
      if (!liveViewNames.has(viewName)) {
        // View might be in a different dataset — skip unless we're checking a specific dataset
        if (dataset) {
          stale_annotations.push({
            view: viewName,
            field: '(entire view)',
            reason: `View not found in ${ds}.INFORMATION_SCHEMA`,
          });
        }
        continue;
      }

      // Get live schema for this view
      let liveColumns: Set<string>;
      try {
        const schema = await connector.getViewSchema(ds, viewName);
        liveColumns = new Set(schema.columns.map((c) => c.name));

        // Check for unannotated fields
        for (const col of schema.columns) {
          if (!fieldsConfig[col.name] && !viewCfg.key_filters?.[col.name]) {
            unannotated_fields.push({
              view: viewName,
              field: col.name,
              type: col.type,
            });
          }
        }
      } catch {
        config_issues.push({
          type: 'schema_read_error',
          detail: `Failed to read schema for ${ds}.${viewName}`,
        });
        continue;
      }

      // Check for stale dangerous_columns
      if (viewCfg.dangerous_columns) {
        for (const dc of viewCfg.dangerous_columns) {
          const colName = typeof dc === 'string' ? dc : dc.column;
          if (!liveColumns.has(colName)) {
            stale_annotations.push({
              view: viewName,
              field: colName,
              reason: `Dangerous column not found in live schema`,
            });
          }
        }
      }
    }
  }

  // Check for stale field annotations
  // (fields that are annotated but don't appear in any live view we checked)
  // This is a best-effort check — we can only verify against views we've scanned

  // Check config integrity: duplicate rule IDs
  const rules = config.rules ?? [];
  const ruleIds = new Set<string>();
  for (const rule of rules) {
    if (ruleIds.has(rule.id)) {
      config_issues.push({
        type: 'duplicate_rule',
        detail: `Duplicate rule ID: "${rule.id}"`,
      });
    }
    ruleIds.add(rule.id);
  }

  // Build summary
  const parts: string[] = [];
  if (unannotated_fields.length > 0) {
    parts.push(`${unannotated_fields.length} unannotated field${unannotated_fields.length === 1 ? '' : 's'}`);
  }
  if (stale_annotations.length > 0) {
    parts.push(`${stale_annotations.length} stale annotation${stale_annotations.length === 1 ? '' : 's'}`);
  }
  if (config_issues.length > 0) {
    parts.push(`${config_issues.length} config issue${config_issues.length === 1 ? '' : 's'}`);
  }
  const summary = parts.length > 0 ? parts.join(', ') : 'Clean — no drift detected';

  // Build suggestion
  let suggestion = '';
  if (unannotated_fields.length > 0) {
    const firstFew = unannotated_fields.slice(0, 3);
    suggestion = `Annotate ${firstFew.map((f) => `${f.field} in ${f.view}`).join(', ')}`;
    if (unannotated_fields.length > 3) {
      suggestion += ` and ${unannotated_fields.length - 3} more`;
    }
  } else if (stale_annotations.length > 0) {
    suggestion = `Review stale annotations: ${stale_annotations.slice(0, 3).map((s) => `${s.field} in ${s.view}`).join(', ')}`;
  } else if (config_issues.length > 0) {
    suggestion = `Fix config issues: ${config_issues.slice(0, 2).map((i) => i.detail).join('; ')}`;
  } else {
    suggestion = 'No action needed';
  }

  return {
    unannotated_fields,
    stale_annotations,
    config_issues,
    summary,
    suggestion,
  };
}
