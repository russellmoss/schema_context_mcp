---
name: refine
description: Iterative refinement of schema-context-mcp code using council feedback. Focuses on correctness, coverage gaps, and response consistency.
---

# /refine — Iterative Refinement

Refine the current implementation based on council feedback or identified issues.

**Refinement target:** $ARGUMENTS

---

## Process

1. **Identify the issue** — what specifically needs refinement? Is it:
   - A correctness issue (wrong annotation, wrong provenance, wrong confidence)?
   - A coverage gap (missing eval test case, missing edge case)?
   - A consistency issue (response shape differs from other tools)?
   - A surfacing issue (right annotation exists but isn't returned for the right intent)?

2. **Trace the issue** — use code-inspector to trace from the symptom to the root cause:
   - Tool response → handler → merger → config → connector
   - Identify exactly where the fix belongs

3. **Fix and validate**:
   - Make the minimal fix
   - Run `npm run build`
   - Run affected eval test cases
   - If the fix touches merger.ts, run ALL eval test cases (merger affects all tools)

4. **Council spot-check** (if the fix is non-trivial):
   - Ask OpenAI: "Does this fix preserve provenance and confidence correctness?"
   - Ask Gemini: "Does this fix create any new edge cases or coverage gaps?"

## Rules
- Minimal fixes only — don't refactor surrounding code
- Every fix must include an eval test case that would have caught the issue
- If the fix changes response shape, escalate to /auto-refactor (Lane 4)
