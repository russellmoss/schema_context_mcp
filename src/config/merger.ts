import type { SchemaConfig, FieldConfig, ViewConfig, DangerousColumnConfig } from "../types/config.js";
import type { ViewSchema } from "../types/connector.js";
import type {
  AnnotatedColumn,
  DangerousColumn,
  KeyFilter,
  ProvenanceSource,
  ConfidenceLevel,
} from "../types/responses.js";

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.trim().toLowerCase() !== 'null';
}

export interface MergedViewAnnotation {
  purpose: string;
  grain: string;
  dangerous_columns: DangerousColumn[];
  key_filters: Record<string, KeyFilter>;
  annotated_columns: AnnotatedColumn[];
  consumers?: string[];
  freshness_notes?: string;
  recommended_date_fields?: Record<string, string>;
}

export function mergeViewAnnotations(
  liveSchema: ViewSchema,
  config: SchemaConfig,
): MergedViewAnnotation {
  const viewName = liveSchema.name;
  const viewConfig: ViewConfig | undefined = config.views?.[viewName];
  const fieldsConfig: Record<string, FieldConfig> = config.fields ?? {};

  // Build set of live column names for stale-check
  const liveColumnNames = new Set(liveSchema.columns.map((c) => c.name));

  // Annotate columns — only columns that exist in live schema
  const annotated_columns: AnnotatedColumn[] = liveSchema.columns.map((col) => {
    const fieldAnnotation = fieldsConfig[col.name];
    const warehouseDesc = col.description;

    let provenance: ProvenanceSource = 'live_schema';
    let confidence: ConfidenceLevel = 'low';
    let meaning: string | undefined;
    let use_instead_of: string | undefined;
    let gotcha: string | undefined;

    // Resolution priority: native_config > warehouse_description
    if (fieldAnnotation) {
      if (isNonEmpty(fieldAnnotation.meaning)) {
        meaning = fieldAnnotation.meaning;
        provenance = 'native_config';
        confidence = 'high';
      }
      if (isNonEmpty(fieldAnnotation.use_instead_of)) {
        use_instead_of = fieldAnnotation.use_instead_of;
      }
      if (isNonEmpty(fieldAnnotation.gotcha)) {
        gotcha = fieldAnnotation.gotcha;
      }
      // If ANY native_config annotation exists, upgrade provenance
      if ((use_instead_of || gotcha) && provenance === 'live_schema') {
        provenance = 'native_config';
        confidence = 'medium';
      }
    }

    // Fall back to warehouse description if no native_config meaning
    if (!meaning && isNonEmpty(warehouseDesc)) {
      meaning = warehouseDesc;
      provenance = 'warehouse_description';
      confidence = 'medium';
    }

    return {
      name: col.name,
      type: col.type,
      ...(meaning !== undefined ? { meaning } : {}),
      ...(use_instead_of !== undefined ? { use_instead_of } : {}),
      ...(gotcha !== undefined ? { gotcha } : {}),
      provenance,
      confidence,
    };
  });

  // Dangerous columns — structured objects
  const dangerous_columns: DangerousColumn[] = [];
  if (viewConfig?.dangerous_columns) {
    for (const dc of viewConfig.dangerous_columns) {
      if (typeof dc === 'string') {
        // Simple string form — look up field config for reason
        const fieldCfg = fieldsConfig[dc];
        if (liveColumnNames.has(dc)) {
          dangerous_columns.push({
            column: dc,
            reason: fieldCfg?.gotcha ?? 'Flagged as dangerous in config',
            ...(fieldCfg?.use_instead_of ? { use_instead: fieldCfg.use_instead_of } : {}),
            provenance: 'native_config',
            confidence: 'high',
          });
        }
      } else {
        // Structured object form
        const dcObj = dc as DangerousColumnConfig;
        if (liveColumnNames.has(dcObj.column)) {
          dangerous_columns.push({
            column: dcObj.column,
            reason: dcObj.reason,
            ...(dcObj.use_instead ? { use_instead: dcObj.use_instead } : {}),
            provenance: 'native_config',
            confidence: 'high',
          });
        }
      }
    }
  }

  // Key filters
  const key_filters: Record<string, KeyFilter> = {};
  if (viewConfig?.key_filters) {
    for (const [name, sql] of Object.entries(viewConfig.key_filters)) {
      key_filters[name] = {
        sql,
        provenance: 'native_config',
        confidence: 'high',
      };
    }
  }

  return {
    purpose: viewConfig?.purpose ?? '',
    grain: viewConfig?.grain ?? '',
    dangerous_columns,
    key_filters,
    annotated_columns,
    ...(viewConfig?.consumers ? { consumers: viewConfig.consumers } : {}),
    ...(viewConfig?.freshness_notes ? { freshness_notes: viewConfig.freshness_notes } : {}),
    ...(viewConfig?.recommended_date_fields ? { recommended_date_fields: viewConfig.recommended_date_fields } : {}),
  };
}
