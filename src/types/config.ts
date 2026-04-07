/**
 * TypeScript types for the schema-config.yaml configuration file.
 * Authoritative reference: .claude/config-schema.md
 */

// --- Connection ---

export interface ConnectionConfig {
  connector: 'bigquery';
  project: string;
  datasets: string[];
  key_file?: string;
}

// --- dbt (optional) ---

export interface DbtConfig {
  manifest_path?: string;
  semantic_manifest_path?: string;
}

// --- Fields ---

export interface FieldConfig {
  meaning?: string;
  type?: string;
  use_instead_of?: string;
  gotcha?: string;
  source_info?: string;
}

// --- Views ---

export interface DangerousColumnConfig {
  column: string;
  reason: string;
  use_instead?: string;
}

export interface ViewConfig {
  purpose?: string;
  grain?: string;
  key_filters?: Record<string, string>;
  dangerous_columns?: (DangerousColumnConfig | string)[];
  consumers?: string[];
  recommended_date_fields?: Record<string, string>;
  freshness_notes?: string;
  notes?: string;
  known_issues?: string[];
  status?: string;
}

// --- Rules ---

export type RuleType = 'ban_pattern' | 'prefer_field' | 'require_filter' | 'date_type_rule';
export type Severity = 'error' | 'warning' | 'info';

export interface BaseRule {
  id: string;
  type: RuleType;
  severity: Severity;
  message: string;
  context?: string;
}

export interface BanPatternRule extends BaseRule {
  type: 'ban_pattern';
  pattern: string;
}

export interface PreferFieldRule extends BaseRule {
  type: 'prefer_field';
  found: string;
  prefer: string;
}

export interface RequireFilterRule extends BaseRule {
  type: 'require_filter';
  when_contains: string[];
  required: string;
}

export interface DateTypeRule extends BaseRule {
  type: 'date_type_rule';
  field: string;
  expected_type: string;
  wrong_wrapper?: string;
  correct_wrapper?: string;
}

export type RuleConfig = BanPatternRule | PreferFieldRule | RequireFilterRule | DateTypeRule;

// --- Terms ---

export interface TermConfigExpanded {
  definition: string;
  related_fields?: string[];
  related_rules?: string[];
  gotcha?: string;
}

export type TermConfig = string | TermConfigExpanded;

// --- Metrics ---

export interface MetricModeConfig {
  numerator: string;
  denominator: string;
  anchor_date?: string;
  numerator_logic?: string;
  denominator_logic?: string;
  gotcha?: string;
}

export interface MetricConfig {
  description?: string;
  modes?: Record<string, MetricModeConfig>;
}

// --- Top-Level Config ---

export interface SchemaConfig {
  connection: ConnectionConfig;
  dbt?: DbtConfig;
  fields?: Record<string, FieldConfig>;
  views?: Record<string, ViewConfig>;
  rules?: RuleConfig[];
  terms?: Record<string, TermConfig>;
  metrics?: Record<string, MetricConfig>;
}
