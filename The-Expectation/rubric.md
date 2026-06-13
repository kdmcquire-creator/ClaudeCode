# rubric.md — The Fixed Quality Bar

> This rubric is **tier-independent**. Cheap, Standard, and Maximum tiers all hold
> output to the *same* bar. Tiers change how much effort is spent *searching* for
> output that clears the bar — never the bar itself.
>
> An output **ships only if it PASSES**. A failing output at any tier triggers
> escalation (more effort) or, if effort is exhausted, the honest "stuck" exit —
> never a downgraded ship.

---

## The five dimensions

Every candidate is scored 0–4 on each. Definitions are concrete so two independent
judges scoring the same artifact land within 1 point. "Vibes" scores are invalid;
each score must cite the specific evidence in the artifact that earned it.

### D1 — Accuracy / Factuality
*Is every claim true, and is every uncertain claim marked as uncertain?*
- **4** — All checkable claims verified correct; all unverifiable claims explicitly flagged; numbers reconcile; sources where load-bearing.
- **3** — All claims correct; minor uncertainty unflagged but non-load-bearing.
- **2** — One load-bearing claim unverified or one minor factual slip.
- **1** — A load-bearing claim is wrong, OR confident assertion of something unverifiable.
- **0** — Multiple errors, or fabricated specifics (invented figures, fake citations, plausible-but-false detail).
- **Hard rule:** any fabricated specific (a made-up number, citation, name, or "fact" presented as known) caps the *whole output* at D1=0 regardless of other strengths.

### D2 — Completeness vs. the actual ask
*Does it answer what was asked — all of it — and not silently substitute an easier question?*
- **4** — Every explicit requirement met; reasonable implicit requirements met; scope matches the ask exactly.
- **3** — All explicit requirements met; an implicit one missed.
- **2** — One explicit requirement missed or partially met.
- **1** — Answers an adjacent/easier question than the one asked.
- **0** — Major requirements unaddressed.
- **Note:** over-delivery that buries the answer is a D5 problem, not a D2 win.

### D3 — Format / Conformance
*Does it conform to required structure, length, style, and house conventions?*
- **4** — Conforms exactly to specified format AND applicable house standards (e.g., Peak 10 brand, document conventions, requested length).
- **3** — Conforms to the explicit format spec; a house convention missed.
- **2** — One clear format requirement violated (wrong length band, missing required section).
- **1** — Multiple format violations or ignores a stated structure.
- **0** — Wrong artifact type entirely (asked for table, got prose).

### D4 — Insight / Non-obviousness
*Does it surface what a smart reader wouldn't already know or would have missed?*
- **4** — Identifies non-obvious implications, risks, or connections; earns its length; the reader learns something.
- **3** — Solid and correct but mostly assembles the obvious.
- **2** — Restates inputs with little added.
- **1** — Padding; generic content that fits any prompt.
- **0** — Filler / no informational gain.
- **Calibration note:** for genuinely mechanical tasks (e.g., "reformat this table"), D4's *target* is "no unnecessary embellishment" — score D4=3 as the expected ceiling and do not penalize absence of novel insight. The selection logic marks such tasks `insight_n/a` so D4 isn't double-counted against simple work.

### D5 — Internal consistency & clarity
*Does it contradict itself? Is it ordered so the answer is findable fast?*
- **4** — No contradictions; the load-bearing answer is up front and unmissable; terms used consistently.
- **3** — Coherent; answer findable with minor hunting.
- **2** — One internal inconsistency or a buried lede.
- **1** — Contradicts itself OR reader must reconstruct the answer.
- **0** — Incoherent.

---

## Pass threshold (the contract)

An output **PASSES** iff **all** of the following hold:

1. **No dimension below 3.** A single 2 anywhere = FAIL. (A weak leg fails the table.)
2. **D1 ≥ 3 is mandatory and non-negotiable** — accuracy has no substitute.
3. **Composite ≥ 16 / 20** (with `insight_n/a` tasks: composite ≥ 12 / 16, D4 excluded).
4. **No hard-rule trip** (no fabricated specifics → no D1=0 cap).

This means: a brilliant, beautifully formatted output with one wrong load-bearing
number **does not ship**. That is the entire point of the skill.

---

## How scoring is used downstream
- **generate-and-filter / tournament:** judge scores every candidate on all five
  dimensions with evidence; candidates are *ranked by composite, then by D1*, and
  sub-threshold candidates are dropped (this is the "dismiss poor performers").
- **adversarial verification:** the verifier's job is specifically to find the
  evidence that *lowers* a score — to move a claimed 4 to its true value.
- **convergence:** iteration stops when the top candidate's dimension scores stop
  changing materially between rounds (see verification.md).

## Anti-gaming guards (because the gradee can't be trusted to grade itself)
- Scores **without cited artifact evidence** are treated as 0 for that dimension.
- The judge never sees the generator's self-assessment (see firewalling in verification.md).
- "I verified this thoroughly" / "this is comprehensive" style self-claims are
  **ignored as evidence** — only the artifact's actual content counts.
- A judge that returns all-4s with thin evidence is itself suspect; the orchestrator
  re-runs the judgment with the adversarial prompt when scores look inflated.
