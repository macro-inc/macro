import { formatLocale, t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import { cn, TabSelector } from '@ui';
import { createEffect, createSignal, type JSX, on, onCleanup } from 'solid-js';

export type CallPanelTab = 'chat' | 'participants';

/** Share one mounted panel between the desktop sidebar and phone drawer. */
export function CallChatPanel(props: {
  id: string;
  open: boolean;
  onClose: () => void;
  activeTab: CallPanelTab;
  onTabChange: (tab: CallPanelTab) => void;
  chatAvailable: boolean;
  participantCount: number;
  participants: JSX.Element;
  children: JSX.Element;
  sidebarMount?: HTMLElement;
  overlayMount?: HTMLElement;
  returnFocus?: HTMLButtonElement;
}) {
  const [sidebarBody, setSidebarBody] = createSignal<HTMLDivElement>();
  const [sheetBody, setSheetBody] = createSignal<HTMLDivElement>();
  const sheetOpen = () => isMobile() && props.open;
  const sheetId = () => (isMobile() ? props.id : `${props.id}-sheet`);
  let aside!: HTMLElement;
  let body!: HTMLDivElement;
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    props.onClose();
  };

  createEffect(
    on(
      [
        isMobile,
        sidebarBody,
        sheetBody,
        () => props.sidebarMount,
        () => props.overlayMount,
      ],
      ([mobile, sidebar, sheet, sidebarMount, overlayMount]) => {
        const target = !mobile && sidebarMount ? sidebarMount : overlayMount;
        if (target && aside.parentElement !== target) target.appendChild(aside);
        const content = mobile ? sheet : sidebar;
        if (content && body.parentElement !== content)
          content.appendChild(body);
      }
    )
  );
  onCleanup(() => {
    aside.remove();
    body.remove();
  });

  return (
    <MobileDrawer
      open={sheetOpen()}
      dialogId={sheetId()}
      finalFocusEl={props.returnFocus}
      restoreFocus
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <aside
        ref={aside}
        id={isMobile() ? undefined : props.id}
        aria-label={t('calls.panel')}
        hidden={isMobile() || !props.open}
        class="absolute top-2 right-0 bottom-2 z-20 w-full max-w-90 min-h-0 flex-col overflow-hidden rounded-lg border border-edge-muted bg-surface-2 @min-[800px]/call:static @min-[800px]/call:h-full @min-[800px]/call:max-w-none"
        classList={{ flex: !isMobile() && props.open }}
      >
        <div ref={setSidebarBody} class="flex min-h-0 flex-1 flex-col" />
      </aside>
      <MobileDrawer.Portal forceMount>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          forceMount
          aria-hidden={!sheetOpen()}
          inert={!sheetOpen()}
          targetHeight={80}
          class="data-closed:hidden"
          classList={{ 'duration-0!': !sheetOpen() }}
        >
          <MobileDrawer.Handle />
          <MobileDrawer.Title class="sr-only">
            {t('calls.panel')}
          </MobileDrawer.Title>
          <MobileDrawer.ScrollBody ref={setSheetBody} class="overflow-hidden" />
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
      <div
        ref={body}
        class="flex min-h-0 flex-1 flex-col"
        onKeyDown={closeOnEscape}
      >
        <TabSelector.Root
          value={props.activeTab}
          onChange={(tab) => {
            if (tab === 'chat' || tab === 'participants')
              props.onTabChange(tab);
          }}
          class="flex min-h-0 flex-1 flex-col"
        >
          <div class="flex h-14 shrink-0 items-center px-3">
            <TabSelector>
              <TabSelector.List
                aria-label={t('calls.panel')}
                onKeyDown={closeOnEscape}
              >
                <TabSelector.Tab value="chat" disabled={!props.chatAvailable}>
                  {t('calls.chat')}
                </TabSelector.Tab>
                <TabSelector.Tab value="participants">
                  {t('calls.participants')}
                  <span class="text-ink-muted">
                    {props.participantCount.toLocaleString(formatLocale())}
                  </span>
                </TabSelector.Tab>
              </TabSelector.List>
            </TabSelector>
          </div>
          <TabSelector.Panel
            value="chat"
            forceMount
            hidden={props.activeTab !== 'chat'}
            inert={props.activeTab !== 'chat'}
            class={cn(
              'flex min-h-0 flex-1 flex-col',
              props.activeTab !== 'chat' && 'hidden'
            )}
          >
            {props.children}
          </TabSelector.Panel>
          <TabSelector.Panel
            value="participants"
            forceMount
            hidden={props.activeTab !== 'participants'}
            inert={props.activeTab !== 'participants'}
            class={cn(
              'min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-3',
              props.activeTab !== 'participants' && 'hidden'
            )}
          >
            {props.participants}
          </TabSelector.Panel>
        </TabSelector.Root>
      </div>
    </MobileDrawer>
  );
}
