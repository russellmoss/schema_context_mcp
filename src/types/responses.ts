/**
 * Response types for all MCP tools.
 * Authoritative reference: .claude/mcp-tool-spec.md
 * Every response includes provenance and confidence.
 */

export type ProvenanceSource =
  | 'native_config'
  | 'dbt_meta'
  | 'dbt_description'
  | 'warehouse_description'
  | 'live_schema'
  | 'inferred';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

// --- describe_view ---

export interface DangerousColumn {
  column: string;
  reason: string;
  use_instead?: string;
  provenance: ProvenanceSource;
  confidence: ConfidenceLevel;
}

export interface KeyFilter {
  sql: string;
  provenance: ProvenanceSource;
  confidence: ConfidenceLevel;
}

export interface AnnotatedColumn {
  name: string;
  type: string;
  meaning?: string;
  use_instead_of?: string;
  gotcha?: string;
  provenance: ProvenanceSource;
  confidence: ConfidenceLevel;
}

export interface ViewDescription {
  view: string;
  purpose: string;
  grain: string;
  intent_warnings: string[];
  dangerous_columns: DangerousColumn[];
  key_filters: Record<string, KeyFilter>;
  annotated_columns: AnnotatedColumn[];
  consumers?: string[];
  freshness_notes?: string;
  recommended_date_fields?: Record<string, string>;
}

// --- health_check ---

export interface UnannotatedField {
  view: string;
  field: string;
  type: string;
}

export interface StaleAnnotation {
  view: string;
  field: string;
  reason: string;
}

export interface ConfigIssue {
  type: string;
  detail: string;
}

export interface HealthCheckResult {
  unannotated_fields: UnannotatedField[];
  stale_annotations: StaleAnnotation[];
  config_issues: ConfigIssue[];
  summary: string;
  suggestion: string;
}

// --- get_metric ---
// Note: mcp-tool-spec.md shows numerator/denominator as structured {field, provenance, confidence}.
// Implementation guide chose string form for v1 simplicity. Top-level provenance/confidence covers it.

export interface MetricResult {
  name: string;
  numerator: string;
  denominator: string;
  mode: 'cohort' | 'period' | 'both';
  mode_guidance: string;
  date_anchor: string;
  gotchas: string[];
  related_rules: string[];
  provenance: ProvenanceSource;
  confidence: ConfidenceLevel;
}

// --- get_rule ---

export interface RuleResult {
  id: string;
  type: 'ban_pattern' | 'prefer_field' | 'require_filter' | 'date_type_rule';
  severity: 'error' | 'warning' | 'info';
  message: string;
  pattern?: string;
  found?: string;
  prefer?: string;
  context?: string;
  when_contains?: string[];
  required?: string;
  field?: string;
  expected_type?: string;
  wrong_wrapper?: string;
  correct_wrapper?: string;
  provenance: ProvenanceSource;
  confidence: ConfidenceLevel;
}

// --- lint_query ---

export interface LintFinding {
  rule_id: string;
  type: 'ban_pattern' | 'prefer_field' | 'require_filter' | 'date_type_rule';
  severity: 'error' | 'warning';
  message: string;
  confidence: 'medium';
  provenance: 'native_config';
}

export interface LintResult {
  warnings: LintFinding[];
  passed: boolean;
  note: string;
}

// --- resolve_term ---

export interface TermDefinition {
  term: string;
  definition: string;
  found: boolean;
  related_fields: string[];
  related_rules: string[];
  gotchas: string[];
  provenance: ProvenanceSource;
  confidence: ConfidenceLevel;
}

// --- list_views ---

export interface ViewListItem {
  name: string;
  dataset: string;
  type: string;
  annotated: boolean;
  column_count: number;
}

export interface ViewListResult {
  views: ViewListItem[];
  total: number;
  annotated: number;
}
