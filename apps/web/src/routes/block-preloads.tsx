import { useSplitRouter } from '@app/lib/split-router';
import { referenceForLocation } from '@app/lib/split-router/router/preload';
import { decodePanes } from '@app/lib/split-router/routes/codec';
import { previewBlockTarget } from '@components/app/previewTarget';
import { resolveContentLocation } from '@components/app/split-layout/split-router/legacy-route';
import { createMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useBlockPreloader } from '@core/block-preload-context';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { parseInternalAppLink } from '@core/util/macroAppUrl';
import { entityFromElement } from '@entity/core/Root';
import {
  graphqlNetworkBusy,
  subscribeGraphqlNetworkActivity,
} from '@graphql-cache/exchange/network-activity';
import { queryClient } from '@queries/client';
import {
  createEffect,
  on,
  onCleanup,
  onMount,
  type ParentProps,
} from 'solid-js';
import { LIKELY_NEXT_VIEWS } from './lazy-route-views';

/** Yield a paint, then request idle work; no readiness decision comes from telemetry. */
export function scheduleBlockWarmup(run: () => void): () => void {
  let idle: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if ('requestIdleCallback' in window)
        idle = window.requestIdleCallback(run);
      else timer = setTimeout(run, 1000);
    });
  });
  return () => {
    cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timer !== undefined) clearTimeout(timer);
  };
}

export function blockWarmupBusy(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection;
  return (
    document.visibilityState !== 'visible' ||
    connection?.saveData === true ||
    graphqlNetworkBusy() ||
    queryClient.isFetching() > 0 ||
    queryClient.isMutating() > 0
  );
}

/** App-lifetime DOM intent adapter; the router owns destinations and data preload. */
export function BlockPreloads(props: ParentProps) {
  const preloader = useBlockPreloader();
  const router = useSplitRouter();
  const resolveMention = createMacroMentionLinkResolver(router.routes);
  createEffect(() =>
    preloader.pause(
      !router.ready() ||
        router.panes().some((pane) => router.pending(pane) !== undefined)
    )
  );
  createEffect(
    on(
      () => router.panes().map((pane) => router.entry(pane)?.location),
      (locations) => {
        for (const location of locations) {
          if (!location) continue;
          const reference = referenceForLocation(router.routes, location);
          if (reference)
            preloader.remember(fileTypeToResolvedBlockName(reference.type));
        }
      }
    )
  );
  const resume = () => preloader.resume();
  const unsubscribe = queryClient.getQueryCache().subscribe(resume);
  const unsubscribeMutations = queryClient.getMutationCache().subscribe(resume);
  const unsubscribeGraphql = subscribeGraphqlNetworkActivity(resume);

  const intent = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('a[href], [data-entity]');
    if (!target) return;
    if (
      event instanceof MouseEvent &&
      event.relatedTarget instanceof Node &&
      target.contains(event.relatedTarget)
    )
      return;
    const entity = entityFromElement(target);
    if (
      entity &&
      (entity.type === 'document' ||
        entity.type === 'email' ||
        entity.type === 'channel' ||
        entity.type === 'channel_message' ||
        entity.type === 'channel_thread')
    ) {
      const block = previewBlockTarget(entity);
      const location = resolveContentLocation(router.routes, {
        type: block.blockType,
        id: block.blockId,
        params: block.params,
      });
      fireAndForget(router.preload(location, 'hover'), 'route-preload-intent');
      return;
    }
    const href = target.getAttribute('href');
    const mention = href && resolveMention(href);
    if (mention) {
      const location = resolveContentLocation(router.routes, {
        type: fileTypeToResolvedBlockName(mention.block),
        id: mention.id,
        params: mention.params,
      });
      fireAndForget(router.preload(location, 'hover'), 'route-preload-intent');
      return;
    }
    const link = href && parseInternalAppLink(href);
    if (!link) return;
    const location = decodePanes(router.routes, {
      path: link.path,
      search: link.query,
      hash: '',
    }).panes.at(-1)?.entry.location;
    if (location)
      fireAndForget(router.preload(location, 'hover'), 'route-preload-intent');
  };
  onMount(() => {
    document.addEventListener('pointerover', intent, true);
    document.addEventListener('focusin', intent, true);
    document.addEventListener('pointerdown', intent, true);
    document.addEventListener('visibilitychange', resume);
    preloader.start(LIKELY_NEXT_VIEWS);
  });
  onCleanup(() => {
    preloader.stop();
    unsubscribe();
    unsubscribeMutations();
    unsubscribeGraphql();
    document.removeEventListener('pointerover', intent, true);
    document.removeEventListener('focusin', intent, true);
    document.removeEventListener('pointerdown', intent, true);
    document.removeEventListener('visibilitychange', resume);
  });
  return props.children;
}
