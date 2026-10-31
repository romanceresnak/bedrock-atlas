# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project: Bedrock Atlas

Author: Roman Ceresnak. Commits are authored by Roman only — no AI co-author trailers.

### Decisions
- Source regions: `eu-central-1` (EU cross-region profile) and `us-east-1` (US cross-region profile).
- Models: Claude Haiku 4.5 and Amazon Nova Lite — direct and cross-region calls where available.
- Three IAM roles = three demo teams. Team mapping is a managed table, never derived from client metadata.
- Dataset generation hard cap: USD 25 estimated inference cost.
- Live demo for the jury: fixed prompt, fixed routes, 500 calls/UTC day site-wide, processing region via CloudWatch Logs subscription (`observed`).
- Terraform: modular (`infra/modules/*`), one root (`infra/envs/demo`), S3 backend with native lockfile (`use_lockfile`), bootstrap root creates the state bucket.

### Rules
- Processing region comes from CloudTrail `additionalEventData.inferenceRegion`. Price comes from the **source** region of the call, never the map destination.
- Processing-region evidence levels (shown in UI):
  - `verified` — invocation log and CloudTrail agree on `inferenceRegion` (joined by `requestId` / `parentRequestId`).
  - `observed` — only one of the two sources has `inferenceRegion` so far.
  - `direct` — call without an inference profile; processing region = source region (documented on-demand behavior), labeled "direct invocation (same region)", visually distinct from verified.
  - `unknown` — none of the above.
- Missing data is shown as `Unknown`; unsupported billing modes as `Unpriced` — never zero, never guessed.
- UI label: "Estimated inference cost". v1 supports on-demand text tokens without caching only.
- Map lines are logical region relationships, not network paths; region points are approximate.
- Public exports use an explicit allow-list of fields and anonymized identities. Raw logs never leave the private bucket.
