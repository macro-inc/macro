// Runs last in a called workflow's `path-check`: decides which attested checks
// this run may skip. `PR CI`'s Start accepted each entry of `ATTESTED` for the
// job it names; this accepts it for what the job would run on here.
//
// An entry is `<check>@<digest>`, the digest being over the `path-check`
// outputs that check's job reads, as `cargo x attest` computed them on the
// developer's machine. The same digest over this run's outputs
// (`OUTPUT_<name>`) means the attested run covered what this one selects: the
// same packages, the same conditional steps. Any other entry is dropped and its
// job runs here.

import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

/// The digest of the outputs a job reads. `cargo x attest` computes the same
/// (`xtask_attest`'s `inputs_digest`): sorted `name=value` lines, SHA-256,
/// 16 hex digits.
export function inputsDigest(inputs: Record<string, string>): string {
  const lines = Object.keys(inputs)
    .sort()
    .map((name) => `${name}=${inputs[name]}\n`)
    .join('');
  return createHash('sha256').update(lines).digest('hex').slice(0, 16);
}

/// The checks whose attestation ran on the outputs this run computed.
export function acceptedChecks(
  attested: string[],
  checkInputs: Record<string, string[]>,
  outputs: Record<string, string>,
): string[] {
  return Object.entries(checkInputs)
    .filter(([id, names]) => {
      const read = Object.fromEntries(names.map((name) => [name, outputs[name] ?? '']));
      return attested.includes(`${id}@${inputsDigest(read)}`);
    })
    .map(([id]) => id);
}

export function main() {
  const attested: string[] = JSON.parse(process.env.ATTESTED || '[]');
  const checkInputs: Record<string, string[]> = JSON.parse(process.env.CHECK_INPUTS || '{}');

  const prefix = 'OUTPUT_';
  const outputs = Object.fromEntries(
    Object.entries(process.env)
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, value]) => [name.slice(prefix.length), value ?? '']),
  );

  const accepted = acceptedChecks(attested, checkInputs, outputs);
  for (const id of Object.keys(checkInputs)) {
    const offered = attested.some((entry) => entry.startsWith(`${id}@`));
    if (accepted.includes(id)) {
      console.log(`${id}: attested for this selection; its job is skipped`);
    } else if (offered) {
      console.log(`${id}: attested for a different selection; its job runs here`);
    }
  }

  appendFileSync(process.env.GITHUB_OUTPUT!, `attested=${JSON.stringify(accepted)}\n`);
}
