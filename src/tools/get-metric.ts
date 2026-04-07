import type { SchemaConfig } from "../types/config.js";
import type { MetricResult } from "../types/responses.js";

export function getMetric(
  config: SchemaConfig,
  metric: string,
  mode?: 'cohort' | 'period',
): MetricResult {
  const metricsConfig = config.metrics ?? {};
  const metricConfig = metricsConfig[metric];

  if (!metricConfig) {
    const available = Object.keys(metricsConfig);
    throw new Error(
      `Metric "${metric}" not found. Available metrics: ${available.length > 0 ? available.join(', ') : '(none configured)'}`,
    );
  }

  const modes = metricConfig.modes ?? {};
  const modeKeys = Object.keys(modes);

  // Determine which mode to return
  let effectiveMode: 'cohort' | 'period' | 'both';
  let numerator = '';
  let denominator = '';
  let date_anchor = '';
  const gotchas: string[] = [];

  if (mode && modes[mode]) {
    effectiveMode = mode;
    const modeConfig = modes[mode]!;
    numerator = modeConfig.numerator_logic ?? modeConfig.numerator;
    denominator = modeConfig.denominator_logic ?? modeConfig.denominator;
    date_anchor = modeConfig.anchor_date ?? '';
    if (modeConfig.gotcha) gotchas.push(modeConfig.gotcha);
  } else if (mode && !modes[mode]) {
    throw new Error(
      `Mode "${mode}" not available for metric "${metric}". Available modes: ${modeKeys.join(', ')}`,
    );
  } else {
    // No mode specified — return general info
    effectiveMode = modeKeys.length === 1 ? modeKeys[0] as 'cohort' | 'period' : 'both';

    if (modeKeys.length === 1) {
      const singleMode = modes[modeKeys[0]!]!;
      numerator = singleMode.numerator_logic ?? singleMode.numerator;
      denominator = singleMode.denominator_logic ?? singleMode.denominator;
      date_anchor = singleMode.anchor_date ?? '';
      if (singleMode.gotcha) gotchas.push(singleMode.gotcha);
    } else {
      // Multiple modes — show both
      for (const [mk, mv] of Object.entries(modes)) {
        if (mv.gotcha) gotchas.push(`[${mk}] ${mv.gotcha}`);
      }
      const cohortMode = modes['cohort'];
      if (cohortMode) {
        numerator = cohortMode.numerator;
        denominator = cohortMode.denominator;
        date_anchor = cohortMode.anchor_date ?? '';
      }
    }
  }

  // Build mode guidance
  let mode_guidance = '';
  if (modeKeys.includes('cohort') && modeKeys.includes('period')) {
    mode_guidance = 'Use cohort mode for "what % of leads from period X eventually converted?" Use period mode for "how many conversions happened in period X?"';
  } else if (modeKeys.length === 1) {
    mode_guidance = `Only ${modeKeys[0]} mode is defined for this metric.`;
  }

  // Find related rules
  const related_rules: string[] = [];
  const metricLower = metric.toLowerCase();
  for (const rule of config.rules ?? []) {
    const ruleText = [rule.id, rule.message].join(' ').toLowerCase();
    if (ruleText.includes(metricLower)) {
      related_rules.push(rule.id);
    }
  }

  return {
    name: metric,
    numerator,
    denominator,
    mode: effectiveMode,
    mode_guidance,
    date_anchor,
    gotchas,
    related_rules,
    provenance: 'native_config',
    confidence: 'high',
  };
}
