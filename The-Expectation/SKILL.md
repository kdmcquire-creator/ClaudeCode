---
name: The Expectation
description: >
  Dynamic-workflow quality engine: generates candidate work, adversarially verifies
  it, and selects the single best output against a fixed quality bar — emitting an
  auditable provenance trail. Invoke for any deliverable where consistency, accuracy,
  and trustworthy provenance matter more than raw speed. Triggers: "run this through
  The Expectation", "hold this to the bar", "maximum-rigor", or any high-stakes
  external/legal/financial deliverable.
---

# The Expectation — Orchestrator

> Quality is **structural, not motivational.** This skill does not ask any agent to
> *want* to do well. It builds the workflow so that work which doesn't clear a fixed
> bar cannot survive to the output, because a separated role catches it and a judge
> drops it. Read the four engine files before executing:
> `../quality-engine/rubric.md`, `patterns.md`, `verification.md`, `provenance-template.md`.

---

## Activation
When invoked, enter **dynamic-workflow mode**: do not answer directly. Instead run the
control loop below, choosing patterns to fit the task, and ship only a PASS (or an
honest STUCK). Always emit the provenance trail with the deliverable.

---

## Control flow

### Step 0 — Classify (P1, always)
Read the task. Tag it on the four axes (answer-shape / checkability / stakes / surface).
Honor `insight_n/a` ONLY if `single-correct` AND `mechanical-transform`; any doubt →
D4 stays live. This classification is line 1 of the provenance trail.

### Step 1 — Set tier
- Default **Standard** unless the user said cheap/maximum or stakes dictate.
- `stakes: high` forces **minimum Standard** and upgrades verification toward FRESH,
  regardless of any "cheap" request — state this if it overrides the user.

### Step 2 — Select plan (consult patterns.md decision table)
Pick the pattern stack. You may deviate from the table **only by adding rigor, never
by removing P3.** Record the stack and any deviation+reason for the trail.

### Step 3 — THE APPROVAL GATE (single, by default)
Present, compactly:
> classification · tier · proposed pattern stack · est. effort (call count band) ·
> any tier override · what "done" will require (the bar).
Then **stop and wait for approval.**
- This is the **one** gate by default — placed here because this is where the bulk
  of cost commits.
- After approval, run unattended to convergence.
- You may request **one additional gate mid-run ONLY** if you hit something genuinely
  critical and irreversible that the user didn't anticipate (e.g., the work reveals a
  decision only Kyle can make, or an action with external/irreversible consequence).
  Each extra ask must justify itself; extra gates are not a default.
- **Cheap tier may skip the gate** for clearly routine `routine`-stakes tasks, since
  its cost is one pass + verify. It still emits the trail. (If unsure, gate.)

### Step 4 — Generate
Execute the chosen generation pattern(s): single pass (cheap), fan-out (P2),
or multi-candidate (P4/P5). Mechanical-transform tasks: produce the exact transform.

### Step 5 — Verify (P3, mandatory, every tier)
Run adversarial verification per verification.md: separated role, firewalled or fresh,
fabrication sweep first, score every dimension with cited evidence. Set independence
mode by tier/stakes and **log it.**

### Step 6 — Filter / tournament (if multiple candidates)
Judge → rank → drop sub-threshold with cited reasons (P4); bracket if P5. Survivor proceeds.

### Step 7 — Evaluate against the bar
- **PASS** (no dim <3, D1≥3, composite≥16/20 [or ≥12/16 if insight_n/a], no fabrication):
  → go to Step 9.
- **FAIL:** → Step 8.

### Step 8 — Loop or escalate (P6)
- If the gap is revision-fixable: revise (generator role responds to findings) →
  return to Step 5. Re-score.
- **Convergence test:** if two consecutive rounds show no material change in the kept
  dimensions' scores, stop looping.
- **Cheap-tier FAIL:** auto-escalate to Standard (more candidates / more rounds) — the
  bar is unchanged; effort increases. Note the escalation in the trail.
- **Hard cap** (cheap:1 revise · standard:3 · maximum:5). If cap hit while still FAIL
  → Step 10 (STUCK). Never ship a downgraded output; never fake closure.

### Step 9 — Ship
Emit deliverable + full provenance trail (verbosity per tier). Final attestation shows
the bar check explicitly.

### Step 10 — STUCK (honest exit)
If the bar can't be cleared within cap: do **not** ship a pretend-PASS. Emit the
deliverable-so-far clearly marked, plus the UNRESOLVED block: what couldn't be cleared,
which dimension, why, and what input/access/decision from Kyle would unblock it.

---

## Tier dial (summary; mechanics in patterns.md & verification.md)

| | Cheap | Standard | Maximum |
|---|---|---|---|
| Generation | single pass | table default | widened fan-out / more candidates |
| Verify mode | INLINE→FIREWALLED | FIREWALLED | FRESH preferred |
| Tournament | no | if judgment+high | yes on judgment tasks |
| Loop cap | 1 (then escalate) | 3 | 5 |
| Approval gate | skip if routine | yes | yes |
| **Quality bar** | **same** | **same** | **same** |

> The bar row never changes. That is the whole contract: cheap buys less search, not
> a lower standard, and its mandatory verify + auto-escalate keep it honest.

---

## Hard invariants (never violated, any tier)
1. P3 adversarial verification runs on whatever is about to ship.
2. The gradee never grades itself (separation per verification.md).
3. Fabricated specifics cap the output (D1 hard rule) and force revision.
4. A FAIL never ships as a downgraded PASS — it escalates or exits STUCK.
5. The provenance trail is always emitted and always records the independence mode.
6. STUCK with honest unresolved-list outranks a confident false PASS.

## Reusability
Other skills (e.g., meeting-prep) may invoke this engine by reading the four
`../quality-engine/` files and running Steps 4–9 around their own generation logic.
The Expectation is the first consumer of the engine, not its sole owner.
