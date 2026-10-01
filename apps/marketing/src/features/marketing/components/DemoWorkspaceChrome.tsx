import MacroLogo from '@icon/macro-logo.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { cn } from '@ui';
import { type JSX, Show, splitProps } from 'solid-js';

function TopBar(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'flex h-12 min-w-0 shrink-0 items-center gap-1 px-2 py-3 not-touch:pl-[13px] touch:hidden',
        local.class
      )}
      data-view-shell-top-bar=""
    >
      {local.children}
    </div>
  );
}
export const ViewShell = { TopBar };

export function AgentRosterRow(props: {
  id: string;
  name: string;
  handle: string;
  coder?: boolean;
  share: 'system' | 'team' | 'private';
  detail: string;
  actions?: JSX.Element;
}) {
  return (
    <div class="arow">
      <span class="grid size-9 shrink-0 place-items-center rounded-xl border border-edge-muted bg-surface-2">
        <Show when={props.coder} fallback={<MacroLogo class="size-5" />}>
          <CursorIcon class="size-5" />
        </Show>
      </span>
      <div class="info">
        <div class="line">
          <span class="nm truncate">{props.name}</span>
          <span class="tag truncate">@{props.handle}</span>
          <span class={props.share === 'system' ? 'badge system' : 'badge'}>
            {props.share}
          </span>
        </div>
        <p class="sub truncate">{props.detail}</p>
      </div>
      <div class="acts">{props.actions}</div>
    </div>
  );
}
