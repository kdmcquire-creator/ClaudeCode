# The Expectation — Architecture (Phase 0)

## Naming
**Skill name:** The Expectation
**One-line description (does the literal work the name doesn't):**
> Dynamic-workflow quality engine: generates candidate work, adversarially verifies it, and selects the single best output against a fixed quality bar — emitting an auditable provenance trail.

## Design principle (carried from the chat)
Quality is **structural, not motivational.** Nothing in this skill relies on an
agent "wanting" to do well or "fearing" dismissal. Instead:
- Work is verified by a separated role working only from the artifact + rubric.
- "Poor performers" = **artifacts**, identified by an independent judge and dropped.
- Trust comes from an **auditable provenance trail**, not from self-attestation.

## Directory layout

Two top-level folders. The skill is thin; the reusable machinery is shared.

```
ClaudeCode/
├── quality-engine/                 # SHARED — borrowable by any skill
│   ├── rubric.md                   # Phase 1 — the fixed quality bar (THE SPINE)
│   ├── patterns.md                 # Phase 2 — pattern library + selection table
│   ├── verification.md             # Phase 3 — firewalling, judging, dropping
│   └── provenance-template.md      # Phase 5 — the auditable trail format
│
└── the-expectation/                # THE SKILL — orchestration + control flow
    ├── SKILL.md                    # Master orchestrator (Phase 4 control flow lives here)
    ├── references/
    │   └── (skill-specific notes, links back to ../quality-engine/)
    └── scripts/
        └── (optional: provenance renderer, convergence-diff helper)
```

## Why split this way (vs. bundling into one SKILL.md)
- `meeting-prep` and future skills can invoke the **same verification engine**
  by pointing at `quality-engine/` — they don't reinvent rubrics or judging.
- The Expectation becomes the *first consumer* of the engine, not the sole owner.
- Updating the bar (rubric.md) once upgrades every skill that references it.

## Reference convention
Skills reference engine files by relative path from the repo root, e.g.
`../quality-engine/rubric.md`. At runtime in Claude Code/Desktop, the orchestrator
reads these files into context before executing.
