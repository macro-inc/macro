import { fireAndForget } from '@core/util/fireAndForget';
import { Button, TextField } from '@ui';
import { Show } from 'solid-js';
import type { SharingSource } from '../context/contracts';
import { createDirectAccessInvite } from '../primitives/direct-access-invite';

export function DirectAccessInvite(props: {
  source: SharingSource;
  description: string;
}) {
  const invite = createDirectAccessInvite(props.source);
  return (
    <form
      class="flex flex-col gap-2 px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        fireAndForget(invite.invite(), 'access-requests.invite');
      }}
    >
      <p class="text-sm text-ink-muted">{props.description}</p>
      <div class="flex flex-wrap items-end gap-2">
        <TextField
          class="min-w-0 flex-1"
          value={invite.email()}
          onChange={invite.setEmail}
        >
          <TextField.Label>Macro email address</TextField.Label>
          <TextField.Input
            type="email"
            required
            disabled={props.source.busy()}
            placeholder="name@example.com"
          />
        </TextField>
        <Button
          type="submit"
          variant="primary"
          disabled={
            props.source.busy() ||
            !props.source.state()?.canReview ||
            !invite.email().trim()
          }
        >
          Add person
        </Button>
      </div>
      <Show when={invite.notice()}>
        <p role="status" class="text-xs text-ink-muted">
          {invite.notice()}
        </p>
      </Show>
      <Show when={invite.error()}>
        <p role="alert" class="text-xs text-failure-ink">
          {invite.error()}
        </p>
      </Show>
    </form>
  );
}
