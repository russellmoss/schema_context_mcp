/**
 * Scaffold module for onboarding.
 * Copies template files and substitutes project/dataset values.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve templates dir relative to the package root (two levels up from dist/onboarding/)
function getTemplatesDir(): string {
  // Try relative to dist/ first (installed package or built)
  const fromDist = join(__dirname, '..', '..', 'templates');
  if (existsSync(fromDist)) return fromDist;

  // Try relative to src/ (development)
  const fromSrc = join(__dirname, '..', '..', '..', 'templates');
  if (existsSync(fromSrc)) return fromSrc;

  throw new Error('Cannot find templates/ directory. Ensure schema-context-mcp is installed correctly.');
}

export interface ScaffoldOptions {
  targetDir: string;
  project: string;
  datasets: string[];
  connector?: string;
}

export function scaffoldProject(options: ScaffoldOptions): string[] {
  const { targetDir, project, datasets, connector = 'bigquery' } = options;
  const templatesDir = getTemplatesDir();
  const created: string[] = [];

  // Create target directories
  const evalCasesDir = join(targetDir, 'tests', 'cases', 'track-a');
  const trackBDir = join(targetDir, 'tests', 'cases', 'track-b');
  const trackCDir = join(targetDir, 'tests', 'cases', 'track-c');
  const negControlsDir = join(targetDir, 'tests', 'cases', 'negative-controls');
  const fixturesDir = join(targetDir, 'tests', 'fixtures');
  const configDir = join(targetDir, 'config');

  for (const dir of [evalCasesDir, trackBDir, trackCDir, negControlsDir, fixturesDir, configDir]) {
    mkdirSync(dir, { recursive: true });
  }

  // Copy and substitute schema-config template
  const configTemplate = readFileSync(join(templatesDir, 'schema-config.template.yaml'), 'utf-8');
  const configContent = configTemplate
    .replace(/<YOUR_GCP_PROJECT>/g, project)
    .replace(/<YOUR_PRIMARY_DATASET>/g, datasets[0] ?? 'your_dataset')
    .replace(/connector: bigquery/, `connector: ${connector}`);
  const configPath = join(configDir, 'schema-config.yaml');
  writeFileSync(configPath, configContent, 'utf-8');
  created.push(configPath);

  // Copy fixture templates
  const fixtureFiles = [
    { src: 'true-north.template.yaml', dest: join(fixturesDir, 'true-north.yaml') },
    { src: 'golden-results.template.yaml', dest: join(fixturesDir, 'golden-results.yaml') },
  ];
  for (const f of fixtureFiles) {
    copyFileSync(join(templatesDir, f.src), f.dest);
    created.push(f.dest);
  }

  // Copy eval case templates
  const evalFiles = [
    { src: 'eval-cases/track-a.template.yaml', dest: join(evalCasesDir, 'track-a-starter.yaml') },
    { src: 'eval-cases/track-b.template.yaml', dest: join(trackBDir, 'track-b-starter.yaml') },
    { src: 'eval-cases/track-c.template.yaml', dest: join(trackCDir, 'track-c-starter.yaml') },
    { src: 'eval-cases/negative-controls.template.yaml', dest: join(negControlsDir, 'negative-controls-starter.yaml') },
  ];
  for (const f of evalFiles) {
    copyFileSync(join(templatesDir, f.src), f.dest);
    created.push(f.dest);
  }

  // Copy markdown checklists
  const checklistFiles = [
    { src: 'onboarding-checklist.md', dest: join(targetDir, 'onboarding-checklist.md') },
    { src: 'bootstrap-coverage-checklist.md', dest: join(targetDir, 'bootstrap-coverage-checklist.md') },
    { src: 'promotion-checklist.md', dest: join(targetDir, 'promotion-checklist.md') },
  ];
  for (const f of checklistFiles) {
    copyFileSync(join(templatesDir, f.src), f.dest);
    created.push(f.dest);
  }

  return created;
}
