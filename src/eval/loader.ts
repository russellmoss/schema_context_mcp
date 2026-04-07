import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parse } from "yaml";
import type { EvalCase } from "../types/eval.js";

export function loadEvalCases(casesPath: string): EvalCase[] {
  const stat = statSync(casesPath);
  if (stat.isFile()) {
    return loadCasesFromFile(casesPath);
  }

  const cases: EvalCase[] = [];
  loadCasesFromDir(casesPath, cases);
  return cases;
}

function loadCasesFromDir(dir: string, cases: EvalCase[]): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      loadCasesFromDir(fullPath, cases);
    } else if (extname(entry) === '.yaml' || extname(entry) === '.yml') {
      const fileCases = loadCasesFromFile(fullPath);
      cases.push(...fileCases);
    }
  }
}

function loadCasesFromFile(filePath: string): EvalCase[] {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = parse(content) as unknown;

  if (Array.isArray(parsed)) {
    return parsed as EvalCase[];
  }

  if (parsed && typeof parsed === 'object' && 'id' in parsed) {
    return [parsed as EvalCase];
  }

  return [];
}

export interface TrueNorthFixture {
  id: string;
  period: string;
  type: string;
  expected: Record<string, number>;
  source: string;
  owner: string;
  last_verified: string;
}

export interface GoldenFixture {
  id: string;
  period: string;
  type: string;
  expected: Record<string, number>;
}

export interface Fixtures {
  golden: GoldenFixture[];
  true_north: TrueNorthFixture[];
}

export function loadFixtures(fixturesDir: string): Fixtures {
  const fixtures: Fixtures = { golden: [], true_north: [] };

  try {
    const goldenPath = join(fixturesDir, 'golden-results.yaml');
    const goldenContent = readFileSync(goldenPath, 'utf-8');
    const goldenParsed = parse(goldenContent) as { golden?: GoldenFixture[] };
    if (goldenParsed?.golden) {
      fixtures.golden = goldenParsed.golden;
    }
  } catch {
    // Golden fixtures are optional
  }

  try {
    const tnPath = join(fixturesDir, 'true-north.yaml');
    const tnContent = readFileSync(tnPath, 'utf-8');
    const tnParsed = parse(tnContent) as { true_north?: TrueNorthFixture[] };
    if (tnParsed?.true_north) {
      fixtures.true_north = tnParsed.true_north;
    }
  } catch {
    // True-north fixtures are optional
  }

  return fixtures;
}
