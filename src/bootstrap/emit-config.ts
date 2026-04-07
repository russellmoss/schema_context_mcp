import { stringify } from "yaml";
import type { ExtractedKnowledge } from "./extract.js";

export function emitConfig(
  knowledge: ExtractedKnowledge,
  projectId: string,
  datasets: string[],
  connector: string = 'bigquery',
): string {
  const config: Record<string, unknown> = {
    connection: {
      connector,
      project: projectId,
      datasets,
    },
  };

  // Views section
  if (knowledge.views.length > 0) {
    const views: Record<string, Record<string, unknown>> = {};
    for (const v of knowledge.views) {
      const viewEntry: Record<string, unknown> = {};
      if (v.purpose) viewEntry.purpose = v.purpose;
      if (v.grain) viewEntry.grain = v.grain;
      if (v.consumers && v.consumers.length > 0) viewEntry.consumers = v.consumers;
      if (v.freshness_notes) viewEntry.freshness_notes = v.freshness_notes;
      // TODO: Review and enrich this view annotation
      views[v.name] = viewEntry;
    }
    config.views = views;
  }

  // Fields section
  if (knowledge.fields.length > 0) {
    const fields: Record<string, Record<string, unknown>> = {};
    for (const f of knowledge.fields) {
      const fieldEntry: Record<string, unknown> = {};
      if (f.meaning) fieldEntry.meaning = f.meaning;
      if (f.type) fieldEntry.type = f.type;
      if (f.gotcha) fieldEntry.gotcha = f.gotcha;
      // TODO: Review field annotation — bootstrap confidence is low
      fields[f.name] = fieldEntry;
    }
    config.fields = fields;
  }

  // Terms section (extracted rules as terms for now)
  if (knowledge.terms.length > 0) {
    const terms: Record<string, string> = {};
    for (const t of knowledge.terms) {
      terms[t.name] = t.definition;
    }
    config.terms = terms;
  }

  // Rules are not auto-generated — they require human review to map to typed primitives
  // TODO: Review extracted rules and manually convert to ban_pattern/prefer_field/require_filter

  return stringify(config, { lineWidth: 120 });
}
