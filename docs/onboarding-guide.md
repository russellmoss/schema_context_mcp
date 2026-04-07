# Onboarding Guide — schema-context-mcp

> Step-by-step guide for new teams adopting schema-context-mcp on their own warehouse.

---

## Prerequisites

Before you begin, you need:

1. **A GCP project with BigQuery access** (or future supported connector)
2. **At least one dataset** containing views or tables you want to annotate
3. **Credentials**: either a service account key file or Application Default Credentials (ADC)

Optional but recommended:

- Source documentation describing your views, fields, and business rules (see [bootstrap doc format](../docs/bootstrap-doc-format.md))
- 3-5 critical business rules that, if violated, produce wrong numbers
- Known-good SQL from dashboards or analyst scripts
- Business-approved historical metrics for true-north validation

---

## Quick Start: Automated Onboarding

The `onboard` command scaffolds your project, checks prerequisites, bootstraps from docs, and generates starter eval cases in one step:

```bash
# With source docs (recommended)
npx schema-context-mcp onboard \
  --project your-gcp-project \
  --dataset your_dataset \
  --docs ./my-docs/ \
  --team myteam \
  --target ./my-project

# Without source docs (manual config)
npx schema-context-mcp onboard \
  --project your-gcp-project \
  --dataset your_dataset \
  --target ./my-project
```

This creates:

| File | Purpose |
|---|---|
| `config/schema-config.yaml` | Starter config with your project/dataset pre-filled |
| `tests/fixtures/true-north.yaml` | True-north fixture template |
| `tests/fixtures/golden-results.yaml` | Golden results fixture template |
| `tests/cases/track-a/track-a-starter.yaml` | Track A template (empty until you add reference SQL) |
| `tests/cases/track-b/track-b-starter.yaml` | Track B template |
| `tests/cases/track-b/starter-assertions.yaml` | Auto-generated Track B assertions from source docs (if `--docs` provided) |
| `tests/cases/track-c/track-c-starter.yaml` | Track C template |
| `tests/cases/negative-controls/negative-controls-starter.yaml` | Negative controls template |
| `onboarding-checklist.md` | Progress tracker from setup to promotion |
| `bootstrap-coverage-checklist.md` | Maps source docs to config sections |
| `promotion-checklist.md` | Promotion criteria by level (L0-L3) |

If you prefer manual setup, follow Steps 1-4 below instead.

---

## Manual Setup

### Step 1: Copy Templates

```bash
cp -r templates/ ./my-project/
```

See [`templates/`](../templates/) for all available templates with inline documentation.

### Step 2: Configure Connection

Edit `schema-config.template.yaml` (rename to `schema-config.yaml`):

```yaml
connection:
  connector: bigquery
  project: your-gcp-project-id
  datasets:
    - your_dataset_name
  # key_file: ./service-account.json  # Uncomment if not using ADC
```

### Step 3: Verify Access

The `onboard` command checks prerequisites automatically. To check manually:

```bash
npx schema-context-mcp health_check --config ./schema-config.yaml
```

Expected: no connection errors. If permissions fail, check your service account has `bigquery.tables.list` and `bigquery.tables.get` on the target dataset.

### Step 4: Bootstrap (if you have source docs)

Convert docs to [supported format](../docs/bootstrap-doc-format.md), then run:

```bash
npx schema-context-mcp bootstrap \
  --project your-project \
  --dataset your_dataset \
  --docs ./my-docs/ \
  --output ./config/schema-config.yaml
```

Review the coverage report (printed to stderr) and fill in the [bootstrap coverage checklist](../templates/bootstrap-coverage-checklist.md).

If you don't have source docs, fill in `schema-config.yaml` manually using the template comments as guidance.

---

## Step 5: Human Review (Required Gate)

This is the most important step. Review every section of the generated config:

- **Views:** Is the purpose accurate? Is the grain correct?
- **Fields:** Are meanings correct? Are dangerous fields identified?
- **Rules:** Classify each draft rule into a typed primitive (`ban_pattern`, `prefer_field`, `require_filter`, `date_type_rule`)
- **Terms:** Are definitions accurate?
- **Metrics:** Write these yourself — never auto-generate metric definitions

See the [template contract checklist](../docs/template-contract-checklist.md) for the exact shape each section must have.

---

## Step 6: Write Eval Cases

### Track B (knowledge retrieval) — start here

Write assertions that test whether the config contains expected knowledge:

```yaml
- id: myteam-b1-revenue-field
  request: "What field should I use for revenue?"
  difficulty: basic
  category: knowledge_retrieval
  knowledge_assertions:
    - question: "What field for revenue?"
      expected: "subtotal_price"
      tool: describe_view
```

### Track A (SQL correctness) — requires reference SQL

Write cases with human-authored correct SQL and pattern assertions:

```yaml
id: myteam-a1-revenue-by-channel
request: "Total revenue by channel for Q1 2025"
difficulty: basic
category: revenue_query
required_patterns:
  - pattern: "subtotal_price"
    rule: revenue_use_subtotal
    reason: "Must use subtotal for product revenue"
reference_sql: |
  SELECT channel, SUM(subtotal_price) AS revenue ...
```

### Negative controls — test rule boundaries

Write cases where rules should NOT fire.

### Track C (workflows) — optional, advanced

End-to-end workflow tests. Requires online mode.

---

## Step 7: Run Eval

```bash
# Offline eval (pattern matching against config)
npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml

# Online eval (live tool calls + warehouse queries)
npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml --online

# Write structured JSON report
npx schema-context-mcp eval --cases ./tests/cases/ --config ./config/schema-config.yaml --report ./eval-report.json
```

---

## Step 8: Refine

If eval failures are `config_gap` type, use the refinement loop:

```bash
# Interactive mode — review each proposal
npx schema-context-mcp refine \
  --config ./config/schema-config.yaml \
  --cases ./tests/cases/ \
  --docs ./my-docs/

# Auto-approve field/view/term proposals (rules still require manual approval)
npx schema-context-mcp refine \
  --config ./config/schema-config.yaml \
  --cases ./tests/cases/ \
  --auto-approve \
  --max-iterations 5
```

The system proposes config patches with business-readable summaries. You review and approve each one. Rules and metrics are never auto-generated. All decisions are logged to `refinement-log.yaml`.

---

## Step 9: Promote

Generate a promotion report:

```bash
npx schema-context-mcp promote \
  --config ./config/schema-config.yaml \
  --cases ./tests/cases/ \
  --fixtures ./tests/fixtures/ \
  --output ./promotion-report.md \
  --human-signoff \
  --real-task \
  --config-in-git
```

The `--human-signoff`, `--real-task`, and `--config-in-git` flags document that these L2 requirements are met. See the [promotion checklist](../templates/promotion-checklist.md) for level criteria (L0-L3).

---

## Reference Example

See [`examples/savvy-wealth.yaml`](../examples/savvy-wealth.yaml) for a production-scale config from a real BigQuery + RevOps environment. This example has 9 views, 40+ fields, 14 rules, 12 terms, and 4 metrics.

---

## Additional Resources

- [Template contract checklist](../docs/template-contract-checklist.md) — required YAML shapes for all templates
- [Fixture contract checklist](../docs/fixture-contract-checklist.md) — required YAML shapes for true-north and golden fixtures
- [Bootstrap doc format](../docs/bootstrap-doc-format.md) — markdown patterns the extractor understands
- [Implementation guide](../docs/onboarding-loop-implementation-guide.md) — full phased implementation plan
