import type { Candidate } from '@macro-inc/brain';

// Add small deterministic rules only after reviewing decisions and feedback.
// undefined delegates to Jev. Creator messages, DMs and mentions always wake.
export function triage(_candidate: Candidate): boolean | undefined {
  return undefined;
}
