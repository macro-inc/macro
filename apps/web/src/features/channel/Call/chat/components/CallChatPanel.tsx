import { formatLocale, t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isMobile } from '@core/mobile/isMobile';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn, Tabs } from '@ui';
import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';

export type CallPanelTab = 'chat' | 'participants' | 'work';

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
  /** Present while someone in the call has work the viewer can see. */
  work?: JSX.Element;
  /** Marks the Work tab while the viewer is elsewhere. */
  workDot?: boolean;
  children: JSX.Element;
  sidebarMount?: HTMLElement;
  overlayMount?: HTMLElement;
  returnFocus?: HTMLButtonElement;
  /** Names the discussion tab, for a discussion that isn't the call's chat. */
  discussionLabel?: string;
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
        inert={isMobile() || !props.open}
        class="absolute top-2 right-0 bottom-2 z-20 w-full max-w-90 min-h-0 flex-col overflow-hidden rounded-2xl border border-edge-muted bg-surface-2 transition-[opacity,translate,display] transition-discrete duration-200 ease-out starting:opacity-0 starting:translate-x-3 motion-reduce:transition-none @min-[800px]/call:static @min-[800px]/call:h-full @min-[800px]/call:max-w-none"
        classList={{
          flex: !isMobile() && props.open,
          'opacity-0 translate-x-3 pointer-events-none': !props.open,
        }}
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
          class="data-closed:hidden motion-reduce:duration-0!"
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
        <div class="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
          <Tabs<CallPanelTab>
            aria-label={t('calls.panel')}
            value={props.activeTab}
            onChange={props.onTabChange}
            options={[
              {
                value: 'chat',
                label: props.discussionLabel ?? t('calls.chat'),
                disabled: !props.chatAvailable,
              },
              {
                value: 'participants',
                label: t('calls.people'),
                count: isMobile()
                  ? props.participantCount.toLocaleString(formatLocale())
                  : undefined,
              },
              ...(props.work
                ? [
                    {
                      value: 'work' as const,
                      label: t('agentWork.title'),
                      dot: props.workDot,
                    },
                  ]
                : []),
            ]}
          />
          <Show when={!isMobile()}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('calls.closePanel')}
              tooltip={t('calls.closePanel')}
              onClick={props.onClose}
            >
              <XIcon class="size-4" />
            </Button>
          </Show>
        </div>
        <section
          aria-label={t('calls.chat')}
          hidden={props.activeTab !== 'chat'}
          inert={props.activeTab !== 'chat'}
          class={cn(
            'flex min-h-0 flex-1 flex-col',
            props.activeTab !== 'chat' && 'hidden'
          )}
        >
          {props.children}
        </section>
        <section
          aria-label={t('calls.participants')}
          hidden={props.activeTab !== 'participants'}
          inert={props.activeTab !== 'participants'}
          class={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-3',
            props.activeTab !== 'participants' && 'hidden'
          )}
        >
          {props.participants}
        </section>
        <section
          aria-label={t('agentWork.title')}
          hidden={props.activeTab !== 'work'}
          inert={props.activeTab !== 'work'}
          class={cn(
            'flex min-h-0 flex-1 flex-col',
            props.activeTab !== 'work' && 'hidden'
          )}
        >
          {props.work}
        </section>
      </div>
    </MobileDrawer>
  );
}
