import { useInfiniteScrollSentinel } from '@app/lib/primitives/infinite-scroll-sentinel';
import { usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import type { DocumentEntity, WithNotification } from '@entity';
import { createSignal } from 'solid-js';
import { ArtifactsList } from '../components/artifacts-list';
import type { ArtifactListSource } from '../context/artifact-source';
import { createArtifactsList } from '../primitives/artifacts-list';

export function ArtifactsListView(props: {
  source: ArtifactListSource;
  onOpen: (
    artifact: WithNotification<DocumentEntity>,
    event: MouseEvent
  ) => void;
}) {
  const view = createArtifactsList(props.source);
  const [sentinel, setSentinel] = createSignal<HTMLDivElement>();
  const loadMore = () => fireAndForget(props.source.loadMore(), 'artifacts');

  useInfiniteScrollSentinel({
    sentinel,
    hasNextPage: () => props.source.hasMore() && !props.source.loadMoreFailed(),
    isFetchingNextPage: props.source.loadingMore,
    fetchNextPage: loadMore,
  });
  usePending('artifacts.list', () => view().t === 'loading');

  return (
    <ArtifactsList
      view={view()}
      hasMore={props.source.hasMore()}
      loadingMore={props.source.loadingMore()}
      loadMoreFailed={props.source.loadMoreFailed()}
      sentinelRef={setSentinel}
      onOpen={props.onOpen}
      onRetry={() => fireAndForget(props.source.retry(), 'artifacts')}
      onLoadMore={loadMore}
    />
  );
}
