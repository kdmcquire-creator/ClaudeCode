# quality-engine — shared verification & quality machinery

Reusable engine that holds any deliverable to a **fixed quality bar** through
adversarial verification and artifact selection, emitting an auditable provenance
trail. Quality here is **structural, not motivational**: no agent is asked to *want*
to do well — work that doesn't clear the bar is caught by a separated role and dropped.

## Files
| File | Role |
|---|---|
| `rubric.md` | The fixed, tier-independent quality bar (5 dimensions, pass contract). The spine. |
| `patterns.md` | Six workflow patterns + the task-classifier + selection decision table. |
| `verification.md` | Role-firewalling, independence modes, fabrication sweep, judging & dropping. |
| `provenance-template.md` | The ~60-second-scannable audit trail emitted with every output. |

## The bar (summary — authoritative version in rubric.md)
Ships only if: **no dimension < 3**, **D1 (accuracy) ≥ 3**, **composite ≥ 16/20**
(or ≥ 12/16 for mechanical `insight_n/a` tasks), and **no fabricated specifics**.
A fabricated number/date/name/citation caps the whole output. A FAIL never ships
downgraded — it escalates effort or exits with an honest STUCK + unblock list.

## How to wire a skill into the engine
1. In your skill's `SKILL.md`, read the four files above into context at start.
2. Run your own generation logic as the "generate" step.
3. Hand the candidate(s) to the engine: classify → verify (P3, mandatory) →
   filter/tournament if multiple → evaluate against `rubric.md` → loop or ship.
4. Emit `provenance-template.md` alongside the deliverable.

The first consumer is **the-expectation/** (a general-purpose dynamic-workflow skill).
`meeting-prep-skill/` and future skills can borrow the same engine instead of
reinventing rubrics or judging — update the bar once here, every consumer upgrades.

## Independence modes (trust calibration)
Verification logs which mode actually ran: **FRESH** (separate invocation, highest
independence) · **FIREWALLED** (same context, artifact+rubric only) · **INLINE**
(self-review, weakest — cheap tier only). A PASS under INLINE is worth less than one
under FRESH, and the trail shows you which you got.
