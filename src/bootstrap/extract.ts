import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

export interface ExtractedView {
  name: string;
  purpose?: string;
  grain?: string;
  consumers?: string[];
  freshness_notes?: string;
}

export interface ExtractedField {
  name: string;
  meaning?: string;
  type?: string;
  gotcha?: string;
}

export interface ExtractedRule {
  id: string;
  description: string;
}

export interface ExtractedTerm {
  name: string;
  definition: string;
}

export interface ExtractedKnowledge {
  views: ExtractedView[];
  fields: ExtractedField[];
  rules: ExtractedRule[];
  terms: ExtractedTerm[];
}

export interface ExtractionCoverageReport {
  views_found: number;
  fields_found: number;
  rules_found: number;
  terms_found: number;
  unrecognized_sections: string[];
}

export function reportCoverage(knowledge: ExtractedKnowledge, docsDir: string): ExtractionCoverageReport {
  const unrecognized: string[] = [];

  // Scan docs for headings that didn't produce extractions

  function scanHeadings(dir: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const s = statSync(fullPath);
      if (s.isFile() && (extname(entry) === '.md' || extname(entry) === '.markdown')) {
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const headingMatch = line.match(/^#{2,3}\s+(.+)/);
          if (headingMatch?.[1]) {
            const heading = headingMatch[1].trim();
            // Check if this heading produced any extraction
            const isViewHeading = /^(?:View|Table):\s+\S+/.test(heading);
            const isRuleSection = /rule|pattern|gotcha|constraint/i.test(heading);
            const isFieldSection = /field|column|dictionary/i.test(heading);
            const isTermSection = /term|glossary|vocabulary|definition/i.test(heading);
            if (!isViewHeading && !isRuleSection && !isFieldSection && !isTermSection) {
              unrecognized.push(`${entry}: ${heading}`);
            }
          }
        }
      } else if (s.isDirectory()) {
        scanHeadings(fullPath);
      }
    }
  }


  try {
    scanHeadings(docsDir);
  } catch {
    // If docs dir doesn't exist or can't be read, just report empty
  }

  const report: ExtractionCoverageReport = {
    views_found: knowledge.views.length,
    fields_found: knowledge.fields.length,
    rules_found: knowledge.rules.length,
    terms_found: knowledge.terms.length,
    unrecognized_sections: unrecognized,
  };

  return report;
}

export function logCoverageReport(report: ExtractionCoverageReport): void {
  console.error(`\n--- Bootstrap Coverage Report ---`);
  console.error(`Views found:  ${report.views_found}`);
  console.error(`Fields found: ${report.fields_found}`);
  console.error(`Rules found:  ${report.rules_found}`);
  console.error(`Terms found:  ${report.terms_found}`);
  if (report.unrecognized_sections.length > 0) {
    console.error(`\nUnrecognized sections (${report.unrecognized_sections.length}):`);
    for (const section of report.unrecognized_sections.slice(0, 20)) {
      console.error(`  - ${section}`);
    }
    if (report.unrecognized_sections.length > 20) {
      console.error(`  ... and ${report.unrecognized_sections.length - 20} more`);
    }
    console.error(`\nThese sections may contain valuable knowledge. See docs/bootstrap-doc-format.md for supported patterns.`);
  }
  if (report.views_found === 0 && report.fields_found === 0 && report.rules_found === 0 && report.terms_found === 0) {
    console.error(`\nNo extractions found. Check that your docs match the supported markdown patterns.`);
    console.error(`See docs/bootstrap-doc-format.md for format requirements.`);
  }
  console.error(`--- End Coverage Report ---\n`);
}

export function extractFromDocs(docsDir: string): ExtractedKnowledge {
  const knowledge: ExtractedKnowledge = {
    views: [],
    fields: [],
    rules: [],
    terms: [],
  };

  const entries = readdirSync(docsDir);
  for (const entry of entries) {
    const fullPath = join(docsDir, entry);
    const stat = statSync(fullPath);
    if (stat.isFile() && (extname(entry) === '.md' || extname(entry) === '.markdown')) {
      const content = readFileSync(fullPath, 'utf-8');
      extractFromMarkdown(content, entry, knowledge);
    } else if (stat.isDirectory()) {
      // Recurse into subdirectories
      const subKnowledge = extractFromDocs(fullPath);
      knowledge.views.push(...subKnowledge.views);
      knowledge.fields.push(...subKnowledge.fields);
      knowledge.rules.push(...subKnowledge.rules);
      knowledge.terms.push(...subKnowledge.terms);
    }
  }

  return knowledge;
}

function extractFromMarkdown(
  content: string,
  filename: string,
  knowledge: ExtractedKnowledge,
): void {
  const lines = content.split('\n');

  // Extract views (### View: or ### Table: patterns)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const viewMatch = line.match(/^###\s+(?:View|Table):\s+(\S+)/);
    if (viewMatch?.[1]) {
      const view: ExtractedView = { name: viewMatch[1] };

      // Look ahead for purpose, consumers, etc.
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const nextLine = lines[j]!;
        if (nextLine.startsWith('### ') || nextLine.startsWith('## ')) break;

        const purposeMatch = nextLine.match(/^\s*-\s*\*\*Purpose\*\*:\s*(.+)/);
        if (purposeMatch?.[1]) view.purpose = purposeMatch[1];

        const consumersMatch = nextLine.match(/^\s*-\s*\*\*Consumers\*\*:/);
        if (consumersMatch) {
          view.consumers = [];
          for (let k = j + 1; k < Math.min(j + 30, lines.length); k++) {
            const consumerLine = lines[k]!;
            const consumerMatch = consumerLine.match(/^\s+-\s+`([^`]+)`/);
            if (consumerMatch?.[1]) {
              view.consumers.push(consumerMatch[1]);
            } else if (!consumerLine.match(/^\s+-/)) {
              break;
            }
          }
        }
      }

      knowledge.views.push(view);
    }
  }

  // Extract field tables
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Look for markdown table rows with field definitions
    const fieldMatch = line.match(/^\|\s*`(\w+)`\s*\|\s*(\w+)\s*\|\s*(.+?)\s*\|$/);
    if (fieldMatch?.[1] && fieldMatch[2] && fieldMatch[3]) {
      knowledge.fields.push({
        name: fieldMatch[1],
        type: fieldMatch[2],
        meaning: fieldMatch[3].replace(/\*\*/g, '').trim(),
      });
    }
  }

  // Extract numbered rules (Critical Rules section)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const ruleMatch = line.match(/^\d+\.\s+\*\*(.+?)\*\*/);
    if (ruleMatch?.[1]) {
      const ruleId = `rule_${filename.replace('.md', '')}_${knowledge.rules.length + 1}`;
      knowledge.rules.push({
        id: ruleId,
        description: ruleMatch[1],
      });
    }
  }

  // Extract terms: "**Term**: definition" pattern
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const termMatch = line.match(/^\*\*([A-Za-z0-9_\- ]+)\*\*:\s+(.+)/);
    if (termMatch?.[1] && termMatch[2]) {
      // Skip if it looks like a view/table field (Purpose, Consumers, Grain, etc.)
      const name = termMatch[1].trim();
      if (['Purpose', 'Consumers', 'Grain', 'Freshness', 'Status'].includes(name)) continue;
      knowledge.terms.push({
        name,
        definition: termMatch[2].trim(),
      });
    }
  }

  // Extract terms from two-column glossary tables: | Term | Definition |
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const glossaryMatch = line.match(/^\|\s*([A-Za-z0-9_\- ]+)\s*\|\s*(.{10,}?)\s*\|$/);
    if (glossaryMatch?.[1] && glossaryMatch[2]) {
      const name = glossaryMatch[1].trim();
      const def = glossaryMatch[2].trim();
      // Skip header rows and separator rows
      if (name === 'Term' || name === 'Name' || name.startsWith('-')) continue;
      if (def.startsWith('-')) continue;
      // Skip if this looks like a field table row (has backticks or type keywords)
      if (name.startsWith('`') || /^(STRING|INTEGER|FLOAT|BOOLEAN|TIMESTAMP|DATE|NUMERIC)$/i.test(def.split('|')[0]?.trim() ?? '')) continue;
      knowledge.terms.push({
        name,
        definition: def.replace(/\*\*/g, '').trim(),
      });
    }
  }
}
