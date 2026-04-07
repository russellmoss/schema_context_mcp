import type {
  SchemaConfig,
  RuleType,
  Severity,
} from "../types/config.js";

const VALID_RULE_TYPES: RuleType[] = ['ban_pattern', 'prefer_field', 'require_filter', 'date_type_rule'];
const VALID_SEVERITIES: Severity[] = ['error', 'warning', 'info'];
const VALID_CONNECTORS = ['bigquery'];

export interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export function validateConfig(raw: unknown): { config: SchemaConfig; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (typeof raw !== 'object' || raw === null) {
    errors.push({ path: '', message: 'Config must be an object', severity: 'error' });
    throw new AggregateConfigError(errors);
  }

  const obj = raw as Record<string, unknown>;

  // Warn about unknown top-level keys
  const knownKeys = new Set(['connection', 'dbt', 'fields', 'views', 'rules', 'terms', 'metrics']);
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      errors.push({ path: key, message: `Unknown top-level key: "${key}"`, severity: 'warning' });
    }
  }

  // Validate connection (required)
  if (!obj.connection || typeof obj.connection !== 'object') {
    errors.push({ path: 'connection', message: 'Missing required "connection" section', severity: 'error' });
    throw new AggregateConfigError(errors);
  }

  const conn = obj.connection as Record<string, unknown>;
  if (!conn.connector || typeof conn.connector !== 'string') {
    errors.push({ path: 'connection.connector', message: 'Missing required "connection.connector"', severity: 'error' });
  } else if (!VALID_CONNECTORS.includes(conn.connector as string)) {
    errors.push({
      path: 'connection.connector',
      message: `Unknown connector "${conn.connector}" — must be one of: ${VALID_CONNECTORS.join(', ')}`,
      severity: 'error',
    });
  }
  if (!conn.project || typeof conn.project !== 'string') {
    errors.push({ path: 'connection.project', message: 'Missing required "connection.project"', severity: 'error' });
  }
  if (!conn.datasets || !Array.isArray(conn.datasets) || conn.datasets.length === 0) {
    errors.push({ path: 'connection.datasets', message: 'Missing or empty "connection.datasets" array', severity: 'error' });
  }

  // Validate rules if present
  if (obj.rules !== undefined) {
    if (!Array.isArray(obj.rules)) {
      errors.push({ path: 'rules', message: '"rules" must be an array', severity: 'error' });
    } else {
      const ruleIds = new Set<string>();
      for (let i = 0; i < obj.rules.length; i++) {
        const rule = obj.rules[i] as Record<string, unknown>;
        const path = `rules[${i}]`;

        if (!rule.id || typeof rule.id !== 'string') {
          errors.push({ path: `${path}.id`, message: 'Missing required rule "id"', severity: 'error' });
          continue;
        }

        if (ruleIds.has(rule.id as string)) {
          errors.push({ path: `${path}.id`, message: `Duplicate rule ID: "${rule.id}"`, severity: 'error' });
        }
        ruleIds.add(rule.id as string);

        if (!rule.type || !VALID_RULE_TYPES.includes(rule.type as RuleType)) {
          errors.push({
            path: `${path}.type`,
            message: `Invalid rule type "${rule.type}" — must be one of: ${VALID_RULE_TYPES.join(', ')}`,
            severity: 'error',
          });
        }

        if (!rule.severity || !VALID_SEVERITIES.includes(rule.severity as Severity)) {
          errors.push({
            path: `${path}.severity`,
            message: `Invalid severity "${rule.severity}" — must be one of: ${VALID_SEVERITIES.join(', ')}`,
            severity: 'error',
          });
        }

        if (!rule.message || typeof rule.message !== 'string') {
          errors.push({ path: `${path}.message`, message: 'Missing required rule "message"', severity: 'error' });
        }

        // Type-specific validation
        validateRuleTypeFields(rule, path, errors);
      }
    }
  }

  const hasErrors = errors.some((e) => e.severity === 'error');
  if (hasErrors) {
    throw new AggregateConfigError(errors);
  }

  return { config: raw as SchemaConfig, errors };
}

function validateRuleTypeFields(rule: Record<string, unknown>, path: string, errors: ValidationError[]): void {
  switch (rule.type) {
    case 'ban_pattern':
      if (!rule.pattern || typeof rule.pattern !== 'string') {
        errors.push({ path: `${path}.pattern`, message: 'ban_pattern rule requires "pattern" string', severity: 'error' });
      }
      break;
    case 'prefer_field':
      if (!rule.found || typeof rule.found !== 'string') {
        errors.push({ path: `${path}.found`, message: 'prefer_field rule requires "found" string', severity: 'error' });
      }
      if (!rule.prefer || typeof rule.prefer !== 'string') {
        errors.push({ path: `${path}.prefer`, message: 'prefer_field rule requires "prefer" string', severity: 'error' });
      }
      if (typeof rule.found === 'string' && typeof rule.prefer === 'string' && rule.found === rule.prefer) {
        errors.push({
          path: `${path}`,
          message: `Self-referential prefer_field: "found" and "prefer" are both "${rule.found}"`,
          severity: 'warning',
        });
      }
      break;
    case 'require_filter':
      if (!rule.when_contains || !Array.isArray(rule.when_contains)) {
        errors.push({ path: `${path}.when_contains`, message: 'require_filter rule requires "when_contains" array', severity: 'error' });
      } else if ((rule.when_contains as unknown[]).length === 0) {
        errors.push({ path: `${path}.when_contains`, message: 'require_filter "when_contains" must not be empty', severity: 'error' });
      }
      if (!rule.required || typeof rule.required !== 'string') {
        errors.push({ path: `${path}.required`, message: 'require_filter rule requires "required" string', severity: 'error' });
      }
      break;
    case 'date_type_rule':
      if (!rule.field || typeof rule.field !== 'string') {
        errors.push({ path: `${path}.field`, message: 'date_type_rule requires "field" string', severity: 'error' });
      }
      if (!rule.expected_type || typeof rule.expected_type !== 'string') {
        errors.push({ path: `${path}.expected_type`, message: 'date_type_rule requires "expected_type" string', severity: 'error' });
      }
      if (!rule.wrong_wrapper && !rule.correct_wrapper) {
        errors.push({
          path: `${path}`,
          message: 'date_type_rule should have at least one of "wrong_wrapper" or "correct_wrapper"',
          severity: 'warning',
        });
      }
      break;
  }
}

export class AggregateConfigError extends Error {
  constructor(public readonly validationErrors: ValidationError[]) {
    const errorMessages = validationErrors
      .filter((e) => e.severity === 'error')
      .map((e) => `  ${e.path}: ${e.message}`)
      .join('\n');
    super(`Config validation failed:\n${errorMessages}`);
    this.name = 'AggregateConfigError';
  }
}
