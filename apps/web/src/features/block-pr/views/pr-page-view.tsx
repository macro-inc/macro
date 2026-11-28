import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { useChanges } from '@app/features/changes/changes';
import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { SplitBackButton } from '@components/app/split-layout/components/SplitBackButton';
import Share from '@icon/share.svg';
import Sidebar from '@icon/system/regular/sidebar-simple.svg';
import * as Popover from '@kobalte/core/popover';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, cn } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { PrStatusIcon } from '../component/PrStatus';
import { usePrPage } from '../context/pr-page-context';
import type { PrPageReadModel } from '../context/pr-page-read-model';
import { createScrollHideReveal } from '../primitives/create-scroll-hide-reveal';
import { prLifecycleStatus } from '../primitives/pr-page-state';
import { prHtmlUrl } from '../util/prKey';
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
  PrChecksStatusIcon,
  PrMetadataPills,
  PrStackPill,
  PrStatusFade,
  PrTitleRow,
} from './shared/pr-header';
import type { PrPageViewProps } from './shared/pr-page-view-props';
import { PrCommentForm } from './shared/pr-review';
import { PrChromeRow, PrChromeSpace } from './shared/pr-scroll-chrome';
import { PrTabs } from './shared/pr-tabs';
import { PrDescription, PrTimeline } from './shared/pr-timeline';

export function PrPageView(props: PrPageViewProps) {
  const { page, status, retry } = usePrPage();
  const { layout, review } = useChanges();
  const sidePanel = useSidePanel();
  const scroll = createScrollHideReveal(() =>
    layout.changesVisible() ? 'changes' : 'overview'
  );
  const [expandedHeader, setExpandedHeader] = createSignal<HTMLDivElement>();
  const [compactHeader, setCompactHeader] = createSignal<HTMLDivElement>();
  const [topBarContent, setTopBarContent] = createSignal<HTMLDivElement>();
  const [chrome, setChrome] = createStore({ expanded: 0, compact: 0, top: 0 });
  createResizeObserver(expandedHeader, (_size, element) =>
    setChrome('expanded', element.getBoundingClientRect().height)
  );
  createResizeObserver(compactHeader, (_size, element) =>
    setChrome('compact', element.getBoundingClientRect().height)
  );
  createResizeObserver(topBarContent, (_size, element) =>
    setChrome('top', element.getBoundingClientRect().height)
  );
  const [root, setRoot] = createSignal<HTMLDivElement>();
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
      <PrChromeRow
        animate={scroll.animate()}
        shown={scroll.topBarVisible()}
        class="z-20"
      >
        <div ref={setTopBarContent}>
          <ViewShell.TopBar
            navigation={layout.changesVisible() ? false : undefined}
          >
            <ViewShell.TopBarTitle class="flex-1">
              <Switch>
                <Match when={props.hosted}>
                  <ViewBreadcrumbs.Outlet aria-label={t('prPage.location')} />
                </Match>
                <Match when={true}>
                  <PrStatusIcon
                    status={prLifecycleStatus(page()?.pullRequest)}
                  />
                  <span class="ph-no-capture truncate text-sm font-medium">
                    {name()}
                  </span>
                </Match>
              </Switch>
              {props.fileMenu}
            </ViewShell.TopBarTitle>
            <div class="flex shrink-0 items-center gap-2">
              <HeaderActionGroup label={t('prPage.stateActions')}>
                <Show when={page()}>
                  {(current) => (
                    <AskMacroButton
                      grouped
                      entity={{
                        type: 'pr',
                        id: current().id,
                        url:
                          current().pullRequest.url ??
                          prHtmlUrl(current().prRef),
                      }}
                    />
                  )}
                </Show>
              </HeaderActionGroup>
              <HeaderActionGroup label={t('prPage.share')}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.shareEnabled === false}
                  onClick={props.share}
                >
                  <Share class="size-4" />
                  <span>{t('prPage.share')}</span>
                </Button>
              </HeaderActionGroup>
              <HeaderActionGroup label={t('prPage.details')}>
                <Show
                  when={floatingDetails()}
                  fallback={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('prPage.details')}
                      aria-pressed={sidePanel?.isOpen() ?? false}
                      onClick={() => sidePanel?.toggle()}
                    >
                      <Sidebar class="size-4" />
                    </Button>
                  }
                >
                  <Popover.Root
                    open={width() > 0 && panels.detailsOpen}
                    onOpenChange={(open) => setPanels('detailsOpen', open)}
                    placement="bottom-end"
                    gutter={8}
                  >
                    <Popover.Trigger
                      as={Button}
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('prPage.details')}
                      aria-pressed={panels.detailsOpen}
                    >
                      <Sidebar class="size-4" />
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Content
                        class="menu-surface z-modal w-80 max-w-[calc(100vw-24px)] max-h-[70dvh] overflow-y-auto rounded-xl"
                        aria-label={t('prPage.details')}
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
                      </Popover.Content>
                    </Popover.Portal>
                  </Popover.Root>
                </Show>
              </HeaderActionGroup>
            </div>
          </ViewShell.TopBar>
        </div>
      </PrChromeRow>
      <div class="relative shrink-0">
        <PrChromeRow
          animate={scroll.animate()}
          shown={scroll.scrolled()}
          class="z-10"
        >
          <div
            ref={setCompactHeader}
            class="relative mx-auto flex h-12 w-full shrink-0 items-center gap-2 border-b border-edge-muted pl-[58px] pr-4 @min-[1441px]/pr-page:max-w-[1376px]"
          >
            <div
              class={cn(
                'absolute flex items-center gap-1',
                layout.changesVisible() ? 'left-8' : 'left-2'
              )}
            >
              <Show when={!layout.changesVisible()}>
                <SplitBackButton />
              </Show>
              <PrStatusIcon status={prLifecycleStatus(page()?.pullRequest)} />
            </div>
            <span class="ph-no-capture min-w-0 flex-1 truncate text-sm font-medium">
              {name()}
            </span>
            <Show when={width() > 400 && page()}>
              {(current) => (
                <span class="shrink-0 text-xs text-ink-muted">
                  #{current().prRef.number}
                </span>
              )}
            </Show>
            <PrTabs size="sm" compact={width() <= 400} />
            <Show when={page()}>
              {(current) => (
                <>
                  <PrChecksStatusIcon page={current()} onClick={openChecks} />
                  <PrMergeButton page={current()} compact={width() <= 400} />
                </>
              )}
            </Show>
          </div>
        </PrChromeRow>
        <PrChromeRow animate={scroll.animate()} shown={!scroll.scrolled()}>
          <div
            ref={setExpandedHeader}
            class="relative mx-auto flex w-full shrink-0 flex-col gap-4 border-b border-edge-muted px-6 pb-3 pt-5 @max-[719px]/pr-page:px-4 @min-[1441px]/pr-page:max-w-[1376px]"
          >
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
            <div class="flex items-center justify-between gap-2 pl-[34px]">
              <PrTabs />
              <Show when={layout.changesVisible() && page()}>
                {(current) => <PrMergeButton page={current()} />}
              </Show>
            </div>
          </div>
        </PrChromeRow>
      </div>
      <div class="relative mx-auto flex min-h-0 w-full flex-1 @min-[1441px]/pr-page:max-w-[1376px] @min-[1441px]/pr-page:border-x @min-[1441px]/pr-page:border-edge-muted">
        <SidePanel.Layout headerToggle={false} dockedWidth={360}>
          <Show when={!floatingDetails()}>
            <SidePanel.Section
              id="pr-details"
              title={t('prPage.details')}
              defaultOpen
              render={() => (
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
              )}
            />
          </Show>
          <div class="relative flex size-full min-h-0 min-w-0 flex-col">
            <div
              class="flex min-h-0 flex-1 flex-col"
              classList={{ hidden: !layout.changesVisible() }}
            >
              <PrChangesView
                onScroll={(top) => scroll.onScroll('changes', top)}
                scrollerHandlers={scroll.handlers('changes')}
                scrollCompensation={
                  <PrChromeSpace
                    expandedHeight={chrome.expanded}
                    compactHeight={chrome.compact}
                    topBarHeight={chrome.top}
                    scrolled={scroll.scrolled('changes')}
                    topBarVisible={scroll.topBarVisible('changes')}
                    animate={scroll.animate()}
                  />
                }
                reviewAction={
                  <PrReviewIsland
                    insetRight={width() >= 1162 && layout.treeOpen() ? 360 : 0}
                  />
                }
              />
            </div>
            <div
              class="relative flex min-h-0 flex-1 flex-col"
              classList={{ hidden: layout.changesVisible() }}
            >
              <div
                class="min-h-0 flex-1 overflow-y-auto"
                {...scroll.handlers('overview')}
                onScroll={(event) => {
                  if (event.target === event.currentTarget)
                    scroll.onScroll('overview', event.currentTarget.scrollTop);
                }}
              >
                <main class="px-4 pb-24 @min-[720px]/pr-page:pl-[58px] @min-[720px]/pr-page:pr-6">
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
                <PrChromeSpace
                  expandedHeight={chrome.expanded}
                  compactHeight={chrome.compact}
                  topBarHeight={chrome.top}
                  scrolled={scroll.scrolled('overview')}
                  topBarVisible={scroll.topBarVisible('overview')}
                  animate={scroll.animate()}
                />
              </div>
              <div class="pointer-events-none absolute inset-x-4 bottom-0 max-w-[680px] @min-[720px]/pr-page:left-[58px]">
                <PrReviewIsland />
              </div>
            </div>
          </div>
        </SidePanel.Layout>
      </div>
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
