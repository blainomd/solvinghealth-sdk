# SolvingHealth SDK

Free pipes for healthcare AI. The open half of a working stack: these packages run under live products (surgeonvalue.com, clinicalswipe.com, comfortcard.org, hashcare.com) — this is not a spec exercise.

## Packages

| Package | What it does | License |
|---|---|---|
| `@solvinghealth/fhir` | FHIR R4 client, with connector code for Epic and athenahealth (no production EHR integration is live) | Apache 2.0 |
| `@solvinghealth/hipaa` | PHI detection, audit logging, encryption, transport | Apache 2.0 |
| `@solvinghealth/identity` | NPI validation, W3C DID, Remote Online Notarization, WorkOS AuthKit, ABAC, audit logging | Apache 2.0 |
| `@solvinghealth/prom` | Patient-reported outcome measures — instrument structure and scoring, collection, voice PROM, analytics. You load the licensed questionnaire wording (see [NOTICE](NOTICE)) | Apache 2.0 |
| `@solvinghealth/billing` | Medicare billing code registry, NPI mapping, code stacking analysis, claims generation | Proprietary |
| `@solvinghealth/clinical` | Clinical AI harness scaffolding — physician oversight hooks, compliance validation, agentic memory | Proprietary |
| `@solvinghealth/sdk` | Umbrella package | Proprietary |

404 passing tests across 19 test files: `npm install`, then `npx vitest run` from the repo root.

## What is deliberately NOT here

The paid brain: physician-validated clinical prompts, the billing intelligence engine, the attestation schema internals, and the physician review network. Those run as a hosted service — see the live MCP endpoint below. You get the pipes; the judgment layer is where the physicians are.

## Use the hosted harness

The production MCP endpoint (tools for CPT validation, prior-auth drafting, NPI lookup, patient views):

```
https://solvinghealth-mcp-production.up.railway.app/mcp
```

Integration guide: https://harnesshealth.ai/developers — BAA available for covered-entity work.

## Build a condition site in minutes

Fork [solvinghealth-template](https://github.com/blainomd/solvinghealth-template): edit `site.config.ts`, deploy to Vercel, and you have a health vertical with the Sage widget and an MCP connector snippet.

## Contributing / collaboration

Three lanes, in order of commitment:

1. **Red-team the rail.** Try to break the attestation demo at [hashcare.com](https://hashcare.com) (tamper test, verify page, `?h=` deep links) or find holes in these packages' compliance logic. Open an issue with reproduction steps. Confirmed findings get named credit (with your consent) and first access to the design-partner lane.
2. **Extend the pipes.** PRs welcome on the Apache-licensed packages: EHR connectors, FHIR adapters, PROM instruments, identity integrations. Contributions are accepted under Apache 2.0. For a PROM instrument, contribute its structure and scoring only, never its wording. Keep the test bar — nothing merges without tests.
3. **Design partner.** Teams building clinical AI who want the physician review marketplace ([clinicalswipe.com](https://clinicalswipe.com)) or attestation receipts in their loop — start at [harnesshealth.ai/health-systems](https://harnesshealth.ai/health-systems).

## License

Each package has its own LICENSE file ([summary](LICENSE)):

- **Apache 2.0:** `fhir`, `hipaa`, `identity`, `prom`.
- **Proprietary, visible for reference:** `billing`, `clinical`, `sdk`. No license is granted to use them.

`@solvinghealth/prom` ships no questionnaire wording. KOOS JR, HOOS JR, ODI, NDI, QuickDASH and PROMIS-10 belong to their owners: get the wording, and any license the owner requires, from them, then load it with `registerInstrumentWording()`. Its KOOS JR, HOOS JR and PROMIS-10 scores are approximations, not official scores. See [NOTICE](NOTICE).
