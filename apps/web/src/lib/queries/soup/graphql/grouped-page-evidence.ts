import { fireAndForget } from '@core/util/fireAndForget';
import type { OperationResult } from '@urql/core';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { normalizedCacheResultMetadata } from '../../../graphql-cache/exchange/normalized-cache-exchange';
import type {
  GroupSoupQuery,
  GroupSoupQueryVariables,
} from '../../../service-clients/service-storage/graphql/generated/graphql';

import { soupItemKey } from './reconciliation';

type Evidence = {
  scope: string;
  data: GroupSoupQuery;
  persisted: boolean;
  network: boolean;
};

/** Preserve server membership separately from later normalized field/link writes. */
export function createGroupedPageEvidence(scope: Accessor<string>) {
  const [pages, setPages] = createSignal<ReadonlyMap<number, Evidence>>(
    new Map()
  );
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  async function acknowledge(
    index: number,
    page: Evidence,
    persistence: Promise<unknown>
  ) {
    try {
      const revision = await persistence;
      if (
        revision === undefined ||
        disposed ||
        scope() !== page.scope ||
        pages().get(index) !== page
      )
        return;
      setPages((previous) =>
        new Map(previous).set(index, { ...page, persisted: true })
      );
    } catch {
      // A failed cache write cannot supersede the usable server response.
    }
  }

  return {
    accept(
      result: OperationResult<GroupSoupQuery, GroupSoupQueryVariables>,
      index: number,
      requestScope: string
    ) {
      if (
        disposed ||
        requestScope !== scope() ||
        !result.data ||
        result.hasNext ||
        result.error
      )
        return;
      const metadata = normalizedCacheResultMetadata(result);
      const previous = pages().get(index);
      if (
        metadata?.source !== 'live-network' &&
        previous?.scope === requestScope &&
        previous.data.user.id === result.data.user.id
      )
        return;
      const persistence =
        metadata?.source === 'live-network' ? metadata.persistence : undefined;
      const page = {
        scope: requestScope,
        data: result.data,
        persisted: !persistence,
        network: metadata?.source === 'live-network',
      };
      setPages((previous) => new Map(previous).set(index, page));
      if (persistence)
        fireAndForget(
          acknowledge(index, page, persistence),
          'soup-grouped-evidence'
        );
    },
    data: () => {
      const current = [...pages().entries()].filter(
        ([, page]) => page.scope === scope()
      );
      if (!current.length || current.some(([, page]) => !page.persisted))
        return undefined;
      return current
        .sort(([left], [right]) => left - right)
        .map(([, page]) => page.data);
    },
    // A restored page can combine old bin membership with newer normalized
    // properties. Only raw network rows prove complete *previous* membership.
    untrustedKeys: () =>
      new Set(
        [...pages().values()]
          .filter((page) => page.scope === scope() && !page.network)
          .flatMap((page) =>
            page.data.user.groupSoup.bins.flatMap((bin) =>
              bin.items.map(soupItemKey)
            )
          )
      ),
  };
}
