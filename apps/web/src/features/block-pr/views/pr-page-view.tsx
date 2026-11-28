import { ViewBreadcrumbs } from '@app/components/view-shell';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { useChanges } from '@app/features/changes/changes';
import { t } from '@app/lib/i18n';
import { useSidePanel } from '@components/app/side-panel';
import * as Popover from '@kobalte/core/popover';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { PrStatusIcon } from '../component/PrStatus';
import { usePrPage } from '../context/pr-page-context';
import type { PrPageReadModel } from '../context/pr-page-read-model';
import { prLifecycleStatus } from '../primitives/pr-page-state';
import { PrPageTopBar } from './pr-page-top-bar';
import { PrReviewIsland } from './pr-review-island';
import { PrBranchPopover } from './shared/pr-branch';
import { PrChangesView } from './shared/pr-changes';
import {
  PrChecksDialog,
  PrDetailsColumn,
  PrMergeBox,
  PrMergeButton,
  PrStackList,
} from './shared/pr-details';
import {
  PrMetadataPills,
  PrStackPill,
  PrStatusFade,
  PrTitleRow,
} from './shared/pr-header';
import { PrPageContent } from './shared/pr-page-content';
import type { PrPageViewProps } from './shared/pr-page-view-props';
import { PrCommentForm } from './shared/pr-review';
import { PrTabs } from './shared/pr-tabs';
import { PrDescription, PrTimeline } from './shared/pr-timeline';

export function PrPageView(props: PrPageViewProps) {
  const { page, status, retry } = usePrPage();
  const { layout, review } = useChanges();
  const sidePanel = useSidePanel();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const [width, setWidth] = createSignal(0);
  createResizeObserver(root, (size) => setWidth(size.width));
  const floatingDetails = () => width() < 1224 || layout.changesVisible();
  const [panels, setPanels] = createStore<{
    sectionOpen: boolean;
    dialogOpen: boolean;
    detailsOpen: boolean;
    trigger?: HTMLButtonElement;
  }>({ sectionOpen: true, dialogOpen: false, detailsOpen: false });
  const openChecks = (trigger: HTMLButtonElement) =>
    setPanels({ dialogOpen: true, trigger });
  const openFile = (path: string) => {
    if (floatingDetails()) setPanels('detailsOpen', false);
    layout.open();
    review.activate(path);
  };
  const name = () => page()?.pullRequest.name ?? t('prPage.loading');
  const dockedDetails = () => !floatingDetails() && sidePanel?.isOpen();
  const islandInset = () => {
    if (dockedDetails()) return 360;
    if (layout.changesVisible() && width() >= 1162 && layout.treeOpen())
      return 360;
    return 0;
  };
  return (
    <div
      ref={setRoot}
      class="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container/pr-page"
    >
      <PrStatusFade page={page()} />
      <Show when={props.hosted && page()}>
        {(current) => (
          <ViewBreadcrumbs.Item
            value={`pr:${current().id}`}
            order={1}
            metadata={{ type: 'pr', id: current().id }}
          >
            {(item) => (
              <ViewBreadcrumbs.Button
                isActive={item.isActive()}
                onClick={item.onSelect}
                tooltip={name()}
              >
                <PrStatusIcon
                  status={prLifecycleStatus(current().pullRequest)}
                />
                {name()}
              </ViewBreadcrumbs.Button>
            )}
          </ViewBreadcrumbs.Item>
        )}
      </Show>

      <PrPageTopBar
        {...props}
        page={page()}
        changesVisible={layout.changesVisible()}
        floatingDetails={floatingDetails()}
        detailsOpen={width() > 0 && panels.detailsOpen}
        onDetailsOpenChange={(open) => setPanels('detailsOpen', open)}
        checksOpen={panels.sectionOpen}
        onChecksOpenChange={(open) => setPanels('sectionOpen', open)}
        onFile={openFile}
      />
      <PrPageContent
        tab={layout.changesVisible() ? 'changes' : 'overview'}
        scrollerRef={setScroller}
        header={
          <>
            <PrStatusFade page={page()} />
            <div class="relative flex flex-col gap-4 px-6 pb-3 pt-5 @max-[719px]/pr-page:px-4">
              <Show
                when={page()}
                fallback={
                  <ListSkeleton.Root label={t('prPage.loading')}>
                    <ListSkeleton.Bar class="h-6 w-3/4" />
                    <div class="flex gap-2 py-4">
                      <ListSkeleton.Bar class="w-28" />
                      <ListSkeleton.Bar class="w-40" />
                    </div>
                  </ListSkeleton.Root>
                }
              >
                {(current) => (
                  <>
                    <PrTitleRow
                      page={current()}
                      onChecks={openChecks}
                      stack={<PrStackPopover page={current()} />}
                    />
                    <div class="pl-[34px]">
                      <PrMetadataPills
                        page={current()}
                        branch={<PrBranchPopover page={current()} />}
                        onTask={props.onTask}
                      />
                    </div>
                  </>
                )}
              </Show>
            </div>
          </>
        }
        tabsClass="border-b border-edge-muted px-4 py-3 @min-[720px]/pr-page:pl-[58px] @min-[720px]/pr-page:pr-6"
        tabs={
          <div class="flex items-center justify-between gap-2">
            <PrTabs />
            <Show when={layout.changesVisible() && page()}>
              {(current) => <PrMergeButton page={current()} />}
            </Show>
          </div>
        }
      >
        <div classList={{ hidden: !layout.changesVisible() }}>
          <PrChangesView scroller={scroller()} />
        </div>
        <div
          class="flex min-w-0"
          classList={{ hidden: layout.changesVisible() }}
        >
          <main class="min-w-0 flex-1 px-4 pb-24 @min-[720px]/pr-page:pl-[58px] @min-[720px]/pr-page:pr-6">
            <div class="w-full max-w-[680px]">
              <Switch>
                <Match when={page()}>
                  {(current) => (
                    <>
                      <PrDescription page={current()} />
                      <PrTimeline page={current()} onFile={openFile} />
                      <PrCommentForm />
                      <PrMergeBox page={current()} />
                    </>
                  )}
                </Match>
                <Match when={status?.() === 'error'}>
                  <div class="flex flex-col items-start gap-3 py-10 text-sm text-ink-muted">
                    <span>{t('prPage.loadError')}</span>
                    <Button size="sm" variant="secondary" onClick={retry}>
                      {t('prPage.retry')}
                    </Button>
                  </div>
                </Match>
                <Match when={true}>
                  <ListSkeleton.Root
                    label={t('prPage.loading')}
                    class="flex flex-col gap-5 py-8"
                  >
                    <ListSkeleton.Bar class="w-1/3" />
                    <ListSkeleton.Bar class="w-full" />
                    <ListSkeleton.Bar class="w-4/5" />
                    <ListSkeleton.Bar class="w-2/3" />
                  </ListSkeleton.Root>
                </Match>
              </Switch>
            </div>
          </main>
          <Show when={dockedDetails()}>
            <aside
              aria-label={t('prPage.details')}
              class="sticky flex w-[360px] shrink-0 flex-col self-start overflow-y-auto border-l border-edge-muted"
              style={{
                top: 'var(--pr-tabs-height)',
                'max-height':
                  'calc(var(--pr-page-height) - var(--pr-tabs-height))',
              }}
            >
              <Show when={page()}>
                {(current) => (
                  <PrDetailsColumn
                    page={current()}
                    onFile={openFile}
                    onTask={props.onTask}
                    checksOpen={panels.sectionOpen}
                    onChecksOpenChange={(open) =>
                      setPanels('sectionOpen', open)
                    }
                  />
                )}
              </Show>
            </aside>
          </Show>
        </div>
      </PrPageContent>
      <PrReviewIsland insetRight={islandInset()} />
      <Show when={page()}>
        {(current) => (
          <PrChecksDialog
            page={current()}
            open={panels.dialogOpen}
            onOpenChange={(open) => setPanels('dialogOpen', open)}
            returnFocus={panels.trigger}
          />
        )}
      </Show>
      {props.shareModal}
    </div>
  );
}

function PrStackPopover(props: { page: PrPageReadModel }) {
  return (
    <Popover.Root placement="bottom-end">
      <Popover.Trigger as={PrStackPill} page={props.page} />
      <Popover.Portal>
        <Popover.Content
          class="menu-surface z-modal min-w-64 max-w-[min(400px,90vw)] rounded-xl p-3"
          aria-label={t('prPage.stack')}
        >
          <PrStackList page={props.page} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
