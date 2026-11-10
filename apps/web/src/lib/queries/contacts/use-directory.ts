import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { tryMacroId } from '@core/user/macroId';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { type Accessor, createMemo } from 'solid-js';
import { useQueryAccount } from '../auth/use-query-account';
import { createContactDirectoryWindow } from './directory-query';
import {
  type ContactFilterSourceFactory,
  createContactFilterSource,
  createContactIdFilterSource,
} from './filter-source';
import { MAX_CONTACT_LOOKUP } from './lookup';
import { createContactResolution } from './lookup-query';

/** Production account/cache composition, separate from the bounded window. */
export function useContactDirectoryScope() {
  const account = useQueryAccount();
  const flag = useFeatureFlag(enableGraphqlSoup);
  return createMemo(() => {
    flag();
    return {
      userId: account()?.userId,
      host: getGraphqlSoupCacheHost(),
    };
  });
}

export const useContactFilterSource: ContactFilterSourceFactory = (
  selected,
  enabled
) => createContactFilterSource(useContactDirectoryScope(), selected, enabled);

export function useContactIdFilterSource(
  selected: Accessor<readonly string[]>,
  enabled: Accessor<boolean>
) {
  return createContactIdFilterSource(
    useContactDirectoryScope(),
    selected,
    enabled
  );
}

/** Explicit selections and self stay separate from bounded suggestion windows. */
export function usePinnedContactUsers(
  selected: Accessor<Iterable<string>>,
  enabled: Accessor<boolean>
) {
  const scope = useContactDirectoryScope();
  const input = createMemo(() => {
    const values: string[] = [];
    for (const id of selected()) {
      if (!tryMacroId(id)) continue;
      values.push(id);
      if (values.length > MAX_CONTACT_LOOKUP) break;
    }
    const viewer = scope().userId;
    const self = viewer && !values.includes(viewer) ? [viewer] : [];
    if (values.length < MAX_CONTACT_LOOKUP) {
      values.push(...self);
      return { values, self: [] };
    }
    return { values, self };
  });
  const resolution = createContactResolution(
    scope,
    () => ({ kind: 'ids', values: input().values }),
    enabled
  );
  const self = createContactResolution(
    scope,
    () => ({ kind: 'ids', values: input().self }),
    enabled
  );
  return createMemo(() => [
    ...(resolution.data()?.users ?? []),
    ...(self.data()?.users ?? []),
  ]);
}

export function useContactDirectoryWindow() {
  return createContactDirectoryWindow(useContactDirectoryScope());
}
