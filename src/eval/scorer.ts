import type { EvalCase, PatternCheck, NegativeCheck } from "../types/eval.js";

export function checkRequiredPatterns(
  content: string,
  patterns: EvalCase['required_patterns'],
): PatternCheck[] {
  if (!patterns) return [];
  const contentLower = content.toLowerCase();

  return patterns.map((p) => {
    const found = contentLower.includes(p.pattern.toLowerCase());
    return {
      pattern: p.pattern,
      status: found ? 'pass' as const : 'fail' as const,
      note: found ? undefined : `Required pattern "${p.pattern}" not found${p.reason ? `: ${p.reason}` : ''}`,
    };
  });
}

export function checkBannedPatterns(
  content: string,
  patterns: EvalCase['banned_patterns'],
): PatternCheck[] {
  if (!patterns) return [];
  const contentLower = content.toLowerCase();

  return patterns.map((p) => {
    const found = contentLower.includes(p.pattern.toLowerCase());
    const hasException = p.without ? contentLower.includes(p.without.toLowerCase()) : false;

    if (found && !hasException) {
      return {
        pattern: p.pattern,
        status: 'fail' as const,
        note: `Banned pattern "${p.pattern}" found`,
      };
    }

    return {
      pattern: p.pattern,
      status: 'pass' as const,
    };
  });
}

export function checkNegativeControls(
  content: string,
  controls: EvalCase['negative_controls'],
): NegativeCheck[] {
  if (!controls) return [];
  const contentLower = content.toLowerCase();

  return controls.map((c) => {
    const found = contentLower.includes(c.banned_pattern.toLowerCase());
    return {
      control: c.description,
      status: found ? 'fail' as const : 'pass' as const,
      note: found ? `Negative control violated: "${c.banned_pattern}" found` : undefined,
    };
  });
}

export function checkKnowledgeAssertions(
  response: string,
  assertions: EvalCase['knowledge_assertions'],
): PatternCheck[] {
  if (!assertions) return [];
  const responseLower = response.toLowerCase();

  return assertions.map((a) => {
    const found = responseLower.includes(a.expected.toLowerCase());
    return {
      pattern: a.expected,
      status: found ? 'pass' as const : 'fail' as const,
      note: found ? undefined : `Expected "${a.expected}" in response to "${a.question}"`,
    };
  });
}

export function computeOverallStatus(
  requiredChecks: PatternCheck[],
  bannedChecks: PatternCheck[],
  negativeChecks: NegativeCheck[],
): 'pass' | 'partial' | 'fail' {
  const allChecks = [
    ...requiredChecks.map((c) => c.status),
    ...bannedChecks.map((c) => c.status),
    ...negativeChecks.map((c) => c.status),
  ];

  if (allChecks.length === 0) return 'pass';

  const failCount = allChecks.filter((s) => s === 'fail').length;
  if (failCount === 0) return 'pass';
  if (failCount < allChecks.length) return 'partial';
  return 'fail';
}
