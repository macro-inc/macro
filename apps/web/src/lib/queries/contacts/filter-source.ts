import { validate as isEmail } from 'email-validator';
import type { Accessor } from 'solid-js';
import { readContactDirectory } from './directory';
import {
  type ContactWindowHost,
  createContactDirectoryWindow,
} from './directory-query';
import { resolveContactDirectory } from './lookup';
import { createContactResolution } from './lookup-query';

/** Filters need bounded suggestions plus independent labels for persisted values. */
export function createContactFilterSource(
  scope: Accessor<{ userId?: string; host?: ContactWindowHost }>,
  selectedEmails: Accessor<string[]>,
  enabled: Accessor<boolean>,
  read = readContactDirectory,
  resolve = resolveContactDirectory
) {
  return {
    suggestions: createContactDirectoryWindow(scope, read, enabled),
    selection: createContactResolution(
      scope,
      () => ({
        kind: 'emails',
        values: selectedEmails().filter((email) => isEmail(email.trim())),
      }),
      enabled,
      resolve
    ),
  };
}
export type ContactFilterSource = ReturnType<typeof createContactFilterSource>;
export type ContactFilterSourceFactory = (
  selected: Accessor<string[]>,
  enabled: Accessor<boolean>
) => ContactFilterSource;
