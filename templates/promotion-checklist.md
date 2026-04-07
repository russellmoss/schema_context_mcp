# Promotion Checklist

> Use this checklist to evaluate readiness for each promotion level.
> Check off criteria as they are met. All items in a level must be checked before promotion.

## L0: Not Ready

Any of these conditions means the config is at L0:

- [ ] Eval suite has failures
- [ ] `health_check` reports connection errors
- [ ] No eval cases exist
- [ ] Config fails validation

**Action:** Continue in refinement loop. Do not deploy.

---

## L1: Ready with Conditions

All of these must be true:

- [ ] All offline evals pass (Track A + B + negative controls)
- [ ] `health_check` clean (no connection errors)
- [ ] Config validates without errors

Plus any of these conditions (documented):

- [ ] Field annotation coverage < 50%
- [ ] No true-north fixtures
- [ ] No Track A cases (only Track B)
- [ ] Single-person review (no business approver)
- [ ] Online validation not yet passing

**Conditions documented:** `__________________`

**Action:** Deploy for internal experimentation. Continue hardening.

---

## L2: Ready for Internal Deployment

All of these must be true:

- [ ] All offline evals pass
- [ ] Online evals pass (or explicit human waiver documented)
- [ ] `health_check` clean
- [ ] True-north fixtures verified against live warehouse (or explicit waiver with justification)
- [ ] Field annotation coverage ≥ 70%
- [ ] Human sign-off documented
- [ ] Config versioned in git
- [ ] At least one real net-new task completed successfully (not from eval suite)

**Real-task documentation:**
- Task description: `__________________`
- Agent output summary: `__________________`
- Reviewer name: `__________________`
- Outcome: `__________________`

**Online waiver (if applicable):**
- Reason online validation cannot run: `__________________`
- Waiver approved by: `__________________`
- Waiver date: `__________________`

**Action:** Deploy for production agent use within the team.

---

## L3: Ready for Production Agents (CI/CD Integrated)

All of L2 plus:

- [ ] Track C workflow evals pass
- [ ] Golden fixtures stable across 2+ consecutive runs
- [ ] Promotion report generated and signed
- [ ] Config change process documented (who can modify, review required)
- [ ] Monitoring/alerting plan for schema drift (periodic `health_check`)

**Action:** Integrate into CI/CD. Run `health_check` on schedule. Alert on drift.

---

## Sign-Off

| Level | Approved By | Date | Notes |
|---|---|---|---|
| L1 | | | |
| L2 | | | |
| L3 | | | |
