import CaretDownIcon from '@phosphor/caret-down.svg';
import {
  badgeTriggerClasses,
  cn,
  Dropdown,
  Hotkey,
  SendButton,
  SingleSelectCheck,
} from '@ui';
import type { SessionStartMode } from './session-start-mode';

export function SessionStartToggle(props: {
  mode: SessionStartMode;
  /** Committed choice for menu checks. Cmd preview only changes `mode`. */
  committed?: SessionStartMode;
  pending?: boolean;
  disabled?: boolean;
  error?: boolean;
  onModeChange: (mode: SessionStartMode) => void;
  onStart: () => void;
}) {
  const background = () => props.mode === 'background';
  const selected = () => props.committed ?? props.mode;
  const startLabel = () => {
    if (props.pending) return 'Starting…';
    if (props.error) return 'Retry';
    return background() ? 'Start session in background' : 'Start session';
  };

  return (
    <div
      role="group"
      aria-label="Session start mode"
      data-session-start-mode={props.mode}
      class={cn(
        'flex h-7 shrink-0 items-center gap-1.5',
        props.disabled && 'opacity-60'
      )}
    >
      <Dropdown placement="top-end">
        <Dropdown.Trigger
          variant="outline"
          size="sm"
          class={badgeTriggerClasses({
            variant: 'outline',
            size: 'sm',
            class:
              'gap-1 px-2 text-ink-muted data-expanded:bg-hover data-expanded:text-ink',
          })}
          aria-label="Session start mode"
          disabled={props.disabled}
        >
          <span class="text-ink">{background() ? 'Background' : 'Live'}</span>
          <CaretDownIcon class="size-3 shrink-0 text-current/70" />
        </Dropdown.Trigger>
        <Dropdown.Content class="min-w-40">
          <Dropdown.Group>
            <Dropdown.Item
              class="h-8"
              role="menuitemradio"
              aria-checked={selected() === 'live'}
              onSelect={() => props.onModeChange('live')}
            >
              <span class="min-w-0 flex-1 truncate">Live</span>
              <SingleSelectCheck active={selected() === 'live'} />
            </Dropdown.Item>
            <Dropdown.Item
              class="h-8"
              role="menuitemradio"
              aria-checked={selected() === 'background'}
              onSelect={() => props.onModeChange('background')}
            >
              <span class="min-w-0 flex-1 truncate">Background</span>
              <Hotkey shortcut="cmd" theme="subtle" />
              <SingleSelectCheck active={selected() === 'background'} />
            </Dropdown.Item>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <SendButton
        aria-label={startLabel()}
        tooltip={startLabel()}
        pending={props.pending}
        disabled={props.disabled}
        onClick={() => props.onStart()}
      />
    </div>
  );
}
