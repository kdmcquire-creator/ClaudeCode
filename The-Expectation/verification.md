# verification.md — The Verification Engine

> This is the heart of point (c): how poor work is *identified and dropped* without
> relying on any agent's good intentions. The mechanism is **separation + selection**,
> not incentive. Nothing here can be gamed by an agent narrating its own competence,
> because the agent doing the work never grades the work that ships.

---

## Verdict supremacy (the rule that was missing — added v1.1)
A verifier's returned score is **authoritative and final for that dimension.** The
orchestrator's only legal responses to a returned defect are: **(a) fix it and
re-verify**, or **(b) exit STUCK.** The orchestrator may NOT:
- soften, reinterpret, or re-grade a verdict ("this `clean:false` is really fine");
- reclassify a failing finding as beneath the bar's notice. The words **"cosmetic,"
  "finish-carpentry," "doesn't touch correctness," "only conformance," "minor"** are
  **forbidden moves** when applied to a sub-threshold dimension. The rubric already
  states any dimension < 3 fails *regardless of other strengths*; the orchestrator is
  barred from arguing with that.
- decide for the user that a violation is trivial. The user judges triviality from the
  **verbatim findings**, not from the orchestrator's pre-digested summary.

> This rule exists because a real session shipped a `clean:false` Design-System verdict
> after the orchestrator relabeled the violations "cosmetic finish-carpentry." That is
> the canonical false-PASS. Verdict supremacy makes it structurally illegal.

## Blocking verification (added v1.1)
Verification is **not complete when launched — only when its verdict is read.** A
verifier that was dispatched but whose returned object is **not physically present in
the orchestrator's context counts as FAIL**, never PASS. If the runtime uses async /
background agents with output files, the orchestrator MUST ingest the returned
`{clean, violations, score}` object (poll/read the result) before it may attest
anything about that dimension. "I launched the checker" ≠ "the checker passed."

## Artifact identity (added v1.1)
Before generation, the orchestrator **pins the artifact under verification** to one
immutable identity: exact path (and commit hash where applicable). **Every verifier and
the final ship/deploy must operate on that same identity**, recorded in the trail. A
verdict that audited a different path/commit than what ships is **void** → treat as
unverified → FAIL. (Real session drifted between `peak10-hedge-restructure` and a
`dashboard-template` tree; a clean verdict on one tells you nothing about the other.)

---

## Principle: the gradee never grades itself
The instance that generated an artifact has an anchoring bias toward it (it "knows
what it meant"). So verification and judging are done by a **separated role** that
sees only the artifact and the rubric — never the generator's reasoning, intentions,
or self-assessment.

### Independence modes (and the honesty flag)
In Claude Code/Desktop, true process isolation isn't always available. We support a
graded ladder and **log which one actually ran**, so you know how much the green
checkmark is worth:

| Mode | What it is | Independence | When used |
|---|---|---|---|
| **FRESH** | A genuinely separate invocation/turn with no generation context in frame | Highest | Maximum tier, high-stakes; preferred whenever achievable |
| **FIREWALLED** | Same context, but the verifier is given ONLY {artifact + rubric} and explicitly instructed to ignore prior reasoning | Medium | Standard tier default |
| **INLINE** | Self-review within one pass (weakest; anchoring likely) | Low | Cheap tier only, and flagged as such |

> **The provenance trail always records the mode.** A PASS under INLINE is worth
> less than a PASS under FRESH, and you should be able to see that at a glance.
> The orchestrator upgrades the mode automatically when stakes are `high`.

---

## Firewalling protocol (how to actually separate roles in one context)
When a true fresh invocation isn't used, the verifier turn must:
1. Receive the artifact and `rubric.md` **only**. The generator's chain-of-thought,
   notes, and any self-scoring are withheld from the verifier's working frame.
2. Open with the adversarial stance (below), not a sympathetic read.
3. Score each dimension by **citing artifact evidence**, never by trusting claims.
4. Be forbidden from "repairing" the artifact during verification — its job is to
   *find*, not *fix*. (Fixing happens in the revise step of P6, by the generator role,
   responding to findings.) This separation prevents the verifier from quietly
   laundering its own preferences into the output.

---

## Conformance grading against the law file (added v1.1)
When a deliverable has an authoritative standards file (Design-System doc, house
template, brand spec), the D3 verifier **diffs the artifact against that file directly**
— the standard is NOT retyped into the verifier prompt (retyping drifts and lets the
checklist quietly shrink). "Conformant" = "matches the law file," not "matches what was
remembered this round." The returned `violations` array is **pasted verbatim into the
provenance trail**; the orchestrator may add context but may not replace the raw
findings with its own severity summary.

## The adversarial stance (P3)
The verifier's explicit objective is to **lower unjustified scores**, not confirm them.
Its prompt frame:

> "Assume this artifact has at least one flaw that would lower its rubric score. Your
> job is to find the strongest such flaw and prove it with specific evidence from the
> artifact. For each rubric dimension, state the score the evidence actually supports —
> not the score the artifact seems to want. Pay special attention to:
> (a) any specific figure, date, name, or citation — is it actually correct/verifiable,
>     or is it a plausible-sounding fabrication? [D1 hard-rule check]
> (b) the *actual* ask vs. an easier substituted question. [D2]
> (c) silent format/length/house-standard violations. [D3]
> (d) padding masquerading as insight. [D4]
> (e) internal contradictions or a buried answer. [D5]"

### Fabrication sweep (mandatory, every verification)
Before scoring, the verifier lists every specific claim (number, date, name, citation,
"fact") and marks each: `verified` / `unverifiable-and-flagged-in-artifact` /
`unverifiable-and-asserted` / `wrong`. Any `unverifiable-and-asserted` or `wrong`
trips the D1 hard rule → caps the output → forces a revise round. This sweep is the
single most important defense against the failure you care most about.

---

## Judging & dropping (P4 / P5) — "dismiss poor performers"
When multiple candidates exist:

**P4 generate-and-filter:**
1. Judge (separated role) scores every candidate on all five dimensions, with evidence.
2. Rank by composite, tiebreak by D1.
3. **Drop every sub-threshold candidate.** Surviving candidate(s) proceed.
4. The scored kill-list (what was dropped and the specific reason) goes to the
   provenance trail. The "dismissal" is real: a discarded artifact, with cause.

**P5 tournament:**
1. Pairwise compare survivors ("which better satisfies the rubric, and on which
   dimension is the margin decisive?").
2. Build the bracket; the winner is the one that beats all comers.
3. Record the bracket + the decisive dimension per matchup.

> Selection acts on **artifacts**, never on "agents." There is no persistent agent to
> reward or punish — so there is nothing to gradeflate, bribe, or threaten. The system
> is unsubvertible in the way (c) wanted *because* the unit of judgment is the
> disposable output, not a self-interested actor.

---

## Anti-inflation guards
- A verification returning **all-4s with thin evidence** is auto-suspect → re-run once
  with a sharpened adversarial prompt. Persistent thin all-4s are flagged in provenance
  as "low-confidence PASS — verifier found little; treat with caution."
- Judge scores lacking cited evidence count as **0** for that dimension.
- The verifier may not cite the generator's self-claims as evidence of anything.
- If verifier and a re-run verifier **disagree by ≥2** on any dimension, the lower
  score stands and the disagreement is logged (conservative bias is intentional).

---

## Handoff to control flow
Verification emits, for each round:
`{candidate_id, per-dimension scores + evidence, fabrication-sweep result,
PASS/FAIL, independence_mode, findings-for-revision}`.
The orchestrator (SKILL.md) uses this to decide: ship / loop / escalate tier / exit-stuck.
