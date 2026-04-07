# Bootstrap Document Format Specification

> This document describes the markdown patterns that the bootstrap extractor (`src/bootstrap/extract.ts`) recognizes.
> Convert your source documentation to match these patterns for best extraction results.

---

## Overview

The bootstrap extractor reads markdown files (`.md` or `.markdown`) from a specified directory, recursing into subdirectories. It recognizes three extraction patterns:

1. **View extraction** — identifies warehouse views/tables
2. **Field extraction** — identifies field definitions from markdown tables
3. **Rule extraction** — identifies business rules from numbered lists

If a section of your documentation does not match any of these patterns, the extractor will skip it. The coverage report (emitted to stderr) will list unrecognized sections so you can either reformat them or extract the knowledge manually.

---

## Pattern 1: View Extraction

### Format

```markdown
### View: <view_name>

- **Purpose**: <one-sentence description>
- **Consumers**:
  - `<consumer_path_or_name>`
  - `<consumer_path_or_name>`
```

Or equivalently:

```markdown
### Table: <view_name>

- **Purpose**: <one-sentence description>
```

### Rules

- The heading must be exactly `### View: <name>` or `### Table: <name>` (level-3 heading)
- `<name>` is captured as the view name (first non-whitespace token after the colon)
- The extractor looks ahead up to 20 lines for:
  - `- **Purpose**: <text>` — captured as the view purpose
  - `- **Consumers**:` — starts a consumer list
    - Each consumer line must match: `  - \`<path>\`` (indented, backtick-wrapped)
    - Consumer list ends at the first non-indented-list line
- Extraction stops at the next `###` or `##` heading

### Example

```markdown
### View: orders_summary

- **Purpose**: Aggregated order metrics per order including revenue and fulfillment status.
- **Grain**: One row per order
- **Consumers**:
  - `src/reports/revenue.ts`
  - `src/reports/fulfillment.ts`
```

> **Note:** `grain`, `freshness_notes`, and other fields are not currently extracted. Add them manually to the generated config.

---

## Pattern 2: Field Table Extraction

### Format

```markdown
| `<field_name>` | <type> | <description> |
```

### Rules

- The extractor matches lines that look like markdown table rows with three columns
- Pattern: `| \`<word>\` | <word> | <text> |`
- The field name must be wrapped in backticks
- The second column is captured as the field type
- The third column is captured as the field meaning (bold markers `**` are stripped)
- Table headers and separator rows (`|---|---|---|`) are ignored (they don't match the pattern)

### Example

```markdown
| Field | Type | Description |
|---|---|---|
| `subtotal_price` | NUMERIC | Product revenue excluding tax and shipping |
| `created_at` | TIMESTAMP | Order creation timestamp |
| `is_active` | BOOLEAN | Whether the order is active (not deleted) |
```

> **Note:** `gotcha` and `use_instead_of` are not extracted from tables. Add them manually.

---

## Pattern 3: Rule Extraction

### Format

```markdown
1. **<rule description>**
2. **<rule description>**
```

### Rules

- The extractor matches lines starting with a number, period, space, then bold text
- Pattern: `<N>. **<text>**`
- The bold text is captured as the rule description
- An auto-generated ID is assigned: `rule_<filename>_<N>`
- Rules are extracted as free-text descriptions — they are NOT typed primitives
- A human must classify each extracted rule into a typed primitive (`ban_pattern`, `prefer_field`, `require_filter`, `date_type_rule`) during the review stage

### Example

```markdown
## Critical Rules

1. **Always use subtotal_price for revenue, never total_price**
2. **Filter on status = 'completed' when aggregating orders**
3. **Use is_active flag instead of checking deleted_at directly**
```

> **Note:** Rules extracted this way are drafts. During Stage 3 (Human Review), each rule must be classified into a typed primitive with severity, message, and type-specific fields.

---

## What Is NOT Extracted

The following are not currently supported by the extractor. Add these manually to your config after bootstrap:

| Item | Workaround |
|---|---|
| Terms / glossary entries | Add to `terms` section manually |
| Metric definitions | Always manual — requires domain expertise |
| Dangerous column annotations | Add to `views[].dangerous_columns` manually |
| Key filters | Add to `views[].key_filters` manually |
| Grain definitions | Add to `views[].grain` manually |
| Freshness notes | Add to `views[].freshness_notes` manually |
| `gotcha` fields | Add to `fields[].gotcha` or `terms[].gotcha` manually |
| `use_instead_of` relationships | Add to `fields[].use_instead_of` manually |

---

## Tips for Converting Existing Documentation

1. **Confluence / Notion / Google Docs:** Export to markdown first, then reformat headings and tables to match the patterns above
2. **SQL comments / dbt YAML:** Extract field descriptions into markdown table format
3. **Tribal knowledge:** Write it down as numbered rules in a `## Critical Rules` section
4. **Multiple documents:** Place all markdown files in a single directory (with subdirectories). The extractor recurses.
5. **Large docs:** The extractor processes the entire file. No size limit, but keep one topic per heading for best results.
