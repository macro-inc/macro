import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import ChecksIcon from '@icon/system/regular/checks.svg';
import { Button } from '@ui';
import { createSignal, For, type JSX } from 'solid-js';
import type { InboxClearChoice } from '../core/inbox-filters';
import {
  CLEARABLE_KINDS,
  clearAllLabel,
  clearTodayLabel,
  type InboxClearMenuProps,
} from './inbox-clear-menu';

function DrawerRow(props: { onClick: () => void; children: JSX.Element }) {
  return (
    <button
      type="button"
      class="flex min-h-12 w-full items-center gap-3 px-6 text-left text-base text-ink not-touch:hover:bg-hover"
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

/** The touch counterpart of the clear menu: the same choices in a sheet. */
export function InboxClearDrawer(props: InboxClearMenuProps) {
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const choose = (choice: InboxClearChoice) => {
    setOpen(false);
    props.onClear(choice);
  };
  return (
    <MobileDrawer
      side="bottom"
      open={open()}
      onOpenChange={setOpen}
      restoreFocus
      finalFocusEl={trigger()}
    >
      <MobileDrawer.Trigger
        ref={setTrigger}
        as={Button}
        aria-label={t('notificationsInbox.clear')}
        variant="ghost"
        size="icon-md"
        class="island bg-chrome pointer-events-auto relative z-10 size-10 shrink-0 rounded-full"
      >
        <ChecksIcon class="size-6 shrink-0" />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label={t('notificationsInbox.clear')}
          class="max-h-[85vh]"
        >
          <MobileDrawer.Handle class="pb-1" />
          <h2 class="truncate px-6 pb-2 text-lg font-semibold text-ink">
            {t('notificationsInbox.clear')}
          </h2>
          <MobileDrawer.ScrollBody>
            <DrawerRow onClick={() => choose({ kind: 'today' })}>
              {clearTodayLabel(props.unreadOnly)}
            </DrawerRow>
            <DrawerRow onClick={() => choose({ kind: 'all' })}>
              {clearAllLabel(props.unreadOnly)}
            </DrawerRow>
            <p class="px-6 pt-4 pb-1 text-sm text-ink-muted">
              {t('notificationsInbox.clearByKind')}
            </p>
            <For each={CLEARABLE_KINDS.filter(({ id }) => props.isShown(id))}>
              {(option) => (
                <DrawerRow
                  onClick={() =>
                    choose({ kind: 'category', category: option.id })
                  }
                >
                  {option.icon?.()}
                  <span class="min-w-0 truncate">{option.label}</span>
                </DrawerRow>
              )}
            </For>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
