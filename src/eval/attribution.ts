import type { FailureCategory, ConfigGapSubCategory, PatternCheck, NegativeCheck } from "../types/eval.js";
import type { SchemaConfig } from "../types/config.js";

export function attributeFailure(
  requiredChecks: PatternCheck[],
  bannedChecks: PatternCheck[],
  negativeChecks: NegativeCheck[],
  config: SchemaConfig,
): { category: FailureCategory | null; sub_category?: ConfigGapSubCategory; gaps: string[] } {
  const failedRequired = requiredChecks.filter((c) => c.status === 'fail');
  const failedBanned = bannedChecks.filter((c) => c.status === 'fail');
  const failedNegative = negativeChecks.filter((c) => c.status === 'fail');

  if (failedRequired.length === 0 && failedBanned.length === 0 && failedNegative.length === 0) {
    return { category: null, gaps: [] };
  }

  const gaps: string[] = [];

  // Check if failures are due to missing config
  for (const check of failedRequired) {
    if (isKnowledgeMissing(check.pattern, config)) {
      gaps.push(`Config gap: pattern "${check.pattern}" not covered by any config entry`);
    }
  }

  if (gaps.length > 0) {
    const sub_category = classifyConfigGap(gaps, config);
    return { category: 'config_gap', sub_category, gaps };
  }

  // Check if knowledge exists but wasn't surfaced
  for (const check of failedRequired) {
    if (isKnowledgePresent(check.pattern, config)) {
      gaps.push(`Surfacing failure: "${check.pattern}" exists in config but wasn't returned`);
      return { category: 'surfacing_failure', gaps };
    }
  }

  // Banned pattern violations suggest agent reasoning issues
  if (failedBanned.length > 0) {
    for (const check of failedBanned) {
      gaps.push(`Agent used banned pattern: "${check.pattern}"`);
    }
    return { category: 'agent_reasoning', gaps };
  }

  // Negative control failures
  if (failedNegative.length > 0) {
    for (const check of failedNegative) {
      gaps.push(`Negative control violated: ${check.control}`);
    }
    return { category: 'agent_reasoning', gaps };
  }

  return { category: 'evaluator_strict', gaps: ['Unable to determine specific gap'] };
}

function isKnowledgeMissing(pattern: string, config: SchemaConfig): boolean {
  const configText = JSON.stringify(config).toLowerCase();
  return !configText.includes(pattern.toLowerCase());
}

function isKnowledgePresent(pattern: string, config: SchemaConfig): boolean {
  const configText = JSON.stringify(config).toLowerCase();
  return configText.includes(pattern.toLowerCase());
}

function classifyConfigGap(gaps: string[], config: SchemaConfig): ConfigGapSubCategory {
  // Extract patterns from gap descriptions
  const patterns = gaps.map(g => {
    const match = g.match(/pattern "(.+?)"/);
    return match?.[1]?.toLowerCase() ?? '';
  }).filter(Boolean);

  const fieldNames = new Set(Object.keys(config.fields ?? {}).map(k => k.toLowerCase()));
  const viewNames = new Set(Object.keys(config.views ?? {}).map(k => k.toLowerCase()));
  const termNames = new Set(Object.keys(config.terms ?? {}).map(k => k.toLowerCase()));
  const ruleIds = new Set((config.rules ?? []).map(r => r.id.toLowerCase()));

  for (const p of patterns) {
    // Check if the pattern looks like a field name
    if (fieldNames.has(p) || /^[a-z_][a-z0-9_]*$/i.test(p)) {
      // If it matches an existing field, it's a surfacing issue (handled elsewhere)
      // If it doesn't, it's likely a field gap
      if (!fieldNames.has(p) && !viewNames.has(p) && !termNames.has(p) && !ruleIds.has(p)) {
        return 'field_gap';
      }
    }

    // Check if the pattern matches a view name pattern
    if (/^vw_|^view_|_view$|_master$|_summary$/i.test(p)) {
      return 'view_gap';
    }

    // Check if the pattern matches a rule reference
    if (ruleIds.has(p) || /rule|ban|require|prefer/i.test(p)) {
      return 'rule_gap';
    }

    // Check if pattern is short and looks like a term/acronym
    if (p.length <= 6 && /^[A-Z]+$/i.test(p)) {
      return 'term_gap';
    }
  }

  // Default: if we can't classify more specifically, call it field_gap
  // since field annotations are the most common config gap
  return 'field_gap';
}
