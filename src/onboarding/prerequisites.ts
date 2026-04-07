/**
 * Prerequisites check for onboarding.
 * Verifies credentials, dataset accessibility, and INFORMATION_SCHEMA readability.
 */

import type { WarehouseConnector } from "../types/connector.js";

export interface PrerequisiteResult {
  dataset: string;
  accessible: boolean;
  schema_readable: boolean;
  view_count: number;
  error?: string;
}

export interface PrerequisitesReport {
  results: PrerequisiteResult[];
  all_passed: boolean;
  summary: string;
}

export async function checkPrerequisites(
  connector: WarehouseConnector,
  datasets: string[],
): Promise<PrerequisitesReport> {
  const results: PrerequisiteResult[] = [];

  for (const dataset of datasets) {
    const result: PrerequisiteResult = {
      dataset,
      accessible: false,
      schema_readable: false,
      view_count: 0,
    };

    // Check dataset accessibility via listViews (queries INFORMATION_SCHEMA.TABLES)
    try {
      const views = await connector.listViews(dataset);
      result.accessible = true;
      result.schema_readable = true;
      result.view_count = views.length;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.error = message;
    }

    results.push(result);
  }

  const allPassed = results.every(r => r.accessible && r.schema_readable);
  const passCount = results.filter(r => r.accessible).length;

  const summary = allPassed
    ? `All ${results.length} dataset(s) accessible. ${results.reduce((sum, r) => sum + r.view_count, 0)} total views found.`
    : `${passCount}/${results.length} dataset(s) accessible. Fix errors before proceeding.`;

  return { results, all_passed: allPassed, summary };
}

export function logPrerequisitesReport(report: PrerequisitesReport): void {
  console.error('\n--- Prerequisites Check ---');
  for (const r of report.results) {
    const status = r.accessible ? 'PASS' : 'FAIL';
    console.error(`  [${status}] ${r.dataset}: ${r.accessible ? `${r.view_count} views` : r.error}`);
  }
  console.error(`\n${report.summary}`);
  console.error('--- End Prerequisites ---\n');
}
