# SolvingHealth SDK

Free pipes for healthcare AI. The open half of a working stack: these packages run under live products (surgeonvalue.com, clinicalswipe.com, comfortcard.org, hashcare.com) — this is not a spec exercise.

## Packages

| Package | What it does |
|---|---|
| `@solvinghealth/billing` | Medicare billing code registry, NPI mapping, code stacking analysis, claims generation |
| `@solvinghealth/clinical` | Clinical AI harness scaffolding — physician oversight hooks, compliance validation, agentic memory |
| `@solvinghealth/fhir` | FHIR R4 client with EHR connectors (Epic, Cerner, athenahealth) |
| `@solvinghealth/hipaa` | PHI detection, audit logging, encryption, transport |
| `@solvinghealth/identity` | NPI validation, W3C DID, Remote Online Notarization, WorkOS AuthKit, ABAC, audit logging |
| `@solvinghealth/prom` | Patient-reported outcome measures — instruments, collection, voice PROM, analytics |
| `@solvinghealth/sdk` | Umbrella package |

398 passing tests across 18 test files. `npm install`, `npx turbo test`.

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
2. **Extend the pipes.** PRs welcome here: EHR connectors, FHIR adapters, PROM instruments, identity integrations. Keep the test bar — nothing merges without tests.
3. **Design partner.** Teams building clinical AI who want the physician review marketplace ([clinicalswipe.com](https://clinicalswipe.com)) or attestation receipts in their loop — start at [harnesshealth.ai/health-systems](https://harnesshealth.ai/health-systems).

## License

License declaration in progress. The repository is public by design; until a LICENSE file lands, open an issue if your use case needs clarity today.
