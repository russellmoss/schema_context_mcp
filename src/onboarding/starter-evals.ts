/**
 * Starter eval generator for onboarding.
 * Auto-generates Track B knowledge assertions from source docs (NOT from config).
 * This prevents circular validation — assertions test "does the tool return what the docs say?"
 */

import { writeFileSync } from "node:fs";
import { stringify } from "yaml";
import type { ExtractedKnowledge } from "../bootstrap/extract.js";

interface StarterAssertion {
  id: string;
  request: string;
  difficulty: string;
  category: string;
  knowledge_assertions: Array<{
    question: string;
    expected: string;
    tool: string;
  }>;
}

export function generateStarterEvals(
  knowledge: ExtractedKnowledge,
  teamPrefix: string,
): StarterAssertion[] {
  const assertions: StarterAssertion[] = [];
  let counter = 1;

  // For each view extracted from docs: assert that describe_view returns the purpose
  for (const view of knowledge.views) {
    if (!view.purpose) continue;

    // Extract a distinctive keyword from the purpose for the assertion
    const keyword = extractKeyword(view.purpose);
    if (!keyword) continue;

    assertions.push({
      id: `${teamPrefix}-b${counter}-view-${sanitizeId(view.name)}`,
      request: `What is ${view.name} for?`,
      difficulty: 'basic',
      category: 'knowledge_retrieval',
      knowledge_assertions: [{
        question: `What is ${view.name} for?`,
        expected: keyword,
        tool: 'describe_view',
      }],
    });
    counter++;
  }

  // For each field extracted from docs: assert that the field meaning appears
  for (const field of knowledge.fields) {
    if (!field.meaning) continue;

    const keyword = extractKeyword(field.meaning);
    if (!keyword) continue;

    assertions.push({
      id: `${teamPrefix}-b${counter}-field-${sanitizeId(field.name)}`,
      request: `What does ${field.name} mean?`,
      difficulty: 'basic',
      category: 'knowledge_retrieval',
      knowledge_assertions: [{
        question: `What does ${field.name} mean?`,
        expected: keyword,
        tool: 'describe_view',
      }],
    });
    counter++;
  }

  // For each rule extracted from docs: assert that the rule description appears
  for (const rule of knowledge.rules) {
    if (!rule.description) continue;

    const keyword = extractKeyword(rule.description);
    if (!keyword) continue;

    assertions.push({
      id: `${teamPrefix}-b${counter}-rule-${sanitizeId(rule.id)}`,
      request: rule.description,
      difficulty: 'basic',
      category: 'knowledge_retrieval',
      knowledge_assertions: [{
        question: rule.description,
        expected: keyword,
        tool: 'get_rule',
      }],
    });
    counter++;
  }

  return assertions;
}

export function writeStarterEvals(
  assertions: StarterAssertion[],
  outputPath: string,
): void {
  const header = [
    '# Auto-generated Track B starter assertions',
    '# Source: bootstrap extraction from source docs (NOT from config)',
    '# These assertions are doc-grounded — they test whether config covers what docs describe',
    '# Review and refine these assertions before using in production eval',
    '',
  ].join('\n');

  const yamlContent = stringify(assertions, { lineWidth: 120 });
  writeFileSync(outputPath, header + yamlContent, 'utf-8');
}

/**
 * Extract a distinctive keyword from a text string for use as an assertion expected value.
 * Picks a word that's long enough to be specific but not so generic it matches anything.
 */
function extractKeyword(text: string): string | null {
  // Remove common stop words and short words
  const stopWords = new Set([
    'the', 'and', 'for', 'from', 'with', 'that', 'this', 'which', 'when',
    'where', 'how', 'what', 'who', 'are', 'was', 'were', 'been', 'being',
    'have', 'has', 'had', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'can', 'per', 'each', 'all', 'any', 'not', 'but', 'one',
    'two', 'use', 'used', 'using',
  ]);

  const words = text.split(/\s+/)
    .map(w => w.replace(/[^a-zA-Z0-9_]/g, ''))
    .filter(w => w.length >= 4 && !stopWords.has(w.toLowerCase()));

  if (words.length === 0) return null;

  // Prefer longer, more specific words
  const sorted = words.sort((a, b) => b.length - a.length);
  return sorted[0] ?? null;
}

function sanitizeId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 30);
}
