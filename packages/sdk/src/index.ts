/**
 * @solvinghealth/sdk — Unified SolvingHealth SDK
 *
 * Re-exports all SolvingHealth packages for single-import convenience.
 *
 * Usage:
 *   import { billing, prom, identity } from '@solvinghealth/sdk';
 *
 * Or import individual packages directly:
 *   import { analyzeCodeStacking } from '@solvinghealth/billing';
 *   import { KOOS_JR, createSession } from '@solvinghealth/prom';
 *   import { validateNPI, createComfortCard } from '@solvinghealth/identity';
 *
 * Additional packages (import directly when available):
 *   import { ... } from '@solvinghealth/fhir';
 *   import { ... } from '@solvinghealth/hipaa';
 *   import { ... } from '@solvinghealth/clinical';
 */

export * as billing from '@solvinghealth/billing';
export * as prom from '@solvinghealth/prom';
export * as identity from '@solvinghealth/identity';
