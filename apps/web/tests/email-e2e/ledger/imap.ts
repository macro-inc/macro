import type { Test } from './evidence';
import {
  IMAP_CONFIRMATION,
  IMAP_EVIDENCE,
  IMAP_JOURNEY,
  IMAP_OPERATIONS,
} from './manifest/imap';
import type { Viewport } from './manifest/types';

export type ImapEvidence = {
  viewport: Viewport;
  states: string[];
  operations: string[];
};

/** Only the successful attempt of the named real-mail journey can certify its layout. */
export function imapEvidence(tests: readonly Test[]): ImapEvidence[] {
  const observations: ImapEvidence[] = [];
  for (const [layout, viewport] of [
    ['desktop', 'desktop'],
    ['mobile', 'phone'],
  ] as const) {
    const test = tests.find(
      (test) =>
        test.file === 'full-stack-imap.spec.ts' &&
        test.title === `${layout} IMAP inbox › ${IMAP_JOURNEY}` &&
        !test.knownBug &&
        (test.status === 'expected' || test.status === 'flaky')
    );
    const passed = test?.results.findLast(
      (result) => result.status === 'passed'
    );
    const attachment = passed?.attachments?.find(
      (a) => a.name === IMAP_EVIDENCE && a.contentType === 'application/json'
    );
    if (!attachment?.body) continue;
    const data = JSON.parse(
      Buffer.from(attachment.body, 'base64').toString('utf8')
    );
    if (!Array.isArray(data.states) || !Array.isArray(data.operations))
      continue;
    observations.push({
      viewport,
      states: [IMAP_CONFIRMATION.connect, IMAP_CONFIRMATION.reconnect].filter(
        (state) => data.states.includes(state)
      ),
      operations: IMAP_OPERATIONS.flatMap((operation) =>
        data.operations.filter((id: unknown) => id === operation)
      ),
    });
  }
  return observations;
}

export function missingImapEvidence(
  observations: readonly ImapEvidence[]
): string[] {
  const missing: string[] = [];
  for (const layout of ['desktop', 'phone'] as const) {
    const observed = observations.find((entry) => entry.viewport === layout);
    for (const state of [
      IMAP_CONFIRMATION.connect,
      IMAP_CONFIRMATION.reconnect,
    ]) {
      if (!observed?.states.includes(state))
        missing.push(`IMAP ${layout}: missing visible "${state}" confirmation`);
    }
    for (const operation of IMAP_OPERATIONS) {
      if (!observed?.operations.includes(operation))
        missing.push(
          `IMAP ${layout}: no successful browser request to ${operation}`
        );
    }
  }
  return missing;
}
