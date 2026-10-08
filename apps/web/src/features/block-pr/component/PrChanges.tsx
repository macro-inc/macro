/**
 * The Changes pane on a pull request page: a read-only viewer over the pull
 * request's changes at its current base and head. Review state is kept under
 * `pr:<foreign-entity-id>`, apart from any agent session on the same pull
 * request. Hosts place `ChangesSplit` and `ChangesToggle` inside.
 */

import { createBrowserChangesActions } from '@app/features/changes/browser-host';
import { ChangesProvider } from '@app/features/changes/changes';
import type { ChangesHost } from '@app/features/changes/context/changes-context';
import type { ParentProps } from 'solid-js';
import { createPrChangesSource } from '../data/pr-changes';

export function PrChangesProvider(
  props: ParentProps<{
    foreignEntityId: string;
    pullRequestUrl?: string;
    pullRequestTitle?: string;
    pullRequestChangeCounts?: { additions: number; deletions: number };
  }>
) {
  const scopeKey = () => `pr:${props.foreignEntityId}`;
  const source = createPrChangesSource(() => props.foreignEntityId);
  const host: ChangesHost = {
    scopeKey,
    pullRequestUrl: () => props.pullRequestUrl,
    pullRequestTitle: () => props.pullRequestTitle,
    // Missing GitHub totals never fall back to captured estimates.
    pullRequestChangeCounts: () => props.pullRequestChangeCounts,
    ...createBrowserChangesActions(),
  };
  return (
    <ChangesProvider context={{ source, host }}>
      {props.children}
    </ChangesProvider>
  );
}
