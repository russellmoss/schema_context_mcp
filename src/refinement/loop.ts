/**
 * Refinement loop — the core hardening automation.
 * Runs eval → classifies failures → proposes fixes → human gate → applies → re-runs.
 *
 * Explicit prohibitions (from implementation guide):
 * 1. Never silently classify rules into typed primitives
 * 2. Never author metric definitions
 * 3. Never rewrite/relax test assertions
 * 4. Never change promotion criteria
 * 5. Never auto-approve dangerous_column entries
 * 6. Never modify existing config entries (additions only)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parse, stringify } from "yaml";
import { loadConfig } from "../config/loader.js";
import { loadEvalCases } from "../eval/loader.js";
import { checkRequiredPatterns, checkBannedPatterns, checkNegativeControls, checkKnowledgeAssertions, computeOverallStatus } from "../eval/scorer.js";
import { attributeFailure } from "../eval/attribution.js";
import { generateProposals } from "./proposer.js";
import { runGate } from "./gate.js";
import type { FailureContext } from "./proposer.js";
import type { Proposal } from "./proposer.js";
import type { SchemaConfig } from "../types/config.js";
import type { EvalCase, EvalOutcome, PatternCheck, NegativeCheck, ConfigGapSubCategory } from "../types/eval.js";

export interface RefinementOptions {
  configPath: string;
  casesPath: string;
  maxIterations: number;
  autoApprove: boolean;
  logPath: string;
  docsDir?: string;
}

export interface IterationResult {
  iteration: number;
  eval_total: number;
  eval_pass: number;
  eval_fail: number;
  config_gaps: number;
  proposals_generated: number;
  proposals_approved: number;
  proposals_applied: number;
}

export async function runRefinementLoop(options: RefinementOptions): Promise<void> {
  const { configPath, casesPath, maxIterations, autoApprove, logPath, docsDir } = options;

  // Load source docs if available
  const sourceDocs = docsDir ? loadSourceDocs(docsDir) : undefined;

  console.error(`\n=== Refinement Loop ===`);
  console.error(`Config: ${configPath}`);
  console.error(`Cases: ${casesPath}`);
  console.error(`Max iterations: ${maxIterations}`);
  console.error(`Auto-approve: ${autoApprove ? 'field/view/term only' : 'disabled'}\n`);

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    console.error(`\n--- Iteration ${iteration}/${maxIterations} ---\n`);

    // Load fresh config each iteration (may have been patched)
    const config = loadConfig(configPath);
    const cases = loadEvalCases(casesPath);

    // Run offline eval
    const outcomes = evaluateCases(cases, config);

    const total = outcomes.length;
    const passing = outcomes.filter(o => o.status === 'pass').length;
    const failing = outcomes.filter(o => o.status === 'fail').length;

    console.error(`Eval: ${passing}/${total} pass, ${failing} fail`);

    // Check termination: all pass
    if (failing === 0) {
      console.error('\n✓ All eval cases pass. Refinement loop complete.');
      return;
    }

    // Collect config_gap failures
    const configGaps = extractConfigGaps(outcomes);
    console.error(`Config gaps found: ${configGaps.length}`);

    if (configGaps.length === 0) {
      console.error('No config_gap failures — remaining failures are surfacing/evaluator/agent issues.');
      console.error('These require manual investigation (Phase 6 backlog). Stopping loop.');
      logRemainingFailures(outcomes);
      return;
    }

    // Generate proposals
    const proposals = generateProposals(configGaps, config, sourceDocs);
    console.error(`Proposals generated: ${proposals.length}`);

    if (proposals.length === 0) {
      console.error('No new proposals can be generated. Remaining gaps may already be addressed or require manual action.');
      logRemainingFailures(outcomes);
      return;
    }

    // Human approval gate
    const decisions = await runGate(proposals, { autoApprove, logPath });
    const approved = decisions.filter(d => d.approved);
    console.error(`Approved: ${approved.length}/${decisions.length}`);

    if (approved.length === 0) {
      console.error('No proposals approved. Stopping loop.');
      return;
    }

    // Apply approved patches
    const approvedProposals = proposals.filter(p =>
      approved.some(d => d.proposal_id === p.id)
    );
    applyPatches(configPath, approvedProposals);
    console.error(`Applied ${approvedProposals.length} patches to ${configPath}`);
  }

  console.error(`\nMax iterations (${maxIterations}) reached. Review remaining failures manually.`);
}

function evaluateCases(cases: EvalCase[], config: SchemaConfig): EvalOutcome[] {
  return cases.map(evalCase => {
    const content = evalCase.reference_sql ?? '';

    const requiredChecks: PatternCheck[] = checkRequiredPatterns(content, evalCase.required_patterns);
    const bannedChecks: PatternCheck[] = checkBannedPatterns(content, evalCase.banned_patterns);
    const negativeChecks: NegativeCheck[] = checkNegativeControls(content, evalCase.negative_controls);

    const knowledgeChecks: PatternCheck[] = [];
    if (evalCase.knowledge_assertions) {
      const configContent = JSON.stringify(config);
      const kChecks = checkKnowledgeAssertions(configContent, evalCase.knowledge_assertions);
      knowledgeChecks.push(...kChecks);
    }

    const allRequired = [...requiredChecks, ...knowledgeChecks];
    const status = computeOverallStatus(allRequired, bannedChecks, negativeChecks);
    const { category, sub_category, gaps } = attributeFailure(allRequired, bannedChecks, negativeChecks, config);

    return {
      case_id: evalCase.id,
      status,
      failure_category: category,
      ...(sub_category ? { failure_sub_category: sub_category } : {}),
      gaps,
      required_checks: allRequired,
      banned_checks: bannedChecks,
      negative_checks: negativeChecks,
    };
  });
}

function extractConfigGaps(outcomes: EvalOutcome[]): FailureContext[] {
  const gaps: FailureContext[] = [];

  for (const outcome of outcomes) {
    if (outcome.failure_category !== 'config_gap') continue;

    const subCategory = (outcome as unknown as Record<string, unknown>).failure_sub_category as ConfigGapSubCategory | undefined;

    for (const gap of outcome.gaps) {
      // Extract the pattern from gap description
      const patternMatch = gap.match(/pattern "(.+?)"/);
      const pattern = patternMatch?.[1] ?? gap;

      gaps.push({
        case_id: outcome.case_id,
        pattern,
        sub_category: subCategory ?? 'field_gap',
        gap_description: gap,
      });
    }
  }

  return gaps;
}

function applyPatches(configPath: string, proposals: Proposal[]): void {
  // Deep clone config to avoid mutation
  const configContent = readFileSync(configPath, 'utf-8');
  const configObj = parse(configContent) as Record<string, unknown>;

  for (const proposal of proposals) {
    switch (proposal.type) {
      case 'field': {
        if (!configObj.fields) configObj.fields = {};
        const fields = configObj.fields as Record<string, unknown>;
        const fieldName = proposal.config_path.replace('fields.', '');
        // Only add — never modify existing
        if (!fields[fieldName]) {
          fields[fieldName] = proposal.patch;
        }
        break;
      }
      case 'view': {
        if (!configObj.views) configObj.views = {};
        const views = configObj.views as Record<string, unknown>;
        const viewName = proposal.config_path.replace('views.', '');
        if (!views[viewName]) {
          views[viewName] = proposal.patch;
        }
        break;
      }
      case 'term': {
        if (!configObj.terms) configObj.terms = {};
        const terms = configObj.terms as Record<string, unknown>;
        const termName = proposal.config_path.replace('terms.', '');
        if (!terms[termName]) {
          terms[termName] = proposal.patch;
        }
        break;
      }
      case 'rule_draft': {
        // Rule drafts are logged but NOT applied to config
        // Human must manually create the typed rule
        console.error(`  NOTE: Rule draft "${proposal.id}" approved but NOT applied.`);
        console.error(`  You must manually add this rule to config with the correct type and severity.`);
        break;
      }
    }
  }

  const updatedYaml = stringify(configObj, { lineWidth: 120 });
  writeFileSync(configPath, updatedYaml, 'utf-8');
}

function loadSourceDocs(docsDir: string): Map<string, string> {
  const docs = new Map<string, string>();

  function scan(dir: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isFile() && (extname(entry) === '.md' || extname(entry) === '.markdown')) {
        docs.set(fullPath, readFileSync(fullPath, 'utf-8'));
      } else if (stat.isDirectory()) {
        scan(fullPath);
      }
    }
  }

  scan(docsDir);
  return docs;
}

function logRemainingFailures(outcomes: EvalOutcome[]): void {
  const nonConfigFailures = outcomes.filter(o =>
    o.status === 'fail' && o.failure_category !== 'config_gap'
  );

  if (nonConfigFailures.length === 0) return;

  console.error('\nRemaining non-config failures (require manual investigation):');
  for (const f of nonConfigFailures) {
    console.error(`  [${f.failure_category}] ${f.case_id}: ${f.gaps.join('; ')}`);
  }
}
