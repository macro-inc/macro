import './MobileSettingsSheet.css';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import type { SettingsTab } from '@core/constant/SettingsState';
import type { SettingsTabGroup } from '@core/constant/settingsTabsConfig';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import CaretRightIcon from '@phosphor/caret-right.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import SignOutIcon from '@phosphor/sign-out.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { ErrorBoundary, For, type JSX, Show, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SettingsSheetContext } from './primitives';

type MobileSettingsSheetProps = {
  open: boolean;
  page?: SettingsTab;
  groups: SettingsTabGroup[];
  name: string;
  email: string;
  avatar: JSX.Element;
  onClose: () => void;
  onNavigate: (page?: SettingsTab) => void;
  onLogout: () => void;
  renderPage: (page: SettingsTab) => JSX.Element;
};

/** Mobile presentation; account data and settings actions are supplied by the host. */
export function MobileSettingsSheet(props: MobileSettingsSheetProps) {
  let mainScrollTop = 0;
  let scrollRef: HTMLDivElement | undefined;
  let headingRef: HTMLHeadingElement | undefined;

  const pageLabel = () =>
    props.groups
      .flatMap((group) => group.items)
      .find((item) => item.tab === props.page)?.label ??
    props.page ??
    'Settings';

  const navigate = (page?: SettingsTab) => {
    if (!props.page) mainScrollTop = scrollRef?.scrollTop ?? 0;
    props.onNavigate(page);
    queueMicrotask(() => headingRef?.focus({ preventScroll: true }));
  };

  return (
    <MobileDrawer
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          mainScrollTop = 0;
          props.onClose();
        }
      }}
      side="bottom"
      closeOnOutsidePointerStrategy="pointerdown"
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label="Settings"
          targetHeight={94}
          maxHeight={94}
          class="mobile-settings-sheet overflow-hidden [--mobile-content-inset-top:0px] [--mobile-content-inset-bottom:0px]"
        >
          <MobileDrawer.Handle class="pb-1" />
          <header class="grid shrink-0 grid-cols-[44px_1fr_44px] items-center gap-2 px-5 pb-3 pt-1">
            <Show when={props.page} fallback={<span />}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back to settings"
                class="size-11 rounded-full bg-ink/6"
                onClick={() => navigate()}
              >
                <CaretLeftIcon class="size-5" />
              </Button>
            </Show>
            <h1
              ref={headingRef}
              tabIndex={-1}
              class="text-center text-lg font-semibold text-ink outline-none"
            >
              {pageLabel()}
            </h1>
            <MobileDrawer.Close
              as={Button}
              variant="ghost"
              size="icon-sm"
              aria-label="Close settings"
              class="size-11 rounded-full bg-ink/6"
            >
              <XIcon class="size-5" />
            </MobileDrawer.Close>
          </header>
          <Show
            when={props.page}
            keyed
            fallback={
              <MobileDrawer.ScrollBody
                ref={(el: HTMLDivElement) => {
                  scrollRef = el;
                  queueMicrotask(() => {
                    el.scrollTop = mainScrollTop;
                  });
                }}
                class="mobile-settings-home"
              >
                <button
                  type="button"
                  aria-label="Edit profile"
                  onClick={() => navigate('Account')}
                  class="mx-6 mb-7 flex shrink-0 flex-col items-center rounded-3xl px-4 pb-3 pt-2 text-center active:bg-ink/3"
                >
                  <span class="relative mb-3 block size-20">
                    <span class="flex size-20 items-center justify-center overflow-hidden rounded-full bg-ink/8 text-2xl font-medium">
                      {props.avatar}
                    </span>
                    <span class="absolute! -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border-2 border-menu-glass bg-menu text-ink">
                      <PencilIcon class="size-3.5" />
                    </span>
                  </span>
                  <span class="ph-no-capture max-w-full truncate text-xl font-semibold text-ink">
                    {props.name}
                  </span>
                  <span class="ph-no-capture mt-1 max-w-full truncate text-sm text-ink-muted">
                    {props.email}
                  </span>
                </button>
                <div class="flex flex-col gap-6 px-3">
                  <For each={props.groups}>
                    {(group) => (
                      <section>
                        <h2 class="px-4 pb-2 text-sm font-medium text-ink-muted">
                          {group.label}
                        </h2>
                        <div class="overflow-hidden rounded-[26px] bg-ink/5 p-1">
                          <For each={group.items}>
                            {(item, index) => (
                              <>
                                <Show when={index() > 0}>
                                  <div class="ml-12 mr-3 h-px bg-ink/6" />
                                </Show>
                                <MobileDrawer.Item
                                  onClick={() => navigate(item.tab)}
                                  class="min-h-13 gap-3.5 px-3.5 text-base"
                                >
                                  <Dynamic
                                    component={item.icon}
                                    class="size-5 shrink-0"
                                  />
                                  <span class="min-w-0 flex-1 text-left">
                                    {item.label}
                                  </span>
                                  <CaretRightIcon class="size-4 shrink-0 text-ink-extra-muted" />
                                </MobileDrawer.Item>
                              </>
                            )}
                          </For>
                        </div>
                      </section>
                    )}
                  </For>
                  <div class="mb-3 rounded-[26px] bg-ink/5 p-1">
                    <MobileDrawer.Item
                      onClick={props.onLogout}
                      class="min-h-13 gap-3.5 px-3.5 text-base text-failure"
                    >
                      <SignOutIcon class="size-5" />
                      Log out
                    </MobileDrawer.Item>
                  </div>
                </div>
              </MobileDrawer.ScrollBody>
            }
          >
            {(page) => (
              <SettingsSheetContext.Provider value={true}>
                <div
                  class="mobile-settings-detail relative min-h-0 flex-1"
                  data-settings-detail={page}
                >
                  <ErrorBoundary
                    fallback={(_error, reset) => (
                      <div class="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                        <p class="text-sm text-ink-muted">
                          This settings page couldn’t load.
                        </p>
                        <Button onClick={reset}>Try again</Button>
                      </div>
                    )}
                  >
                    <Suspense
                      fallback={
                        <div
                          role="status"
                          class="p-8 text-center text-sm text-ink-muted"
                        >
                          Loading settings…
                        </div>
                      }
                    >
                      {props.renderPage(page)}
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </SettingsSheetContext.Provider>
            )}
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
