/**
 * Human approval gate for the refinement loop.
 * Displays proposals, collects approval decisions, logs all actions.
 *
 * --auto-approve: approves field/view/term proposals only.
 * Rules, metrics, and dangerous_columns are NEVER auto-approved.
 */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { stringify, parse } from "yaml";
import type { Proposal } from "./proposer.js";

export interface ApprovalDecision {
  proposal_id: string;
  type: string;
  approved: boolean;
  reason?: string;
  timestamp: string;
  auto_approved: boolean;
}

export interface GateOptions {
  autoApprove: boolean;
  logPath: string;
}

/**
 * Present proposals to human and collect approval decisions.
 */
export async function runGate(
  proposals: Proposal[],
  options: GateOptions,
): Promise<ApprovalDecision[]> {
  const decisions: ApprovalDecision[] = [];

  if (proposals.length === 0) {
    console.error('No proposals to review.');
    return decisions;
  }

  console.error(`\n=== Refinement Proposals (${proposals.length}) ===\n`);

  for (const proposal of proposals) {
    displayProposal(proposal);

    const canAutoApprove = options.autoApprove && proposal.auto_approvable;

    let approved: boolean;
    if (canAutoApprove) {
      console.error('  → Auto-approved (field/view/term with --auto-approve)\n');
      approved = true;
    } else if (proposal.requires_human_classification) {
      console.error('  ⚠ REQUIRES HUMAN CLASSIFICATION — cannot be auto-approved');
      approved = await promptApproval();
    } else {
      approved = await promptApproval();
    }

    decisions.push({
      proposal_id: proposal.id,
      type: proposal.type,
      approved,
      timestamp: new Date().toISOString(),
      auto_approved: canAutoApprove && approved,
    });
  }

  // Log all decisions
  logDecisions(decisions, options.logPath);

  const approvedCount = decisions.filter(d => d.approved).length;
  console.error(`\n${approvedCount}/${decisions.length} proposals approved.`);

  return decisions;
}

function displayProposal(proposal: Proposal): void {
  console.error(`--- Proposal: ${proposal.id} ---`);
  console.error(`  Type: ${proposal.type}`);
  console.error(`  Config path: ${proposal.config_path}`);
  console.error(`  Provenance: ${proposal.provenance}`);
  console.error(`  Confidence: ${proposal.confidence}`);

  // Business-readable summary
  console.error('');
  console.error(`  BUSINESS SUMMARY:`);
  console.error(`    What's missing: ${proposal.business_summary.whats_missing}`);
  console.error(`    Risk if unresolved: ${proposal.business_summary.what_could_go_wrong}`);
  console.error(`    Why this helps: ${proposal.business_summary.why_this_helps}`);

  // Technical patch
  console.error('');
  console.error(`  PROPOSED PATCH:`);
  const patchYaml = stringify(proposal.patch, { indent: 2 });
  for (const line of patchYaml.split('\n')) {
    if (line.trim()) console.error(`    ${line}`);
  }

  if (proposal.requires_human_classification) {
    console.error('');
    console.error(`  ⚠ This is a DRAFT. You must manually classify this into a typed rule primitive.`);
  }
  console.error('');
}

async function promptApproval(): Promise<boolean> {
  // In non-interactive mode (piped stdin), default to reject
  if (!process.stdin.isTTY) {
    console.error('  → Non-interactive mode: proposal skipped (use --auto-approve for field/view/term)');
    return false;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise<boolean>((resolve) => {
    rl.question('  Approve? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

function logDecisions(decisions: ApprovalDecision[], logPath: string): void {
  let existingLog: ApprovalDecision[] = [];

  if (existsSync(logPath)) {
    try {
      const content = readFileSync(logPath, 'utf-8');
      const parsed = parse(content) as { decisions?: ApprovalDecision[] };
      if (parsed?.decisions) existingLog = parsed.decisions;
    } catch {
      // If log is corrupt, start fresh
    }
  }

  const allDecisions = [...existingLog, ...decisions];
  const logContent = stringify({ decisions: allDecisions }, { lineWidth: 120 });
  writeFileSync(logPath, logContent, 'utf-8');
  console.error(`Refinement log updated: ${logPath}`);
}
