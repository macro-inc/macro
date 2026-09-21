import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { UserTooltip } from '@core/component/UserTooltip';
import { isMobile } from '@core/mobile/isMobile';
import { emailToMacroId } from '@core/user';
import { Popover } from '@kobalte/core/popover';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import { useCrmContactByEmailQuery } from '@queries/crm/contacts';
import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import { Button, Layer } from '@ui';
import {
  type Accessor,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { useEventDetailsOverlay } from './event-details-overlay';
import { useCrmEnabled } from './use-crm-enabled';

/**
 * A guest row that opens the guest's contact record when the team's CRM
 * knows them, and otherwise the person menu (copy email or name, DM, assign
 * a task) that a `...` button also reaches. The menu is a popover on
 * desktop and a bottom sheet on phones, where it holds the details sheet
 * open underneath it.
 */
export function EventAttendeeRow(props: {
  attendee: CalendarAttendee;
  displayName: Accessor<string>;
  children: JSX.Element;
}) {
  const overlay = useEventDetailsOverlay();
  const { openWithSplit } = useSplitLayout();
  const { teamId, crmEnabled } = useCrmEnabled();
  const contactQuery = useCrmContactByEmailQuery(
    teamId,
    () => props.attendee.email,
    () => crmEnabled() && !props.attendee.isSelf
  );
  const contact = () =>
    crmEnabled() && contactQuery.isSuccess
      ? (contactQuery.data ?? undefined)
      : undefined;

  const [menuOpen, setMenuOpenSignal] = createSignal(false);
  let releaseDetails: (() => void) | undefined;
  const setMenuOpen = (open: boolean) => {
    if (open) {
      releaseDetails ??= overlay.retain();
    } else {
      releaseDetails?.();
      releaseDetails = undefined;
    }
    setMenuOpenSignal(open);
  };
  onCleanup(() => releaseDetails?.());

  const openContact = (contactId: string) => {
    overlay.close();
    openWithSplit(
      { type: 'contact', id: contactId },
      { preferNewSplit: true, activate: true }
    );
  };
  const onRowClick = () => {
    const record = contact();
    if (record) {
      openContact(record.id);
    } else {
      setMenuOpen(true);
    }
  };
  // Menu actions that navigate (DM, assign, open contact) dismiss the menu
  // and the details behind it; copying leaves both up.
  const onMenuAction = () => {
    setMenuOpen(false);
    overlay.close();
  };
  const menuLabel = () => `Actions for ${props.displayName()}`;
  const menu = () => (
    <UserTooltip
      displayName={props.displayName()}
      email={props.attendee.email}
      id={emailToMacroId(props.attendee.email)}
      onClose={onMenuAction}
    />
  );

  return (
    <div class="flex min-w-0 items-center gap-1">
      <button
        type="button"
        class="-mx-1 flex min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-hover"
        title={contact() ? 'Open contact record' : undefined}
        onClick={onRowClick}
      >
        {props.children}
      </button>
      <Show
        when={isMobile()}
        fallback={
          <Popover
            open={menuOpen()}
            onOpenChange={setMenuOpen}
            placement="bottom-end"
            gutter={4}
            flip
            slide
          >
            <Popover.Trigger
              as={Button}
              label={menuLabel()}
              variant="ghost"
              size="icon-sm"
              depth={3}
              class="shrink-0 rounded-md text-ink-muted [&_svg]:size-4"
            >
              <DotsThreeIcon />
            </Popover.Trigger>
            <Popover.Portal>
              <Layer depth={3}>
                <Popover.Content class="portal-scope z-modal outline-none">
                  {menu()}
                </Popover.Content>
              </Layer>
            </Popover.Portal>
          </Popover>
        }
      >
        <Button
          label={menuLabel()}
          variant="ghost"
          size="icon-sm"
          depth={3}
          class="shrink-0 rounded-md text-ink-muted [&_svg]:size-4"
          onClick={() => setMenuOpen(true)}
        >
          <DotsThreeIcon />
        </Button>
        <MobileDrawer
          side="bottom"
          open={menuOpen()}
          onOpenChange={setMenuOpen}
          closeOnOutsidePointerStrategy="pointerdown"
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
            <MobileDrawer.Content aria-label={menuLabel()}>
              <MobileDrawer.Handle />
              <div class="px-3 pb-3 pt-1">{menu()}</div>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </div>
  );
}
