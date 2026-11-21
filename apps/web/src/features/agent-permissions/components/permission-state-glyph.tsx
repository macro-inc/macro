import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import HandPalmIcon from '@icon/system/regular/hand-palm.svg';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import type { ToolPermissionState } from '@service-agent-harness/generated/schemas';
import { cn } from '@ui';
import { Match, Switch } from 'solid-js';

/**
 * The state's glyph. Color lives on the glyph and the text beside it stays
 * ink, so color is never the only signal: Allow is a quiet check, Ask an
 * amber hand, Never a red prohibit sign.
 */
export function PermissionStateGlyph(props: {
  state: ToolPermissionState;
  class?: string;
}) {
  const classes = () => cn('size-4 shrink-0', props.class);
  return (
    <Switch>
      <Match when={props.state === 'always'}>
        <CheckCircleIcon
          aria-hidden="true"
          class={cn(classes(), 'text-ink-extra-muted')}
        />
      </Match>
      <Match when={props.state === 'ask'}>
        <HandPalmIcon aria-hidden="true" class={cn(classes(), 'text-amber')} />
      </Match>
      <Match when={props.state === 'never'}>
        <ProhibitIcon
          aria-hidden="true"
          class={cn(classes(), 'text-failure')}
        />
      </Match>
    </Switch>
  );
}
