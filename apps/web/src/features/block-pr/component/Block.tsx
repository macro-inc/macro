import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { DebouncedNotificationReadMarker } from '@notifications';
import { Scroll } from '@ui';
import { type Accessor, createMemo, Show } from 'solid-js';

import { createPrDiscussionSource } from '../data/prDiscussionSource';
import { usePrForeignEntityQuery } from '../data/queries';
import { PrDocument } from './PrDocument';
import {
  PrDescriptionSkeleton,
  PrMetadataSkeleton,
  PrTimelineSkeleton,
  PrTitleSkeleton,
} from './PrSkeletons';
import { PrSplitHeader } from './PrSplitHeader';
import { PrTimeline } from './PrTimeline';
import { PrSidePanelSections } from './sidepanel/PrSidePanelSections';

export default function PrBlock() {
  const blockId = useBlockId();

  return (
    <Show when={blockId}>
      {(id) => <PrBlockContent foreignEntityId={id()} />}
    </Show>
  );
}

function PrBlockContent(props: { foreignEntityId: string }) {
  const notificationSource = useGlobalNotificationSource();
  const foreignEntityQuery = usePrForeignEntityQuery(
    () => props.foreignEntityId
  );

  const prRef = createMemo(() => foreignEntityQuery.data?.prRef);
  const pullRequest = createMemo(() => foreignEntityQuery.data?.pullRequest);

  const loadFailed = createMemo(
    () => !pullRequest() && !!foreignEntityQuery.error
  );

  // Block-lifetime local Macro discussion (prototype-only, lost on reload).
  const discussionSource = createPrDiscussionSource();

  return (
    <div class="size-full overflow-hidden flex flex-col relative">
      <DebouncedNotificationReadMarker
        notificationSource={notificationSource}
        entity={{ type: 'foreign_entity', id: props.foreignEntityId }}
      />
      <SidePanel.Layout>
        <PrSidePanelSections enrichment={pullRequest} />
        <div class="flex flex-col size-full min-w-0">
          <Show when={prRef()}>
            {(ref) => (
              <PrSplitHeader prRef={ref()} enrichment={pullRequest()} />
            )}
          </Show>

          <Scroll class="flex-1 min-h-0">
            <div class="max-w-3xl mx-auto px-6 pt-12 pb-12 min-w-0">
              <Show
                when={prRef()}
                fallback={
                  <>
                    <PrTitleSkeleton />
                    <div class="spacer h-3" />
                    <PrMetadataSkeleton />
                    <PrDescriptionSkeleton />
                    <PrTimelineSkeleton />
                  </>
                }
              >
                {(ref) => (
                  <PrDocument prRef={ref()} pullRequest={pullRequest()}>
                    <PrLoadErrorBanner loadFailed={loadFailed} />
                    <PrTimeline
                      githubItems={pullRequest()?.comments ?? []}
                      source={discussionSource}
                    />
                  </PrDocument>
                )}
              </Show>
            </div>
          </Scroll>
        </div>
      </SidePanel.Layout>
    </div>
  );
}

function PrLoadErrorBanner(props: { loadFailed: Accessor<boolean> }) {
  return (
    <Show when={props.loadFailed()}>
      <div class="mt-6 px-3 py-2 rounded-lg border border-edge-muted text-xs text-ink-muted">
        Couldn't load this pull request from cached GitHub data.
      </div>
    </Show>
  );
}
