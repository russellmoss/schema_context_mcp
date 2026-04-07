import type { SchemaConfig, RuleConfig } from "../types/config.js";
import type { RuleResult } from "../types/responses.js";

function ruleConfigToResult(rule: RuleConfig): RuleResult {
  const base: RuleResult = {
    id: rule.id,
    type: rule.type,
    severity: rule.severity,
    message: rule.message,
    ...(rule.context ? { context: rule.context } : {}),
    provenance: 'native_config',
    confidence: 'high',
  };

  switch (rule.type) {
    case 'ban_pattern':
      return { ...base, pattern: rule.pattern };
    case 'prefer_field':
      return { ...base, found: rule.found, prefer: rule.prefer };
    case 'require_filter':
      return { ...base, when_contains: rule.when_contains, required: rule.required };
    case 'date_type_rule':
      return {
        ...base,
        field: rule.field,
        expected_type: rule.expected_type,
        ...(rule.wrong_wrapper ? { wrong_wrapper: rule.wrong_wrapper } : {}),
        ...(rule.correct_wrapper ? { correct_wrapper: rule.correct_wrapper } : {}),
      };
  }
}

export function getRule(
  config: SchemaConfig,
  ruleId?: string,
  search?: string,
): RuleResult | RuleResult[] {
  const rules = config.rules ?? [];

  if (ruleId) {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) {
      throw new Error(
        `Rule "${ruleId}" not found. Available rules: ${rules.map((r) => r.id).join(', ')}`,
      );
    }
    return ruleConfigToResult(rule);
  }

  if (search) {
    const searchLower = search.toLowerCase();
    const matches = rules.filter((r) => {
      const searchableText = [
        r.id,
        r.message,
        r.type === 'ban_pattern' ? r.pattern : '',
        r.type === 'prefer_field' ? `${r.found} ${r.prefer}` : '',
        r.type === 'require_filter' ? r.when_contains.join(' ') : '',
        r.type === 'date_type_rule' ? r.field : '',
      ].join(' ').toLowerCase();
      return searchableText.includes(searchLower);
    });

    if (matches.length === 0) {
      throw new Error(
        `No rules matching "${search}". Available rules: ${rules.map((r) => r.id).join(', ')}`,
      );
    }

    return matches.map(ruleConfigToResult);
  }

  // No filter — return all rules
  return rules.map(ruleConfigToResult);
}
