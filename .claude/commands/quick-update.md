---
name: quick-update
description: Fast-path for small, low-risk changes to schema-context-mcp. Bypasses full /auto-feature pipeline for trivial updates.
---

# /quick-update — Fast Path for Small Changes

**Change:** $ARGUMENTS

---

## Scope Check

Before proceeding, verify this change qualifies for quick-update:
- Touches **≤3 files**
- Does NOT change tool response shapes
- Does NOT change config YAML schema
- Does NOT change eval test case format
- Does NOT change MCP tool names or registration

**If any of these fail → escalate to /auto-feature.**

## Process

1. **Read** the files that will be modified
2. **Make the change** — minimal, targeted edits only
3. **Validate**:
   - `npm run build` — must compile clean
   - Run relevant eval test cases (if the change affects tool behavior)
   - Verify provenance and confidence are still included in affected tool responses
4. **Report** what changed and what was validated

## Examples of Quick-Update Scope
- Adding a new field annotation to schema-config.yaml
- Adding a new rule to schema-config.yaml
- Fixing a typo in a tool response message
- Adding a new term to the terms section
- Updating a view's purpose or grain description
- Adding a new eval test case

## NOT Quick-Update Scope
- New tool implementation → /auto-feature
- Changing merger resolution logic → /auto-refactor
- Changing connector interface → /auto-feature
- Changing eval scoring model → /auto-refactor
