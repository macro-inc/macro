import { tryMacroId } from '@core/user/macroId';
import { validate as isEmail } from 'email-validator';
import type { Accessor } from 'solid-js';
import { readContactDirectory } from './directory';
import {
  type ContactWindowHost,
  createContactDirectoryWindow,
} from './directory-query';
import { MAX_CONTACT_LOOKUP, resolveContactDirectory } from './lookup';
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
/** ID-valued facets keep arbitrary persisted IDs outside the lookup batch. Self
 * is an explicit pin, not a claim that the first browse page contains everyone. */
export function createContactIdFilterSource(
  scope: Accessor<{ userId?: string; host?: ContactWindowHost }>,
  selectedIds: Accessor<readonly string[]>,
  enabled: Accessor<boolean>,
  read = readContactDirectory,
  resolve = resolveContactDirectory
) {
  return {
    viewer: () => scope().userId,
    suggestions: createContactDirectoryWindow(scope, read, enabled),
    selection: createContactResolution(
      scope,
      () => {
        const ids = selectedIds().filter((id) => tryMacroId(id.toLowerCase()));
        const viewer = scope().userId;
        if (
          viewer &&
          ids.length < MAX_CONTACT_LOOKUP &&
          !ids.some((id) => id.toLowerCase() === viewer)
        )
          ids.push(viewer);
        return { kind: 'ids', values: ids };
      },
      enabled,
      resolve
    ),
  };
}
export type ContactIdFilterSource = ReturnType<
  typeof createContactIdFilterSource
>;

export type ContactFilterSource = ReturnType<typeof createContactFilterSource>;
export type ContactFilterSourceFactory = (
  selected: Accessor<string[]>,
  enabled: Accessor<boolean>
) => ContactFilterSource;
