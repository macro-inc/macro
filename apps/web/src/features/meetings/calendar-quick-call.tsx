import { getMeetingPath } from '@channel/Call/call-link';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import type { WithCustomUserInput } from '@core/user';
import UserPlus from '@phosphor/user-plus.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import {
  useCreateMeetingMutation,
  useInviteToMeetingMutation,
} from '@queries/call/meetings';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';

/** A standalone call with direct email invitations, never an implicit channel. */
export function CalendarQuickCall() {
  const { all: options } = useCombinedRecipients(['user']);
  const [selected, setSelected] = createSignal<
    WithCustomUserInput<'user' | 'contact'>[]
  >([]);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [token, setToken] = createSignal<string>();
  const sent = new Set<string>();
  const create = useCreateMeetingMutation();
  const invite = useInviteToMeetingMutation();
  const navigate = useNavigate();
  const invalid = () =>
    selected().some(
      (person) => person.kind === 'custom' && person.data.invalid
    );
  async function start() {
    if (pending() || invalid()) return;
    setPending(true);
    setError(undefined);
    try {
      // Retain the link and successful invitations if a later email fails.
      const shareToken =
        token() ??
        (await create.mutateAsync({ title: 'Quick Call' })).shareToken;
      setToken(shareToken);
      for (const person of selected()) {
        const email = person.data.email.trim().toLowerCase();
        if (sent.has(email)) continue;
        await invite.mutateAsync({ shareToken, email });
        sent.add(email);
      }
      navigate(`${getMeetingPath(shareToken)}?start=true`);
    } catch {
      setError(
        token()
          ? 'Your call is ready, but an invitation failed. Retry to send the remaining invitations, or join now.'
          : 'Could not create the call. Please try again.'
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div class="space-y-2">
      <div class="flex min-w-0 items-center gap-2 rounded-xl border border-edge-muted bg-panel p-2 pl-3">
        <UserPlus class="size-5 shrink-0 text-ink-muted" />
        <div class="min-w-0 flex-1">
          <RecipientSelector<'user' | 'contact'>
            options={options}
            selectedOptions={selected()}
            setSelectedOptions={setSelected}
            placeholder="Start a Quick Call: add people by name or email…"
            triggerMode="input"
            hideBorder
            noPadding
            disabled={pending()}
            class="bg-transparent text-sm"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          class="shrink-0 rounded-lg"
          disabled={pending() || invalid()}
          onClick={() => void start()}
        >
          <VideoCamera class="size-4" />
          {pending() ? 'Starting…' : 'Call'}
        </Button>
      </div>
      <Show when={error()}>
        <p role="alert" class="text-xs text-failure">
          {error()}
        </p>
        <Show when={token()}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate(`${getMeetingPath(token()!)}?start=true`)}
          >
            Join now
          </Button>
        </Show>
      </Show>
    </div>
  );
}
