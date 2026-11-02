import { Popover } from '@kobalte/core/popover';
import InfoIcon from '@phosphor/info.svg';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Input,
  type ManagedDialogProps,
} from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

type FormStatus = Pick<ManagedDialogProps, 'onOpenChange'> & {
  pending: boolean;
  error?: string;
};

const SHARING_DESCRIPTION =
  'Teammates can use these filters on items they can already access. Only you can edit this view.';

function SharingInfo() {
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open()) return;
    // Keep Escape from also dismissing the containing mobile drawer.
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  };
  return (
    <Popover open={open()} onOpenChange={setOpen} modal={false} placement="top">
      <Popover.Trigger
        ref={setTrigger}
        as={Button}
        variant="ghost"
        size="icon-xs"
        aria-label="About team sharing"
        tooltip={{ content: SHARING_DESCRIPTION, disabled: open() }}
        onKeyDown={closeOnEscape}
      >
        <InfoIcon class="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal
        mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
      >
        <Popover.Content
          class="menu-surface z-action-menu max-w-72 p-3 text-xs outline-none"
          onKeyDown={closeOnEscape}
        >
          <Popover.Title class="sr-only">About team sharing</Popover.Title>
          <Popover.Description>{SHARING_DESCRIPTION}</Popover.Description>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

export function SavedViewForm(
  props: FormStatus & {
    name: string;
    sharedTeamId?: string | null;
    title?: string;
    submitLabel?: string;
    summary?: JSX.Element;
    team?: { id: string; name: string };
    onSave: (name: string, team: string | null) => void;
  }
) {
  const [name, setName] = createSignal(props.name);
  const [shared, setShared] = createSignal(Boolean(props.sharedTeamId));
  return (
    <form
      class="flex flex-col gap-5 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave(
          name().trim(),
          shared() ? (props.sharedTeamId ?? props.team?.id ?? null) : null
        );
      }}
    >
      <Dialog.Title class="text-lg font-medium wrap-anywhere">
        {props.title ?? 'Save view'}
      </Dialog.Title>
      <label class="flex flex-col gap-2 text-sm">
        Name
        <Input
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          maxLength={120}
          required
          disabled={props.pending}
          placeholder="e.g. Needs review"
        />
      </label>
      <Show when={props.summary}>
        <div class="flex flex-col gap-2 text-xs text-ink-muted">
          {props.summary}
        </div>
      </Show>
      <Show when={props.team || props.sharedTeamId}>
        <div class="flex items-center gap-1.5">
          <Checkbox
            checked={shared()}
            onChange={setShared}
            disabled={props.pending}
          >
            <Checkbox.Control />
            <Checkbox.Label>
              Share with{' '}
              {props.sharedTeamId && props.sharedTeamId !== props.team?.id
                ? 'team'
                : props.team?.name}
            </Checkbox.Label>
          </Checkbox>
          <SharingInfo />
        </div>
      </Show>
      <Show when={props.error}>
        <p role="alert" class="text-sm text-failure-ink">
          {props.error}
        </p>
      </Show>
      <div class="flex justify-end gap-2">
        <Button
          variant="ghost"
          disabled={props.pending}
          onClick={() => props.onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={props.pending || !name().trim()}
        >
          {props.pending ? 'Saving…' : (props.submitLabel ?? 'Save view')}
        </Button>
      </div>
    </form>
  );
}

export function DeleteSavedViewConfirmation(
  props: ManagedDialogProps &
    FormStatus & { name: string; onDelete: () => void }
) {
  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!props.pending) props.onOpenChange(open);
      }}
      title={<span class="wrap-anywhere">Delete “{props.name}”?</span>}
      body={
        <>
          <p>
            This removes the view for you and anyone it is shared with. Items
            are not deleted.
          </p>
          <Show when={props.error}>
            <p role="alert">{props.error}</p>
          </Show>
        </>
      }
      confirmLabel="Delete view"
      tone="danger"
      pending={props.pending}
      onConfirm={props.onDelete}
    />
  );
}
