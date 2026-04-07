/**
 * Types for the eval framework.
 * Authoritative reference: .claude/eval-spec.md
 */

export type FailureCategory =
  | 'config_gap'
  | 'surfacing_failure'
  | 'evaluator_strict'
  | 'agent_reasoning';

export type ConfigGapSubCategory =
  | 'field_gap'
  | 'rule_gap'
  | 'term_gap'
  | 'view_gap';

export type Difficulty = 'basic' | 'intermediate' | 'advanced';

export type EvalCategory =
  | 'volume_metric'
  | 'conversion_rate'
  | 'activity_metric'
  | 'attribution'
  | 'forecast'
  | 'activity_analysis';

export interface RequiredPattern {
  pattern: string;
  rule?: string;
  reason?: string;
}

export interface BannedPattern {
  pattern: string;
  without?: string;
  rule?: string;
}

export interface ExpectedToolCall {
  [toolName: string]: Record<string, unknown>;
}

export interface KnowledgeAssertion {
  question: string;
  expected: string;
  tool: string;
}

export interface NegativeControl {
  description: string;
  banned_pattern: string;
  reason?: string;
}

export interface EvalCase {
  id: string;
  request: string;
  difficulty: Difficulty;
  category: EvalCategory;
  required_patterns?: RequiredPattern[];
  banned_patterns?: BannedPattern[];
  expected_tool_calls?: ExpectedToolCall[];
  reference_sql?: string;
  knowledge_assertions?: KnowledgeAssertion[];
  negative_controls?: NegativeControl[];
}

export interface PatternCheck {
  pattern: string;
  status: 'pass' | 'fail';
  note?: string;
}

export interface NegativeCheck {
  control: string;
  status: 'pass' | 'fail';
  note?: string;
}

export interface EvalOutcome {
  case_id: string;
  status: 'pass' | 'partial' | 'fail';
  failure_category: FailureCategory | null;
  failure_sub_category?: ConfigGapSubCategory;
  gaps: string[];
  required_checks: PatternCheck[];
  banned_checks: PatternCheck[];
  negative_checks: NegativeCheck[];
}
