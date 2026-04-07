import type { SchemaConfig } from "../types/config.js";
import type { LintFinding, LintResult } from "../types/responses.js";

function stripComments(sql: string): string {
  // Strip block comments: /* ... */
  let result = '';
  let i = 0;
  while (i < sql.length) {
    if (i < sql.length - 1 && sql[i] === '/' && sql[i + 1] === '*') {
      // Skip until */
      i += 2;
      while (i < sql.length - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i++;
      }
      i += 2; // Skip past */
    } else if (i < sql.length - 1 && sql[i] === '-' && sql[i + 1] === '-') {
      // Skip until end of line
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
    } else {
      result += sql[i];
      i++;
    }
  }
  return result;
}

export function lintQuery(
  sql: string,
  config: SchemaConfig,
): LintResult {
  if (!sql.trim()) {
    throw new Error('Empty query — nothing to lint');
  }

  const rules = config.rules ?? [];
  const warnings: LintFinding[] = [];

  // Pre-process: strip comments and normalize to lowercase
  const cleaned = stripComments(sql).toLowerCase();

  for (const rule of rules) {
    switch (rule.type) {
      case 'ban_pattern': {
        if (cleaned.includes(rule.pattern.toLowerCase())) {
          warnings.push({
            rule_id: rule.id,
            type: 'ban_pattern',
            severity: rule.severity === 'info' ? 'warning' : rule.severity,
            message: rule.message,
            confidence: 'medium',
            provenance: 'native_config',
          });
        }
        break;
      }

      case 'prefer_field': {
        const foundLower = rule.found.toLowerCase();
        const preferLower = rule.prefer.toLowerCase();
        if (cleaned.includes(foundLower) && !cleaned.includes(preferLower)) {
          warnings.push({
            rule_id: rule.id,
            type: 'prefer_field',
            severity: rule.severity === 'info' ? 'warning' : rule.severity,
            message: rule.message,
            confidence: 'medium',
            provenance: 'native_config',
          });
        }
        break;
      }

      case 'require_filter': {
        const triggered = rule.when_contains.some((trigger) =>
          cleaned.includes(trigger.toLowerCase()),
        );
        if (triggered && !cleaned.includes(rule.required.toLowerCase())) {
          warnings.push({
            rule_id: rule.id,
            type: 'require_filter',
            severity: rule.severity === 'info' ? 'warning' : rule.severity,
            message: rule.message,
            confidence: 'medium',
            provenance: 'native_config',
          });
        }
        break;
      }

      case 'date_type_rule': {
        const fieldLower = rule.field.toLowerCase();
        if (cleaned.includes(fieldLower) && rule.wrong_wrapper) {
          const wrongLower = rule.wrong_wrapper.toLowerCase();
          if (cleaned.includes(wrongLower)) {
            warnings.push({
              rule_id: rule.id,
              type: 'date_type_rule',
              severity: rule.severity === 'info' ? 'warning' : rule.severity,
              message: rule.message,
              confidence: 'medium',
              provenance: 'native_config',
            });
          }
        }
        break;
      }
    }
  }

  return {
    warnings,
    passed: warnings.length === 0,
    note: 'Heuristic linting — substring-based, not AST. Treat as guidance.',
  };
}
