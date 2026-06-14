# patterns.md — Pattern Library & Selection Logic

> Six workflow patterns. The orchestrator selects one or more (and their order)
> based on task shape, then proposes the plan at the single approval gate.
> Patterns are tools, not rituals — using more than a task needs is waste, not virtue.

---

## The classifier (runs first, always, every tier)
Before any pattern is chosen, classify the task on four axes. These four answers
drive the selection table below and are **logged as line 1 of the provenance trail.**

- **Answer-shape:** `single-correct` (one right answer) | `open-ended` (many valid)
- **Checkability:** `verifiable` (can be checked against ground truth / logic / source) | `judgment` (quality is a matter of reasoning quality)
- **Stakes:** `routine` | `high` (irreversible, external-facing, money/legal/safety)
- **Surface:** `mechanical-transform` (single correct output, no analytic ask → `insight_n/a`) | `analytic` (D4 stays live)

> **Classifier safety rule:** `insight_n/a` is honored ONLY when answer-shape is
> `single-correct` AND surface is `mechanical-transform`. Any doubt → D4 stays live.
> Misclassification is high-leverage, so the classification is the first thing the
> provenance trail shows for a 5-second human gut-check.

> **Input-basis blocker (added v1.1):** before the gate, the classifier must resolve
> *what the deliverable is computed from.* If two or more candidate sources-of-truth
> exist (e.g. a live data feed vs. a static spreadsheet vs. a stale vintage) AND the
> output changes materially depending which is authoritative, that is a **pre-gate
> blocker** — a question to ask at the approval gate, NOT a discovery to make mid-build.
> Building on an unconfirmed basis and surfacing the conflict after code exists is the
> exact late-rework failure this rule prevents. Surface it first.

---

## The six patterns

### P1 — Classify-and-act
*Route the task to the right handling based on its type.*
- **Use when:** always (it's the entry router); and inside other patterns to branch.
- **Produces:** the classification + the chosen downstream plan.
- **Cost:** ~1 call. **Never skipped.**

### P2 — Fan-out & synthesize
*Decompose into independent sub-parts, solve each, then integrate.*
- **Use when:** the task has separable components (multi-section memo, multi-well
  analysis, a deliverable with distinct parts that don't depend on each other).
- **Produces:** sub-answers + one integrated artifact.
- **Cost:** N sub-calls + 1 synthesis. **Watch:** integration is where errors hide —
  the synthesis step must reconcile contradictions between parts, not just staple them.

### P3 — Adversarial verification
*A separated role attacks the artifact to find what lowers its rubric score.*
- **Use when:** ALWAYS, at every tier, on the candidate that's about to ship. This is
  the non-negotiable backbone — it's what makes "cheap" safe.
- **Produces:** a findings list (each finding tied to a rubric dimension + evidence)
  and a revised score.
- **Cost:** ≥1 call. See verification.md for the firewalling protocol.

### P4 — Generate-and-filter
*Produce several candidates, then an independent judge drops the sub-threshold ones.*
- **Use when:** open-ended tasks where first-draft quality is high-variance (drafting,
  framing, design choices, anything where "the first idea" is often not the best).
- **Produces:** surviving candidate(s) + the judge's scored kill-list.
- **Cost:** K generations + 1 judging. **This is the literal "dismiss poor performers."**

### P5 — Tournament
*Pairwise/bracket comparison when absolute scoring is hard but relative is easy.*
- **Use when:** several strong candidates exist and "which is better" is clearer than
  "what's the absolute score" (competing memo framings, competing model structures).
- **Produces:** a ranked bracket + winner + why-it-won.
- **Cost:** higher (multiple comparisons). Reserve for Standard/Maximum on judgment tasks.

### P6 — Loop-until-done
*Iterate generate→verify→revise until convergence or cap.*
- **Use when:** the gap between current and passing is fixable by revision (most
  high-stakes work). Wraps P3 and re-scores each round.
- **Produces:** the converged artifact + per-round deltas.
- **Termination:** convergence (two consecutive rounds, no material dimension-score
  change) PRIMARY; hard cap (tier-set) BACKSTOP; honest "stuck" exit if cap hit while
  still failing. **Never loops silently or fakes closure.**

---

## Selection decision table

| Task shape | Default patterns (Standard tier) | Notes |
|---|---|---|
| `single-correct` + `verifiable` + `mechanical-transform` | P1 → P3 | e.g. reformat, redact, apply redline. Verify the transform was exact. `insight_n/a`. |
| `single-correct` + `verifiable` + `analytic` | P1 → P3 → (P6 if fails) | e.g. "what's the unhedged exposure" — one right answer, but reasoning can err. |
| `open-ended` + `judgment` + `routine` | P1 → P4 → P3 | generate options, filter, verify winner. |
| `open-ended` + `judgment` + `high` | P1 → P4 → P5 → P6 | full stack: options → filter → tournament → loop. |
| `separable components` (any) | P1 → P2 (→ pattern-per-part) → P3 on integrated whole | fan out, then verify the *integrated* artifact, not just parts. |

> The table gives defaults. The orchestrator may deviate **only by adding rigor**,
> never by removing P3. Any deviation is stated at the approval gate with its reason.

---

## How tiers modulate (full detail in SKILL.md)
- **Cheap:** P1 → single generation → P3 (mandatory) → ship if PASS; **auto-escalate
  to Standard if FAIL.** Bar unchanged; this tier just bets the task is easy.
- **Standard:** table defaults as above, convergence cap ~3 loops.
- **Maximum:** widen fan-out (more candidates), add tournament, raise loop cap ~5,
  prefer genuinely fresh verifier invocations over same-context firewalling.

> Cheap never means a lower bar. It means one optimistic pass that P3 still polices,
> with automatic promotion the moment the bar isn't cleared.
