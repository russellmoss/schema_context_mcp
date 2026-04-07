/**
 * Promotion criteria evaluator.
 * Computes the highest promotion level met based on eval results, health check, config coverage, and fixtures.
 *
 * Levels:
 * L0: Not Ready — eval failures, health_check issues, or no eval cases
 * L1: Ready with Conditions — offline evals pass, health_check clean, but gaps remain
 * L2: Ready for Internal Deployment — offline + online pass, coverage ≥70%, human sign-off
 * L3: Ready for Production Agents — L2 + Track C pass, golden stable, config versioned
 */

import type { SchemaConfig } from "../types/config.js";

export type PromotionLevel = 'L0' | 'L1' | 'L2' | 'L3';

export interface EvalSummary {
  total: number;
  pass: number;
  fail: number;
  track_a_pass: number;
  track_a_total: number;
  track_b_pass: number;
  track_b_total: number;
  track_c_pass: number;
  track_c_total: number;
  negative_pass: number;
  negative_total: number;
}

export interface HealthSummary {
  connection_errors: number;
  config_issues: number;
  unannotated_fields: number;
  stale_annotations: number;
}

export interface CoverageStats {
  total_live_fields: number;
  annotated_fields: number;
  coverage_pct: number;
  rule_count: number;
  term_count: number;
  view_count: number;
  metric_count: number;
}

export interface FixtureStatus {
  true_north_exists: boolean;
  true_north_count: number;
  golden_exists: boolean;
  golden_count: number;
  online_verified: boolean;
}

export interface CriterionResult {
  criterion: string;
  met: boolean;
  detail: string;
}

export interface PromotionResult {
  level: PromotionLevel;
  level_name: string;
  criteria: CriterionResult[];
  conditions: string[];
  blockers: string[];
}

export function computeCoverage(config: SchemaConfig, totalLiveFields: number): CoverageStats {
  const annotatedFields = Object.keys(config.fields ?? {}).length;
  const coverage_pct = totalLiveFields > 0 ? Math.round((annotatedFields / totalLiveFields) * 100) : 0;

  return {
    total_live_fields: totalLiveFields,
    annotated_fields: annotatedFields,
    coverage_pct,
    rule_count: (config.rules ?? []).length,
    term_count: Object.keys(config.terms ?? {}).length,
    view_count: Object.keys(config.views ?? {}).length,
    metric_count: Object.keys(config.metrics ?? {}).length,
  };
}

export function evaluatePromotion(
  evalSummary: EvalSummary,
  healthSummary: HealthSummary,
  coverage: CoverageStats,
  fixtures: FixtureStatus,
  hasHumanSignoff: boolean,
  hasRealTask: boolean,
  configInGit: boolean,
): PromotionResult {
  const criteria: CriterionResult[] = [];
  const conditions: string[] = [];
  const blockers: string[] = [];

  // --- L0 blockers ---
  const hasEvalCases = evalSummary.total > 0;
  criteria.push({
    criterion: 'Eval cases exist',
    met: hasEvalCases,
    detail: hasEvalCases ? `${evalSummary.total} cases` : 'No eval cases found',
  });
  if (!hasEvalCases) blockers.push('No eval cases exist');

  const noConnectionErrors = healthSummary.connection_errors === 0;
  criteria.push({
    criterion: 'No connection errors',
    met: noConnectionErrors,
    detail: noConnectionErrors ? 'Clean' : `${healthSummary.connection_errors} connection error(s)`,
  });
  if (!noConnectionErrors) blockers.push(`${healthSummary.connection_errors} connection error(s)`);

  const offlinePass = evalSummary.track_a_pass === evalSummary.track_a_total
    && evalSummary.track_b_pass === evalSummary.track_b_total
    && evalSummary.negative_pass === evalSummary.negative_total;
  criteria.push({
    criterion: 'Offline evals pass (Track A + B + negative controls)',
    met: offlinePass,
    detail: offlinePass
      ? `A: ${evalSummary.track_a_pass}/${evalSummary.track_a_total}, B: ${evalSummary.track_b_pass}/${evalSummary.track_b_total}, Neg: ${evalSummary.negative_pass}/${evalSummary.negative_total}`
      : `Failures: A: ${evalSummary.track_a_total - evalSummary.track_a_pass}, B: ${evalSummary.track_b_total - evalSummary.track_b_pass}, Neg: ${evalSummary.negative_total - evalSummary.negative_pass}`,
  });
  if (!offlinePass) blockers.push('Offline eval failures');

  // L0 if any blockers
  if (blockers.length > 0) {
    return { level: 'L0', level_name: 'Not Ready', criteria, conditions, blockers };
  }

  // --- L1 conditions (things that keep it at L1 instead of L2) ---
  if (coverage.coverage_pct < 50) {
    conditions.push(`Field annotation coverage ${coverage.coverage_pct}% (< 50%)`);
  }
  if (!fixtures.true_north_exists) {
    conditions.push('No true-north fixtures');
  }
  if (evalSummary.track_a_total === 0) {
    conditions.push('No Track A cases (only Track B)');
  }
  if (!fixtures.online_verified) {
    conditions.push('Online validation not yet passing');
  }

  // --- L2 criteria ---
  const coverageGt70 = coverage.coverage_pct >= 70;
  criteria.push({
    criterion: 'Field annotation coverage ≥ 70%',
    met: coverageGt70,
    detail: `${coverage.coverage_pct}% (${coverage.annotated_fields}/${coverage.total_live_fields})`,
  });

  criteria.push({
    criterion: 'True-north fixtures verified',
    met: fixtures.true_north_exists && fixtures.online_verified,
    detail: fixtures.true_north_exists
      ? `${fixtures.true_north_count} fixture(s), online verified: ${fixtures.online_verified}`
      : 'No true-north fixtures',
  });

  criteria.push({
    criterion: 'Human sign-off documented',
    met: hasHumanSignoff,
    detail: hasHumanSignoff ? 'Yes' : 'Not documented',
  });

  criteria.push({
    criterion: 'Config versioned in git',
    met: configInGit,
    detail: configInGit ? 'Yes' : 'Not versioned',
  });

  criteria.push({
    criterion: 'Real net-new task completed',
    met: hasRealTask,
    detail: hasRealTask ? 'Yes' : 'Not completed',
  });

  const l2Met = coverageGt70
    && (fixtures.true_north_exists ? fixtures.online_verified : true)
    && hasHumanSignoff
    && configInGit
    && hasRealTask
    && conditions.length === 0;

  if (!l2Met) {
    // L1 — conditions present
    return { level: 'L1', level_name: 'Ready with Conditions', criteria, conditions, blockers };
  }

  // --- L3 criteria ---
  const trackCPass = evalSummary.track_c_pass === evalSummary.track_c_total && evalSummary.track_c_total > 0;
  criteria.push({
    criterion: 'Track C workflow evals pass',
    met: trackCPass,
    detail: trackCPass
      ? `${evalSummary.track_c_pass}/${evalSummary.track_c_total} pass`
      : evalSummary.track_c_total === 0 ? 'No Track C cases' : `${evalSummary.track_c_total - evalSummary.track_c_pass} failures`,
  });

  criteria.push({
    criterion: 'Golden fixtures stable',
    met: fixtures.golden_exists,
    detail: fixtures.golden_exists ? `${fixtures.golden_count} fixture(s)` : 'No golden fixtures',
  });

  if (!trackCPass || !fixtures.golden_exists) {
    return { level: 'L2', level_name: 'Ready for Internal Deployment', criteria, conditions, blockers };
  }

  return { level: 'L3', level_name: 'Ready for Production Agents', criteria, conditions, blockers };
}
