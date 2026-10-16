# Capability Extraction Protocol

The reference fork is research input. The output is a tested specification and, when justified, an independently reviewable implementation.

## Required sequence

1. **Pin the source.** Record repository, immutable commit, file paths/blob SHAs, and version reviewed.
2. **Understand behaviour.** Read README/architecture notes, tests, package manifests and lockfiles, relevant source, license files, third-party notices, and stated limitations.
3. **Isolate one capability.** Describe inputs, outputs, user value, and expected behaviour without taking the upstream implementation as the design.
4. **Specify it.** Define invariants, API/error contract, limits, threat assumptions, acceptance tests, and non-goals.
5. **Choose deliberately:** reuse only with compatible terms; adapt while tracking origin; reimplement against a written behaviour spec when justified; or reject.
6. **Implement in isolation.** Keep vendors behind adapters and avoid dependencies unless they reduce risk or complexity.
7. **Verify.** Run normal, boundary, corruption, compatibility, and security tests; use independent verification where feasible.
8. **Record results.** Update source register/ADR with provenance, commands, outcomes, known gaps, and next gate.
9. **Integrate only after proof.** Application integration needs its own workflow and tests.

## Mandatory hold/reject gates

- Unclear or incompatible license/provenance.
- Unreviewed dependency or asset with material risk.
- Hidden vendor requirement without an exit path.
- Undefined data-loss, privacy, permission, or failure behavior.
- Explicit alpha status for a critical workflow without independent validation.
- No testable acceptance criterion.

## Evidence-based scorecard

Score each dimension 0–3 and attach evidence; no total can bypass a mandatory gate.

| Dimension | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| User value | unclear | speculative | recurring need | observed costly problem |
| Reusability | one-off | possible | multiple workflows | stable domain-independent contract |
| Reference evidence | none | docs only | source/tests reviewed | behaviour independently exercised |
| Independence | locked in | costly exit | adapter possible | standards-based/replacable |
| Durability | unknown | weak recovery | bounded and tested | interruption/recovery verified |
| License/provenance | unclear | gaps | reviewed | clear and recorded |
