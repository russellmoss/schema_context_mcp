import type { SchemaConfig, TermConfigExpanded } from "../types/config.js";
import type { TermDefinition } from "../types/responses.js";

export function resolveTerm(
  term: string,
  config: SchemaConfig,
): TermDefinition {
  const termsConfig = config.terms ?? {};
  const fieldsConfig = config.fields ?? {};
  const rules = config.rules ?? [];
  const termLower = term.toLowerCase();

  // Exact or case-insensitive lookup in terms config
  let definition = 'Not found';
  let found = false;
  let gotchas: string[] = [];
  let configRelatedFields: string[] = [];
  let configRelatedRules: string[] = [];

  for (const [key, value] of Object.entries(termsConfig)) {
    if (key.toLowerCase() === termLower) {
      found = true;
      if (typeof value === 'string') {
        definition = value;
      } else {
        const expanded = value as TermConfigExpanded;
        definition = expanded.definition;
        if (expanded.related_fields) configRelatedFields = expanded.related_fields;
        if (expanded.related_rules) configRelatedRules = expanded.related_rules;
        if (expanded.gotcha) gotchas.push(expanded.gotcha);
      }
      break;
    }
  }

  // Find related fields by substring matching on field names
  const related_fields = new Set(configRelatedFields);
  for (const fieldName of Object.keys(fieldsConfig)) {
    if (fieldName.toLowerCase().includes(termLower)) {
      related_fields.add(fieldName);
    }
  }

  // Find related rules by substring matching
  const related_rules = new Set(configRelatedRules);
  for (const rule of rules) {
    const ruleText = [rule.id, rule.message].join(' ').toLowerCase();
    if (ruleText.includes(termLower)) {
      related_rules.add(rule.id);
    }
  }

  // Gather gotchas from related fields
  for (const fieldName of related_fields) {
    const fieldCfg = fieldsConfig[fieldName];
    if (fieldCfg?.gotcha) {
      gotchas.push(fieldCfg.gotcha);
    }
  }

  // Deduplicate gotchas
  gotchas = [...new Set(gotchas)];

  return {
    term,
    definition,
    found,
    related_fields: [...related_fields],
    related_rules: [...related_rules],
    gotchas,
    provenance: 'native_config',
    confidence: found ? 'high' : 'high', // Confident either way — we know if it's defined or not
  };
}
