# provenance-template.md — The Auditable Trail

> Co-equal with the output, not an afterthought. Designed to be **scanned in ~60
> seconds** to see *where the confidence comes from* — not prose theater, but a
> structured record of what was generated, judged, dropped, and changed.
>
> The trail directly attacks the trust gap: you don't have to re-verify the work,
> you have to verify the *trail is sound* — a much smaller job.

---

## Format (emitted with every run, above or beside the deliverable)

```
══════════════════════════════════════════════════════════════
THE EXPECTATION — PROVENANCE TRAIL
══════════════════════════════════════════════════════════════
TASK:        <one-line restatement of the actual ask>
CLASSIFIED:  <answer-shape> / <checkability> / <stakes> / <surface>
             [insight_n/a: yes|no — basis]        ← line for 5-sec gut-check
TIER:        <cheap|standard|maximum>  (escalated from: <tier|none>)
PLAN:        <pattern stack chosen, e.g. P1→P4→P3→P6>
             deviation from default: <none | what + why>
──────────────────────────────────────────────────────────────
CANDIDATES   (generate-and-filter / tournament)
  C1  composite XX/20  [D1 D2 D3 D4 D5]  → KEPT
  C2  composite XX/20  [.. .. .. .. ..]  → DROPPED: <specific reason>
  C3  ...                                → DROPPED: <specific reason>
  [tournament bracket, if P5 ran: C1 def. C3 on D4; C1 def. C2 on D1]
──────────────────────────────────────────────────────────────
VERIFICATION (adversarial, P3)
  independence_mode:  <FRESH|FIREWALLED|INLINE>     ← worth-of-checkmark
  fabrication sweep:  N claims | verified A / flagged B / asserted C / wrong D
                      [list any asserted/wrong — these forced revision]
  findings:           <each finding → rubric dim → what changed>
  confidence note:    <none | "low-confidence PASS — verifier found little">
──────────────────────────────────────────────────────────────
ITERATION (loop-until-done, P6)
  round 1:  composite 14/20  FAIL (D2=2: missed Waha basis leg)
  round 2:  composite 17/20  FAIL (D1=2: one figure unverified)
  round 3:  composite 18/20  PASS — converged (no material Δ vs r2 on kept dims)
──────────────────────────────────────────────────────────────
FINAL ATTESTATION
  result:      <PASS | STUCK>
  scores:      [D1 D2 D3 D4 D5] = composite XX/20
  bar check:   no dim <3 ✓ | D1≥3 ✓ | composite≥16 ✓ | no fabrication ✓
  ships:       <yes | no — see UNRESOLVED>
──────────────────────────────────────────────────────────────
UNRESOLVED   (only if STUCK)
  - <what could not be cleared, which dimension, and why>
  - <what input/access/decision from Kyle would unblock it>
══════════════════════════════════════════════════════════════
```

---

## Rules for the trail
- **Every DROPPED candidate states a specific, evidence-tied reason** — never "weaker."
  A reader must be able to agree the right one survived.
- **The independence_mode line is mandatory.** Hiding it would defeat the trail's purpose.
- **The fabrication sweep counts are mandatory**, even when all clean (B/C/D = 0 is
  itself the reassurance).
- **Iteration shows the deltas, not just the final score** — you see the work *improving*
  and *why*, which is the provenance you said you currently can't get.
- **STUCK is a first-class, non-embarrassing outcome.** A truthful "here's what I
  couldn't clear and what would unblock it" outranks a confident false PASS every time.

## Verbosity by tier
- **Cheap:** compact trail — classify / tier / single-pass verify result / attestation.
  (No candidate table or iteration block if none ran.)
- **Standard / Maximum:** full trail as above.
- The trail scales with the work actually done; it never fabricates rounds that
  didn't happen to look thorough.
