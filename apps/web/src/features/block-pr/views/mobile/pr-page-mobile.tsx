import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { useChanges } from '@app/features/changes/changes';
import { t } from '@app/lib/i18n';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { SheetGroup } from '@components/app/mobile/SheetGroup';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import Chat from '@icon/system/regular/chat.svg';
import Copy from '@icon/system/regular/copy.svg';
import Info from '@icon/system/regular/info.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Button, CountBadge } from '@ui';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { PrStatusIcon } from '../../component/PrStatus';
import { usePrPage } from '../../context/pr-page-context';
import { createScrollHideReveal } from '../../primitives/create-scroll-hide-reveal';
import { prLifecycleStatus } from '../../primitives/pr-page-state';
import { PrBranchNames } from '../shared/pr-branch';
import { PrChangesView } from '../shared/pr-changes';
import {
  PrChecksDialog,
  PrChecksList,
  PrDetailsSection,
  PrFileList,
  PrLabelList,
  PrLinkedWorkList,
  PrMergeBox,
  PrReviewerList,
  PrStackList,
} from '../shared/pr-details';
import {
  PrBranchPill,
  PrMetadataPills,
  PrStackPill,
  PrStatusFade,
  PrTitleRow,
} from '../shared/pr-header';
import type { PrPageViewProps } from '../shared/pr-page-view-props';
import { PrCommentForm, PrReviewForm } from '../shared/pr-review';
import { PrChromeRow, PrChromeSpace } from '../shared/pr-scroll-chrome';
import { PrTabs } from '../shared/pr-tabs';
import { PrDescription, PrTimeline } from '../shared/pr-timeline';

type PhoneSheet = 'details' | 'review' | 'branch' | 'files';
type PrPhoneState = {
  sheet?: PhoneSheet;
  checksOpen: boolean;
  checksDialog: boolean;
  checksTrigger?: HTMLButtonElement;
};

export function PrPageMobile(props: PrPageViewProps) {
  const { page, actions, status, retry } = usePrPage();
  const { layout, review, model } = useChanges();
  const [state, setState] = createStore<PrPhoneState>({
    checksOpen: true,
    checksDialog: false,
  });
  const scroll = createScrollHideReveal(() =>
    layout.changesVisible() ? 'changes' : 'overview'
  );
  const [expandedHeader, setExpandedHeader] = createSignal<HTMLDivElement>();
  const [expandedHeight, setExpandedHeight] = createSignal(0);
  createResizeObserver(expandedHeader, (_size, element) =>
    setExpandedHeight(element.getBoundingClientRect().height)
  );
  const closeSheet = (sheet: PhoneSheet, open: boolean) => {
    if (!open && state.sheet === sheet) setState('sheet', undefined);
  };
  const openDetails = () => setState('sheet', 'details');
  const openChecks = (trigger: HTMLButtonElement) =>
    setState({ checksDialog: true, checksTrigger: trigger });
  const openFile = (path: string) => {
    setState('sheet', undefined);
    layout.open();
    review.activate(path);
  };
  const name = () => page()?.pullRequest.name ?? t('prPage.loading');
  const viewedCount = () =>
    model.files().filter((file) => page()?.viewedFiles?.includes(file.path))
      .length;
  return (
    <div class="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden pt-(--mobile-content-inset-top) @container/pr-page">
      <PrStatusFade page={page()} />
      <MobileHeader
        trailing={
          <MobileHeader.Island>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('prPage.details')}
              onClick={openDetails}
            >
              <Info class="size-5" />
            </Button>
          </MobileHeader.Island>
        }
      >
        <MobileHeader.Title
          label={name()}
          icon={
            <PrStatusIcon status={prLifecycleStatus(page()?.pullRequest)} />
          }
        />
        {props.fileMenu}
      </MobileHeader>
      <PrChromeRow animate={scroll.animate()} shown={!scroll.scrolled()}>
        <div ref={setExpandedHeader} class="flex flex-col gap-4 px-3 pt-6 pb-3">
          <Show
            when={page()}
            fallback={
              <ListSkeleton.Root label={t('prPage.loading')}>
                <ListSkeleton.Bar class="h-6 w-4/5" />
              </ListSkeleton.Root>
            }
          >
            {(current) => (
              <>
                <PrTitleRow page={current()} onChecks={openChecks} />
                <div class="pl-7">
                  <PrMetadataPills
                    page={current()}
                    onTask={props.onTask}
                    branch={
                      <PrBranchPill
                        page={current()}
                        onClick={() => setState('sheet', 'branch')}
                        trailing={<Copy class="size-4 shrink-0" />}
                      />
                    }
                    stack={
                      <PrStackPill page={current()} onClick={openDetails} />
                    }
                  />
                </div>
              </>
            )}
          </Show>
        </div>
      </PrChromeRow>
      <div class="relative z-10 shrink-0 px-3 pt-3 pb-2">
        <PrTabs size="lg" fullWidth />
      </div>
      <div
        class="relative flex min-h-0 flex-1 flex-col"
        classList={{ hidden: !layout.changesVisible() }}
      >
        <PrChangesView
          onScroll={(top) => scroll.onScroll('changes', top)}
          scrollerHandlers={scroll.handlers('changes')}
          scrollCompensation={
            <PrChromeSpace
              expandedHeight={expandedHeight()}
              scrolled={scroll.scrolled('changes')}
              animate={scroll.animate()}
            />
          }
        />
      </div>
      <div
        class="relative min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(var(--mobile-content-inset-bottom,0px)+6rem)]"
        classList={{ hidden: layout.changesVisible() }}
        onScroll={(event) => {
          if (event.target === event.currentTarget)
            scroll.onScroll('overview', event.currentTarget.scrollTop);
        }}
        {...scroll.handlers('overview')}
      >
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
            <div class="flex flex-col items-start gap-3 py-8 text-sm text-ink-muted">
              <span>{t('prPage.loadError')}</span>
              <Button size="sm" variant="secondary" onClick={retry}>
                {t('prPage.retry')}
              </Button>
            </div>
          </Match>
          <Match when={true}>
            <ListSkeleton.Root
              label={t('prPage.loading')}
              class="flex flex-col gap-4 py-8"
            >
              <ListSkeleton.Bar class="w-full" />
              <ListSkeleton.Bar class="w-4/5" />
              <ListSkeleton.Bar class="w-3/4" />
            </ListSkeleton.Root>
          </Match>
        </Switch>
        <PrChromeSpace
          expandedHeight={expandedHeight()}
          scrolled={scroll.scrolled('overview')}
          animate={scroll.animate()}
        />
      </div>
      <Show
        when={
          actions.submitReview.available() ||
          (layout.changesVisible() && page()?.viewedFiles)
        }
      >
        <FloatRegion region="accessory">
          <div class="flex justify-end px-(--mobile-chrome-gutter)">
            <div class="island pointer-events-auto flex items-center gap-1 rounded-full p-1">
              <Show when={layout.changesVisible() && page()?.viewedFiles}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setState('sheet', 'files')}
                >
                  {t('prPage.viewedProgress', {
                    count: viewedCount(),
                    total: model.files().length,
                  })}
                </Button>
              </Show>
              <Show when={actions.submitReview.available()}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setState('sheet', 'review')}
                >
                  <Chat class="size-5" />
                  {t('prPage.review')}
                  <Show when={page()?.pendingComments.length}>
                    <CountBadge count={page()?.pendingComments.length ?? 0} />
                  </Show>
                </Button>
              </Show>
            </div>
          </div>
        </FloatRegion>
      </Show>
      <MobileDrawer
        open={state.sheet === 'details'}
        onOpenChange={(open) => closeSheet('details', open)}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content maxHeight={85} aria-label={t('prPage.details')}>
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody class="flex flex-col gap-3 px-3">
              <Show when={page()}>
                {(current) => (
                  <>
                    <Show when={current().stack}>
                      <SheetGroup>
                        <div class="px-3">
                          <PrDetailsSection title={t('prPage.stack')}>
                            <PrStackList page={current()} density="touch" />
                          </PrDetailsSection>
                        </div>
                      </SheetGroup>
                    </Show>
                    <Show
                      when={current().reviewers || current().requestedReviewers}
                    >
                      <SheetGroup>
                        <div class="px-3">
                          <PrDetailsSection title={t('prPage.reviewers')}>
                            <PrReviewerList page={current()} density="touch" />
                          </PrDetailsSection>
                        </div>
                      </SheetGroup>
                    </Show>
                    <SheetGroup>
                      <div class="px-3">
                        <PrDetailsSection
                          title={t('prPage.checks')}
                          open={state.checksOpen}
                          onOpenChange={(open) => setState('checksOpen', open)}
                        >
                          <PrChecksList page={current()} density="touch" />
                        </PrDetailsSection>
                      </div>
                    </SheetGroup>
                    <Show when={current().pullRequest.labels?.length}>
                      <SheetGroup>
                        <div class="px-3">
                          <PrDetailsSection title={t('prPage.labels')}>
                            <PrLabelList page={current()} />
                          </PrDetailsSection>
                        </div>
                      </SheetGroup>
                    </Show>
                    <Show when={current().links?.tasks.length}>
                      <SheetGroup>
                        <div class="px-3">
                          <PrDetailsSection title={t('prPage.linkedWork')}>
                            <PrLinkedWorkList
                              page={current()}
                              density="touch"
                              onTask={props.onTask}
                            />
                          </PrDetailsSection>
                        </div>
                      </SheetGroup>
                    </Show>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={props.shareEnabled === false}
                      onClick={() => {
                        setState('sheet', undefined);
                        props.share();
                      }}
                    >
                      {t('prPage.share')}
                    </Button>
                  </>
                )}
              </Show>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
      <MobileDrawer
        open={state.sheet === 'review'}
        onOpenChange={(open) => closeSheet('review', open)}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content maxHeight={85} aria-label={t('prPage.review')}>
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody>
              <PrReviewForm onSubmit={() => closeSheet('review', false)} />
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
      <MobileDrawer
        open={state.sheet === 'branch'}
        onOpenChange={(open) => closeSheet('branch', open)}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label={t('prPage.branch')}>
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody>
              <Show when={page()}>
                {(current) => <PrBranchNames page={current()} />}
              </Show>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
      <MobileDrawer
        open={state.sheet === 'files'}
        onOpenChange={(open) => closeSheet('files', open)}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label={t('prPage.files')} maxHeight={85}>
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody class="px-4">
              <Show when={page()}>
                {(current) => (
                  <PrFileList
                    page={current()}
                    density="touch"
                    onFile={openFile}
                  />
                )}
              </Show>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
      <Show when={page()}>
        {(current) => (
          <PrChecksDialog
            page={current()}
            density="touch"
            open={state.checksDialog}
            onOpenChange={(open) => setState('checksDialog', open)}
            returnFocus={state.checksTrigger}
          />
        )}
      </Show>
      {props.shareModal}
    </div>
  );
}
