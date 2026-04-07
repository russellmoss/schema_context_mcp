---

name: prep-publish
description: Audit, plan, and optionally execute the cleanup and packaging work needed to make schema-context-mcp publishable to npm without breaking internal usability.
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# /prep-publish — Publish Prep Workflow

Prepare `schema-context-mcp` for npm publication in a disciplined, phased way.

This command is **not** for feature development. It is for:

* auditing the repo for publishability
* separating publishable assets from internal-only assets
* generating a cleanup plan
* optionally executing that plan phase by phase
* validating that the package will install and work in a clean environment

**Publish-prep target:** $ARGUMENTS

---

## What this command does

`/prep-publish` helps answer:

1. What should ship in the npm package?
2. What should stay in the repo but NOT ship?
3. What is internal-only and should be archived or excluded?
4. What docs/examples/templates are safe and useful for outside teams?
5. What packaging fixes are required before publish?
6. Is the package actually ready to be installed cleanly by another team?

This workflow is especially important because the repo may contain:

* internal bootstrap docs
* business-specific fixtures
* implementation guides
* hardening artifacts
* internal agent/dev dependencies
* paths/examples that are safe for internal use but not appropriate for npm distribution

---

## Modes

### Plan mode

Audit + cleanup plan only. No code or docs changed unless explicitly requested.

Use when:

* you want a publish-readiness report
* you want council feedback on what should ship
* you want to review the plan before changes

### Execute mode

Follow the approved cleanup plan phase by phase.

Use when:

* the plan has already been reviewed
* you want to perform the cleanup
* you want validation after each phase

---

## Process

## 0. Pre-read

Read these first:

* `README.md`
* `docs/implementation-guide-v1.md`
* `docs/onboarding-loop-implementation-guide.md`
* `testing-protocol.md`
* `package.json`
* any existing `ARCHITECTURE.md`, `CHANGELOG.md`, `.npmignore`, and template/example directories if present

These define:

* current scope
* intended public surface
* internal hardening artifacts
* expected onboarding flow
* current package behavior

---

## 1. Repo audit using specialist agents

Before proposing any cleanup, use the existing specialists to inspect the repo from different angles.

### 1a. code-inspector

Use `code-inspector` to determine:

* current CLI entrypoints
* MCP tool registration surface
* runtime-critical files
* response-shape-sensitive modules
* code that absolutely must not be broken during cleanup

Focus on:

* `src/index.ts`
* CLI subcommands
* tools
* connectors
* config loader/validator
* onboarding/refinement/promotion code
* response-contract-sensitive areas

### 1b. dependency-mapper

Use `dependency-mapper` to determine:

* which files/modules are runtime-critical
* which dev/test/docs artifacts are safe to move or exclude
* what import paths must remain stable
* whether any publish cleanup would create circular dependency or entrypoint risk

Focus on:

* package entrypoints
* `bin` / CLI paths
* anything under `src/`
* examples/templates/docs that may be referenced by runtime code

### 1c. pattern-finder

Use `pattern-finder` to determine:

* packaging-sensitive patterns already established
* response-contract or provenance/confidence assumptions that docs/examples must not misrepresent
* error-handling/help-text conventions
* whether template/example packaging would violate existing architecture patterns

Focus on:

* tool response patterns
* config parsing patterns
* eval/report patterns
* connector patterns
* CLI behavior patterns

### 1d. data-verifier

Use `data-verifier` only if needed to check whether any examples/fixtures/docs are too environment-specific or rely on live warehouse assumptions that should not be shipped as default public behavior.

Do **not** run warehouse queries unless the audit actually requires it.

---

## 2. Classify repository contents

Build a classification table for the repo.

Every meaningful file/directory should be assigned to one of these categories:

### A. Ship in npm package

Code and assets required by external users:

* runtime code
* CLI code
* templates
* generic docs needed for usage
* safe examples

### B. Keep in repo, exclude from npm package

Useful for contributors but not needed by package consumers:

* implementation guides
* internal validation docs
* internal bootstrap references
* internal architecture notes
* local hardening logs
* council prompts/specs not needed by users

### C. Internal-only / archive / remove

Artifacts that should not remain in the public package surface:

* local-only paths
* temporary scratch outputs
* private business fixtures
* internal-only dev dependencies/config
* stale/generated files no longer needed

The classification must be explicit and justified.

---

## 3. Generate the publish cleanup plan

Produce a phased cleanup plan.

The plan should include at least these phases:

### Phase 0 — Publish surface audit

* inspect package.json
* inspect build output
* inspect CLI entrypoints
* inspect `files` / `.npmignore`
* inspect docs/examples/templates
* inspect internal-only assets and dependencies

### Phase 1 — Package boundary definition

* decide what ships vs does not ship
* define npm package contents
* define repo-only artifacts
* define internal-only exclusions

### Phase 2 — Documentation cleanup

* generic README
* generic onboarding docs
* safe examples
* usage/help documentation
* remove or isolate internal references

### Phase 3 — Package hardening

* package.json cleanup
* `files` field or `.npmignore`
* dependency cleanup
* engines field
* bin/CLI validation
* help/version behavior
* changelog/license if needed

### Phase 4 — Clean-install validation

* install package in a fresh directory
* verify CLI starts
* verify templates/examples are usable
* verify no internal paths or assumptions leak
* verify onboarding flow is still coherent

### Phase 5 — Publish readiness report

* ready / ready with conditions / not ready
* blockers
* recommended next actions
* human approval gate

---

## 4. Council review

If the plan is non-trivial, run a council review before execution.

### OpenAI review

Ask:

* Does the cleanup plan preserve runtime behavior and public API stability?
* Are there any risks to MCP tool names, response contracts, config format, or CLI expectations?
* Is anything critical being excluded or changed improperly?

### Gemini review

Ask:

* Is the cleanup plan sufficient for outside-team usability?
* Are docs/examples/templates generic enough?
* Are there adoption gaps, packaging gaps, or usability issues remaining?

Incorporate council feedback into the final plan before any execution.

---

## 5. Optional execution

If execution is requested, follow the approved plan **phase by phase**.

For each phase:

1. state the phase goal
2. list files likely to change
3. make only the necessary changes
4. run validation
5. stop if a phase fails validation

Do **not** collapse phases into one giant cleanup.

---

## 6. Validation requirements

Any execution pass must validate all of the following as relevant:

### Build/package validation

* `npm run build`
* `npm run lint`
* package tarball contents inspection
* CLI entrypoint sanity
* `--help` behavior if supported

### Package-surface validation

* only intended files ship
* internal-only assets excluded
* safe examples included if intended
* no secrets, local paths, or private assumptions

### Fresh-install validation

* install in a clean temp directory
* basic command works
* docs/examples/templates resolve correctly
* onboarding flow is still understandable from packaged assets

### Regression protection

Do not break:

* MCP tool names
* tool response shapes
* config schema
* provenance/confidence contract
* onboarding/refinement/promotion runtime behavior

If packaging cleanup touches any runtime-critical area, escalate the blast radius clearly.

---

## Rules

* Do not publish automatically.
* Do not bump versions automatically unless explicitly requested.
* Do not modify tool names.
* Do not modify response contracts.
* Do not modify config schema unless explicitly requested.
* Do not silently delete files without classifying them first.
* Do not remove internal docs from the repo unless clearly requested; prefer excluding them from npm package.
* Prefer minimal, reversible cleanup.
* If the package is not ready, say so clearly.

---

## Required output format

### 1. Current publishability status

* ready / ready with conditions / not ready
* short explanation

### 2. Repo classification table

* ship / keep-in-repo-only / internal-only
* path
* rationale

### 3. Cleanup plan

* phased
* file groups affected
* validation per phase
* blockers/risks

### 4. Council findings

* OpenAI summary
* Gemini summary
* plan adjustments made

### 5. If execution requested

* change log
* validation results
* remaining blockers

### 6. Final publish-readiness verdict

* safe to proceed to publish prep execution
* safe to publish
* not yet safe

---

## Suggested usage

### Plan only

`/prep-publish audit repo and generate a publish cleanup plan`

### Plan + council

`/prep-publish audit repo, classify assets, get council review, and produce an execution-ready cleanup plan`

### Execute approved plan

`/prep-publish execute the approved publish cleanup plan phase by phase`

---

## When to escalate

Escalate instead of proceeding if:

* cleanup would change runtime behavior
* cleanup would change package entrypoints
* cleanup would break onboarding/refinement/promotion flows
* cleanup would remove assets that docs or templates still depend on
* cleanup would require a broader architectural refactor

If the task becomes architectural rather than cleanup-oriented, switch to a broader planning workflow instead of forcing it through `/prep-publish`.
