import '@fontsource-variable/inter';
import '../../../../index.css';
import { ComposerAddDrawer } from '@app/features/channel/Input/ComposerAddMenu';
import { MobileSettingsSheet } from '@app/features/settings/MobileSettingsSheet';
import { SettingsPage, SettingsRow } from '@app/features/settings/primitives';
import type { SettingsTab } from '@core/constant/SettingsState';
import { SETTINGS_TAB_GROUPS } from '@core/constant/settingsTabsConfig';
import { EmailProviderDialog } from '@core/email-link/ProviderDialog';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  Button,
  ConfirmDialog,
  confirmDialog,
  Dialog,
  ImperativeDialogHost,
  Input,
  type ManagedDialogProps,
  openDialog,
  useImperativeDialog,
} from '@ui';
import { createSignal, getOwner, Match, Show, Switch } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../../features/theme/themes/macro-light';
import { ConfirmDrawer } from '../ConfirmDrawer';
import { MobileDrawer } from '../MobileDrawer';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = 'true';

const [pressed, setPressed] = createSignal<string[]>([]);
const press = (control: string) => setPressed((list) => [...list, control]);

/** Connect email opens as `selectEmailProvider` opens it, under the sheet's owner. */
function EmailSettingsPage() {
  const owner = getOwner();
  const connectEmail = () => {
    const handle = openDialog(
      EmailProviderDialog,
      {
        outlookAvailable: true,
        onSelect: (provider) => {
          press(`Connect ${provider}`);
          handle.close();
        },
      },
      { owner }
    );
  };
  return (
    <SettingsPage title="Email">
      <SettingsRow label="alex@example.com" description="Up to date">
        <Button variant="ghost" onClick={() => press('Remove inbox')}>
          Remove
        </Button>
      </SettingsRow>
      <SettingsRow label="Add another inbox">
        <Button variant="secondary" onClick={connectEmail}>
          Add account
        </Button>
      </SettingsRow>
    </SettingsPage>
  );
}

function SettingsScenario() {
  const [page, setPage] = createSignal<SettingsTab | undefined>('Email');
  return (
    <MobileSettingsSheet
      open
      page={page()}
      groups={SETTINGS_TAB_GROUPS}
      name="Alex Morgan"
      email="alex@example.com"
      avatar="AM"
      onClose={() => press('Close settings')}
      onNavigate={(next) => {
        if (!next) press('Back to settings');
        setPage(next);
      }}
      onLogout={() => press('Log out')}
      renderPage={() => <EmailSettingsPage />}
    />
  );
}

function DeleteEventDialog(props: ManagedDialogProps) {
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Delete event"
      confirmLabel="Delete"
      tone="danger"
      onConfirm={() => press('Confirm delete')}
    />
  );
}

/** Shaped like event details: unmounted on close, sheets stacked on it. */
function EventDetailsDrawer(props: { onClose: () => void }) {
  const [guests, setGuests] = createSignal(false);
  const [rsvpScope, setRsvpScope] = createSignal(false);
  const [share, setShare] = createSignal(false);
  const deleteDialog = useImperativeDialog(DeleteEventDialog);
  return (
    <MobileDrawer
      side="bottom"
      open
      onOpenChange={(open) => {
        if (
          !open &&
          (guests() || rsvpScope() || share() || deleteDialog.isOpen())
        )
          return;
        props.onClose();
      }}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label="Weekly product sync"
          targetHeight={70}
        >
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody class="gap-3 px-6">
            <Button onClick={() => press('Edit')}>Edit</Button>
            <Button onClick={() => setGuests(true)}>Add guests</Button>
            <Button onClick={() => setRsvpScope(true)}>RSVP</Button>
            <Button onClick={() => setShare(true)}>Share note</Button>
            <Button onClick={() => deleteDialog.open({})}>Delete</Button>
          </MobileDrawer.ScrollBody>
          <Dialog open={guests()} onOpenChange={setGuests}>
            <Dialog.Title class="px-4 pb-2 text-base font-semibold">
              Add guests
            </Dialog.Title>
            <div class="h-40 px-4">
              <Button onClick={() => press('Add guest')}>Add Priya</Button>
            </div>
          </Dialog>
          <MobileDrawer
            side="bottom"
            open={rsvpScope()}
            onOpenChange={setRsvpScope}
          >
            <MobileDrawer.Portal>
              <MobileDrawer.Overlay />
              <MobileDrawer.Content aria-label="RSVP to recurring event">
                <MobileDrawer.Handle />
                <div class="h-40 px-6">
                  <Button onClick={() => press('All events')}>
                    All events
                  </Button>
                </div>
              </MobileDrawer.Content>
            </MobileDrawer.Portal>
          </MobileDrawer>
          <Show when={share()}>
            <MobileDrawer
              side="bottom"
              open
              onOpenChange={setShare}
              closeOnOutsidePointerStrategy="pointerdown"
            >
              <MobileDrawer.Portal>
                <MobileDrawer.Overlay />
                <MobileDrawer.Content aria-label="Share note">
                  <MobileDrawer.Handle />
                  <div class="h-40 px-6">Share note</div>
                </MobileDrawer.Content>
              </MobileDrawer.Portal>
            </MobileDrawer>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

function EventScenario() {
  const [open, setOpen] = createSignal(true);
  return (
    <Show when={open()}>
      <EventDetailsDrawer onClose={() => setOpen(false)} />
    </Show>
  );
}

/**
 * Shaped like the event composer: unmounted on close, and a close request
 * asks first from a prompt outside the sheet's dismiss stack.
 */
function DirtyComposerScenario() {
  const owner = getOwner();
  const [open, setOpen] = createSignal(true);
  let asking = false;
  const requestClose = async () => {
    if (asking) return;
    asking = true;
    const discard = await confirmDialog(
      {
        title: 'You still have remaining changes',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      },
      { owner }
    );
    asking = false;
    if (discard) setOpen(false);
  };
  return (
    <Show when={open()}>
      <MobileDrawer
        side="bottom"
        open
        onOpenChange={(next) => {
          if (!next) fireAndForget(requestClose(), 'stacked-sheets-fixture');
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="New event" maxHeight={92}>
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody class="h-80 gap-3 px-6">
              <Input aria-label="Title" />
              <Button onClick={() => press('Create event')}>
                Create event
              </Button>
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Show>
  );
}

/** A confirmation mid-request refuses every close until the request settles. */
function PendingConfirmScenario() {
  return (
    <ConfirmDialog
      open
      pending
      onOpenChange={() => press('Close pending')}
      title="Delete event"
      confirmLabel="Delete"
      tone="danger"
      onConfirm={() => press('Confirm delete')}
    />
  );
}

/** Nothing controls this sheet: its trigger opens it. */
function UncontrolledScenario() {
  return (
    <MobileDrawer side="bottom">
      <MobileDrawer.Trigger as={Button} class="fixed top-20 left-4">
        Open filters
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Filters">
          <MobileDrawer.Handle />
          <div class="h-40 px-6">Filters</div>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/** Shaped like the Android share sheet: closing it asks to discard first. */
function DiscardScenario() {
  const [open, setOpen] = createSignal(true);
  const [confirmDiscard, setConfirmDiscard] = createSignal(false);
  return (
    <>
      <MobileDrawer
        side="bottom"
        open={open()}
        onOpenChange={(next) => {
          if (!next) setConfirmDiscard(true);
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="Share to Macro" targetHeight={80}>
            <MobileDrawer.Handle />
            <div class="h-40 px-6">
              <Button onClick={() => press('Send')}>Send</Button>
            </div>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
      <ConfirmDrawer
        open={confirmDiscard()}
        onOpenChange={setConfirmDiscard}
        title="Discard this share?"
        body="Your message and shared attachments will be removed."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => {
          setConfirmDiscard(false);
          setOpen(false);
        }}
      />
    </>
  );
}

/** The composer's +, the sheet the focus ring was reported on. */
function MenuScenario() {
  const [open, setOpen] = createSignal(true);
  let editor: HTMLDivElement | undefined;
  const item = (id: string, label: string) => ({
    id,
    label,
    icon: <span aria-hidden="true">+</span>,
    onSelect: () => press(label),
  });
  return (
    <>
      <div ref={editor} contenteditable class="fixed bottom-2 left-4 text-xs" />
      <ComposerAddDrawer
        open={open()}
        onOpenChange={setOpen}
        getEditor={() => editor}
        groups={[
          {
            items: [
              { ...item('mention', 'Mention'), focusesEditor: true },
              item('files', 'Attach files'),
              item('gif', 'GIF'),
            ],
          },
          {
            items: [
              item('task', 'New task'),
              item('poll', 'New poll'),
              // Last, and unfocusable: the keyboard must skip past it.
              { ...item('form', 'New form'), disabled: true },
            ],
          },
        ]}
      />
    </>
  );
}

/** Shaped like the repository picker: a sheet opened to type a search into. */
function TypingScenario() {
  const [open, setOpen] = createSignal(true);
  return (
    <MobileDrawer side="bottom" open={open()} onOpenChange={setOpen}>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Choose a repository">
          <MobileDrawer.Handle />
          <input
            aria-label="Search repositories"
            class="mx-4 mb-2 h-9 bg-transparent outline-none"
          />
          <MobileDrawer.ScrollBody>
            <MobileDrawer.Section class="flex flex-col">
              <MobileDrawer.Item onClick={() => press('macro')}>
                macro
              </MobileDrawer.Item>
            </MobileDrawer.Section>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

/** Shaped like the model picker: the field it opens for is named explicitly. */
function SearchScenario() {
  const [open, setOpen] = createSignal(true);
  const [search, setSearch] = createSignal<HTMLInputElement>();
  return (
    <MobileDrawer
      side="bottom"
      open={open()}
      onOpenChange={setOpen}
      initialFocusEl={search()}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Choose a model">
          <MobileDrawer.Handle />
          {/* Behind the Back row, so only the named target can focus it. */}
          <div class="flex items-center gap-2 px-4 pb-2">
            <Button variant="ghost" onClick={() => press('Back')}>
              Back
            </Button>
            <input
              ref={setSearch}
              aria-label="Search models"
              class="h-9 min-w-0 flex-1 bg-transparent outline-none"
            />
          </div>
          <MobileDrawer.ScrollBody>
            <MobileDrawer.Section class="flex flex-col">
              <MobileDrawer.Item onClick={() => press('Sonnet')}>
                Sonnet
              </MobileDrawer.Item>
            </MobileDrawer.Section>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

function Fixture() {
  const scenario = new URLSearchParams(location.search).get('scenario');
  return (
    <>
      <Button class="fixed top-8 left-4" onClick={() => press('Page control')}>
        Page control
      </Button>
      <output aria-label="Pressed" class="fixed top-2 left-4 text-xs">
        {pressed().join(', ')}
      </output>
      <Switch fallback={<EventScenario />}>
        <Match when={scenario === 'settings'}>
          <SettingsScenario />
        </Match>
        <Match when={scenario === 'discard'}>
          <DiscardScenario />
        </Match>
        <Match when={scenario === 'composer'}>
          <DirtyComposerScenario />
        </Match>
        <Match when={scenario === 'pending'}>
          <PendingConfirmScenario />
        </Match>
        <Match when={scenario === 'uncontrolled'}>
          <UncontrolledScenario />
        </Match>
        <Match when={scenario === 'menu'}>
          <MenuScenario />
        </Match>
        <Match when={scenario === 'typing'}>
          <TypingScenario />
        </Match>
        <Match when={scenario === 'search'}>
          <SearchScenario />
        </Match>
      </Switch>
      <ImperativeDialogHost />
    </>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
