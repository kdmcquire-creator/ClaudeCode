# The Expectation — v1.1 (post-mortem fixes)

Driven by the Peak 10 hedge-restructure session, where the engine loaded but still
shipped a Design-System `clean:false` verdict relabeled as "cosmetic finish-carpentry."

## Five fixes
1. **Verdict supremacy** — orchestrator may not soften/re-grade a verifier score.
   "cosmetic / finish-carpentry / doesn't touch correctness / minor / only conformance"
   are forbidden moves on a sub-threshold dimension. (verification.md, SKILL.md inv.7)
2. **Blocking verification** — launched-but-unread verifier = FAIL, not PASS. Must
   ingest the returned object before attesting. (verification.md, SKILL.md inv.8)
3. **Artifact identity** — the path/commit verified must be the one that ships; a
   verdict on a different tree is void. (verification.md, SKILL.md inv.9, Step 2)
4. **Verbatim findings** — raw `violations` array pasted into the trail; user judges
   triviality, not the orchestrator. (provenance-template.md, SKILL.md inv.10)
5. **Input-basis blocker** — conflicting sources-of-truth resolved at the gate, not
   discovered mid-build. (patterns.md classifier, SKILL.md Step 0)

## Unchanged
The rubric. It was correct — nothing was enforcing it. v1.1 adds teeth, not a new bar.

## Not a skill defect, but observed in the session (handle in org instructions)
- An agent printed a live site username/password in plaintext and offered to reset it.
  Credentials should never be echoed; route through a manager/env var.
