import { HoverCard } from '@core/component/HoverCard';
import { UserTooltip } from '@core/component/UserTooltip';
import { macroIdToEmail, tryMacroId, useDisplayName } from '@core/user';
import { cn } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useMessage } from './context';

type FromPillProps = {
  class?: string;
};

/**
 * Shows who triggered an agent (bot) message, e.g. `from Eric Hayes`, where the
 * name is a hoverable user reference (same hover card as an `@mention`).
 * Rendered only when the message's sender carries a `triggered_by` user id.
 */
export function FromPill(props: FromPillProps) {
  const message = useMessage();
  const triggeredBy = () => message().sender?.triggered_by ?? undefined;
  const macroId = () => {
    const id = triggeredBy();
    return id ? tryMacroId(id) : undefined;
  };
  const [displayName] = useDisplayName(macroId());
  const email = () => {
    const id = macroId();
    return id ? macroIdToEmail(id) : (triggeredBy() ?? '');
  };
  const label = () => displayName() || email() || (triggeredBy() ?? '');

  const [open, setOpen] = createSignal(false);

  return (
    <Show when={triggeredBy()}>
      <span
        class={cn(
          'inline-flex items-center gap-1 text-xs text-ink-muted',
          props.class
        )}
      >
        from
        <HoverCard
          placement="top"
          open={open()}
          onOpenChange={setOpen}
          triggerAs="span"
          trigger={
            <span class="cursor-default rounded-md p-0.5 font-medium text-accent hover:bg-accent/20 focus:bg-accent/20">
              {label()}
            </span>
          }
          content={
            <UserTooltip
              displayName={label()}
              email={email()}
              id={triggeredBy()}
              onClose={() => setOpen(false)}
            />
          }
        />
      </span>
    </Show>
  );
}
