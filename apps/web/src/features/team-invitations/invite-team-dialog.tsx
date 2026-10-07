import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import XIcon from '@phosphor/x.svg';
import { useInviteToTeamMutation } from '@queries/team/invites';
import { Button, Dialog, Panel, Tooltip } from '@ui';
import { createSignal, Index, Show } from 'solid-js';
import { z } from 'zod';

const emailSchema = z.string().email();

export type InviteEntry = { email: string };

export const EMPTY_INVITE: InviteEntry = { email: '' };

function InviteEntryRow(props: {
  entry: InviteEntry;
  onEmailChange: (email: string) => void;
  onBlur: () => void;
  onRemove: () => void;
  showRemove: boolean;
  error?: string;
}) {
  return (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2">
        <input
          type="text"
          value={props.entry.email}
          onInput={(e) => props.onEmailChange(e.currentTarget.value)}
          onBlur={() => props.onBlur()}
          placeholder="Enter email address"
          class="settings-input flex-1 min-w-0"
          aria-invalid={!!props.error}
        />
        <Show when={props.showRemove}>
          <Tooltip label="Remove">
            <Button
              variant="outline"
              size="icon-sm"
              class="shrink-0 focus:border-accent"
              tabIndex={0}
              onClick={props.onRemove}
            >
              <XIcon class="size-4" />
            </Button>
          </Tooltip>
        </Show>
      </div>
      <Show when={props.error}>
        <p class="text-xs text-failure-ink">{props.error}</p>
      </Show>
    </div>
  );
}

function getEmailError(
  email: string,
  existingEmails: string[],
  excludeIndex?: number
): string | undefined {
  const trimmed = email.trim();
  if (trimmed === '') return undefined;
  if (!emailSchema.safeParse(trimmed).success) return 'Invalid email address';
  const isDuplicate = existingEmails.some(
    (existing, i) =>
      i !== excludeIndex && existing.toLowerCase() === trimmed.toLowerCase()
  );
  if (isDuplicate) return 'Email already added';
  return undefined;
}

export function validateInviteEmails(invites: InviteEntry[]): {
  errors: (string | undefined)[];
  hasError: boolean;
} {
  const emails = invites.map((i) => i.email);
  const errors = invites.map((inv, i) => getEmailError(inv.email, emails, i));
  return { errors, hasError: errors.some((e) => e !== undefined) };
}

export function InviteEmailsInput(props: {
  invites: InviteEntry[];
  onChange: (invites: InviteEntry[]) => void;
  errors: (string | undefined)[];
  onErrorsChange: (errors: (string | undefined)[]) => void;
}) {
  const existingEmails = () => props.invites.map((i) => i.email);

  const validateEmail = (index: number) => {
    const error = getEmailError(
      props.invites[index]?.email ?? '',
      existingEmails(),
      index
    );
    const next = [...props.errors];
    next[index] = error;
    props.onErrorsChange(next);
    return !error;
  };

  const updateEmail = (index: number, email: string) => {
    const updated = [...props.invites];
    updated[index] = { ...updated[index], email };
    props.onChange(updated);
    if (props.errors[index]) {
      const next = [...props.errors];
      next[index] = undefined;
      props.onErrorsChange(next);
    }
  };

  let containerRef: HTMLDivElement | undefined;

  const addRow = () => {
    props.onChange([...props.invites, { email: '' }]);
    requestAnimationFrame(() => {
      const inputs = containerRef?.querySelectorAll('input[type="text"]');
      const lastInput = inputs?.[inputs.length - 1] as
        | HTMLInputElement
        | undefined;
      lastInput?.focus();
    });
  };

  const removeRow = (index: number) => {
    props.onChange(props.invites.filter((_, i) => i !== index));
    props.onErrorsChange(props.errors.filter((_, i) => i !== index));
  };

  const lastInvite = () => props.invites[props.invites.length - 1];
  const lastError = () => props.errors[props.errors.length - 1];
  const canAddRow = () => {
    const last = lastInvite();
    return last?.email.trim() !== '' && !lastError();
  };

  return (
    <div ref={containerRef} class="flex flex-col gap-2">
      <Show when={props.invites.length > 0}>
        <div class="flex flex-col gap-2 max-h-72 overflow-y-auto">
          <Index each={props.invites}>
            {(entry, index) => (
              <InviteEntryRow
                entry={entry()}
                onEmailChange={(email) => updateEmail(index, email)}
                onBlur={() => validateEmail(index)}
                onRemove={() => removeRow(index)}
                showRemove={props.invites.length > 1}
                error={props.errors[index]}
              />
            )}
          </Index>
        </div>
      </Show>
      <Button
        variant="outline"
        class="w-full justify-center focus:border-accent"
        tabIndex={0}
        disabled={!canAddRow()}
        onClick={addRow}
      >
        <PlusIcon class="size-4" />
        Add another
      </Button>
    </div>
  );
}

/** Invites teammates by email to the given team. */
export function InviteTeamDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string | undefined;
}) {
  const inviteToTeamMutation = useInviteToTeamMutation();
  const [invites, setInvites] = createSignal<InviteEntry[]>([EMPTY_INVITE]);
  const [inviteErrors, setInviteErrors] = createSignal<(string | undefined)[]>(
    []
  );

  const hasValidInvites = () =>
    invites().some((i) => i.email.trim() !== '') &&
    !inviteErrors().some((e) => e !== undefined);

  const reset = () => {
    setInvites([EMPTY_INVITE]);
    setInviteErrors([]);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) reset();
    props.onOpenChange(open);
  };

  const handleInvite = () => {
    const currentInvites = invites();
    if (currentInvites.length === 0 || !props.teamId) return;

    const { errors, hasError } = validateInviteEmails(currentInvites);
    setInviteErrors(errors);
    if (hasError) return;

    const inviteEntries = currentInvites
      .filter((i) => i.email.trim() !== '')
      .map((i) => ({ email: i.email.trim() }));

    inviteToTeamMutation.mutate(
      { teamId: props.teamId, request: { invites: inviteEntries } },
      { onSuccess: () => handleOpenChange(false) }
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <Panel depth={2} class="max-h-[75vh] text-ink rounded-xl">
        <Panel.Header class="px-2 gap-1">
          <Dialog.CloseButton as={Button} variant="ghost" size="icon-sm">
            <XIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="text-sm font-medium p-0 m-0">
            Invite to Team
          </Dialog.Title>
        </Panel.Header>

        <Panel.Body class="p-3 flex flex-col gap-3">
          <InviteEmailsInput
            invites={invites()}
            onChange={setInvites}
            errors={inviteErrors()}
            onErrorsChange={setInviteErrors}
          />
          <div class="flex justify-end gap-1 pt-2">
            <Button
              variant="ghost"
              disabled={inviteToTeamMutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="strong"
              disabled={!hasValidInvites() || inviteToTeamMutation.isPending}
              onClick={handleInvite}
            >
              <Show
                when={inviteToTeamMutation.isPending}
                fallback={
                  invites().length > 1
                    ? `Send ${invites().length} Invites`
                    : 'Send Invite'
                }
              >
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
