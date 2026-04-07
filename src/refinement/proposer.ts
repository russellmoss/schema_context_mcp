/**
 * Proposer — generates config patch proposals from eval failure attribution.
 *
 * Automation boundaries:
 * - field_gap / view_gap / term_gap: proposes additions with meaning from source docs
 * - rule_gap: proposes free-text draft only — human must classify into typed primitive
 * - Never proposes metrics, test changes, or modifications to existing entries
 * - Never auto-classifies rules into typed primitives
 */

import type { SchemaConfig } from "../types/config.js";
import type { ConfigGapSubCategory } from "../types/eval.js";

export interface Proposal {
  id: string;
  type: 'field' | 'view' | 'term' | 'rule_draft';
  config_path: string;
  patch: Record<string, unknown>;
  provenance: string;
  confidence: 'high' | 'medium' | 'low';
  business_summary: {
    whats_missing: string;
    what_could_go_wrong: string;
    why_this_helps: string;
  };
  requires_human_classification: boolean;
  auto_approvable: boolean;
}

export interface FailureContext {
  case_id: string;
  pattern: string;
  sub_category: ConfigGapSubCategory;
  gap_description: string;
}

/**
 * Generate proposals for a set of config_gap failures.
 */
export function generateProposals(
  failures: FailureContext[],
  config: SchemaConfig,
  sourceDocs?: Map<string, string>,
): Proposal[] {
  const proposals: Proposal[] = [];
  const seen = new Set<string>();

  for (const failure of failures) {
    // Deduplicate: don't propose for the same pattern twice
    const key = `${failure.sub_category}:${failure.pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Skip if already in config
    if (isAlreadyInConfig(failure.pattern, failure.sub_category, config)) continue;

    const proposal = createProposal(failure, config, sourceDocs);
    if (proposal) proposals.push(proposal);
  }

  return proposals;
}

function createProposal(
  failure: FailureContext,
  config: SchemaConfig,
  sourceDocs?: Map<string, string>,
): Proposal | null {
  const docContext = sourceDocs ? findInSourceDocs(failure.pattern, sourceDocs) : null;

  switch (failure.sub_category) {
    case 'field_gap':
      return createFieldProposal(failure, docContext);
    case 'view_gap':
      return createViewProposal(failure, docContext);
    case 'term_gap':
      return createTermProposal(failure, docContext);
    case 'rule_gap':
      return createRuleProposal(failure, docContext);
    default:
      return null;
  }
}

function createFieldProposal(failure: FailureContext, docContext: string | null): Proposal {
  const meaning = docContext ?? `[TODO: Add meaning for ${failure.pattern}]`;

  return {
    id: `field-${sanitize(failure.pattern)}`,
    type: 'field',
    config_path: `fields.${failure.pattern}`,
    patch: {
      meaning,
    },
    provenance: docContext ? 'source_docs' : 'eval_gap',
    confidence: docContext ? 'medium' : 'low',
    business_summary: {
      whats_missing: `The config does not define what "${failure.pattern}" means.`,
      what_could_go_wrong: `An agent querying this field may misinterpret its values or use it in the wrong context.`,
      why_this_helps: `Adding the field meaning ensures agents understand this field before writing SQL with it.`,
    },
    requires_human_classification: false,
    auto_approvable: true,
  };
}

function createViewProposal(failure: FailureContext, docContext: string | null): Proposal {
  const purpose = docContext ?? `[TODO: Add purpose for ${failure.pattern}]`;

  return {
    id: `view-${sanitize(failure.pattern)}`,
    type: 'view',
    config_path: `views.${failure.pattern}`,
    patch: {
      purpose,
      grain: '[TODO: One row per <entity>]',
    },
    provenance: docContext ? 'source_docs' : 'eval_gap',
    confidence: docContext ? 'medium' : 'low',
    business_summary: {
      whats_missing: `The config does not describe the view "${failure.pattern}".`,
      what_could_go_wrong: `An agent may choose the wrong view for a query or misunderstand what this view contains.`,
      why_this_helps: `Adding purpose and grain helps agents select the correct view and understand its structure.`,
    },
    requires_human_classification: false,
    auto_approvable: true,
  };
}

function createTermProposal(failure: FailureContext, docContext: string | null): Proposal {
  const definition = docContext ?? `[TODO: Add definition for ${failure.pattern}]`;

  return {
    id: `term-${sanitize(failure.pattern)}`,
    type: 'term',
    config_path: `terms.${failure.pattern}`,
    patch: {
      definition,
    },
    provenance: docContext ? 'source_docs' : 'eval_gap',
    confidence: docContext ? 'medium' : 'low',
    business_summary: {
      whats_missing: `The config does not define the business term "${failure.pattern}".`,
      what_could_go_wrong: `An agent encountering this term may misinterpret it or confuse it with a similar concept.`,
      why_this_helps: `Adding a clear definition ensures agents understand domain vocabulary correctly.`,
    },
    requires_human_classification: false,
    auto_approvable: true,
  };
}

function createRuleProposal(failure: FailureContext, docContext: string | null): Proposal {
  const description = docContext ?? failure.gap_description;

  return {
    id: `rule-draft-${sanitize(failure.pattern)}`,
    type: 'rule_draft',
    config_path: 'rules[]',
    patch: {
      // Draft only — human must classify into typed primitive
      _draft_description: description,
      _suggested_type: '[Human must choose: ban_pattern | prefer_field | require_filter | date_type_rule]',
      _note: 'This is a FREE-TEXT DRAFT. The system does not classify rules. You must choose the type, severity, and all type-specific fields.',
    },
    provenance: docContext ? 'source_docs' : 'eval_gap',
    confidence: 'low',
    business_summary: {
      whats_missing: `The config does not have a rule covering "${failure.pattern}".`,
      what_could_go_wrong: `An agent may write SQL that violates this business constraint without being warned.`,
      why_this_helps: `Adding a typed rule ensures lint_query catches this pattern and warns agents.`,
    },
    requires_human_classification: true,
    auto_approvable: false, // Rules are NEVER auto-approvable
  };
}

function isAlreadyInConfig(
  pattern: string,
  subCategory: ConfigGapSubCategory,
  config: SchemaConfig,
): boolean {
  const pLower = pattern.toLowerCase();
  switch (subCategory) {
    case 'field_gap':
      return Object.keys(config.fields ?? {}).some(k => k.toLowerCase() === pLower);
    case 'view_gap':
      return Object.keys(config.views ?? {}).some(k => k.toLowerCase() === pLower);
    case 'term_gap':
      return Object.keys(config.terms ?? {}).some(k => k.toLowerCase() === pLower);
    case 'rule_gap':
      return (config.rules ?? []).some(r =>
        r.id.toLowerCase() === pLower ||
        r.message.toLowerCase().includes(pLower)
      );
    default:
      return false;
  }
}

function findInSourceDocs(pattern: string, sourceDocs: Map<string, string>): string | null {
  const pLower = pattern.toLowerCase();
  for (const [, content] of sourceDocs) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(pLower)) {
        // Return surrounding context (up to 3 lines)
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        return lines.slice(start, end).join(' ').trim().substring(0, 200);
      }
    }
  }
  return null;
}

function sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 40);
}
