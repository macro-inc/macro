import CircleNotch from '@phosphor-icons/core/light/circle-notch-light.svg';
import FileText from '@phosphor-icons/core/light/file-text-light.svg';
import Gear from '@phosphor-icons/core/light/gear-light.svg';
import Brain from '@phosphor-icons/core/light/brain-light.svg';
import ListChecks from '@phosphor-icons/core/light/list-checks-light.svg';
import MagnifyingGlass from '@phosphor-icons/core/light/magnifying-glass-light.svg';
import PencilSimple from '@phosphor-icons/core/light/pencil-simple-light.svg';
import Plugs from '@phosphor-icons/core/light/plugs-light.svg';
import Shield from '@phosphor-icons/core/light/shield-light.svg';
import Spinner from '@phosphor-icons/core/light/spinner-light.svg';
import Stop from '@phosphor-icons/core/light/stop-light.svg';
import TerminalWindow from '@phosphor-icons/core/light/terminal-window-light.svg';
import WarningCircle from '@phosphor-icons/core/light/warning-circle-light.svg';
import { staticFileSizedUrl } from '@core/constant/servers';
import { Avatar } from '@ui';
import { type Component, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { MagicChipAgent } from './display';
import type { MagicChipActivityIcon } from './presentation';

const LEAD_ICONS: Record<
  MagicChipActivityIcon,
  Component<{ class?: string; classList?: Record<string, boolean> }>
> = {
  boot: Spinner,
  think: Brain,
  wait: CircleNotch,
  write: PencilSimple,
  terminal: TerminalWindow,
  edit: PencilSimple,
  read: FileText,
  search: MagnifyingGlass,
  permission: Shield,
  plan: ListChecks,
  stop: Stop,
  error: WarningCircle,
  disconnect: Plugs,
  gear: Gear,
};

export function AgentFace(props: MagicChipAgent) {
  const initial = () => props.name.trim().charAt(0).toUpperCase() || 'A';
  return (
    <Avatar size="sm" class="shrink-0 text-[8px]">
      <Show
        when={props.avatarUrl}
        fallback={<Avatar.Fallback>{initial()}</Avatar.Fallback>}
      >
        {(url) => (
          <Avatar.Image
            class="bg-surface"
            src={staticFileSizedUrl(url(), 'small')}
            alt={props.name}
          />
        )}
      </Show>
    </Avatar>
  );
}

export function LeadIcon(props: {
  icon: MagicChipActivityIcon;
  busy: boolean;
}) {
  const spin = () =>
    props.busy && (props.icon === 'boot' || props.icon === 'wait');
  return (
    <Dynamic
      component={LEAD_ICONS[props.icon]}
      class="size-3.5 shrink-0 text-ink-muted motion-reduce:animate-none"
      classList={{
        'animate-spin': spin(),
        'animate-pulse': props.busy && !spin(),
      }}
    />
  );
}
