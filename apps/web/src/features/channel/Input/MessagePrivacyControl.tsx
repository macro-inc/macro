import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import GlobeIcon from '@icon/system/regular/globe.svg';
import LockIcon from '@icon/system/regular/lock-key.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';

/** The audience is visible before sending and cannot widen inside a private thread. */
export function MessagePrivacyControl(props: {
  private: boolean;
  locked?: boolean;
  newThread?: boolean;
  reason?: string;
  onChange: (value: boolean) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <div
      class={cn(
        'flex items-center gap-2 rounded-t-xl px-2 py-1 text-xs',
        props.private && 'bg-accent/5'
      )}
    >
      <Dropdown placement="top-start" onOpenChange={props.onOpenChange}>
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          aria-label="Message visibility"
        >
          <Show when={props.private} fallback={<GlobeIcon class="size-3.5" />}>
            <LockIcon class="size-3.5" />
          </Show>
          {props.private ? 'Only you' : 'Everyone'}
          <CaretDownIcon class="size-3" />
        </Dropdown.Trigger>
        <Dropdown.Content class="w-72 max-w-[calc(100vw-2rem)]">
          <Dropdown.Group>
            <Dropdown.GroupLabel>Who can see this thread?</Dropdown.GroupLabel>
            <Dropdown.RadioGroup
              value={props.private ? 'private' : 'public'}
              onChange={(value) => props.onChange(value === 'private')}
            >
              <Dropdown.RadioItem
                closeOnSelect
                value="public"
                disabled={props.locked}
                class="items-start"
              >
                <GlobeIcon class="mt-0.5 size-4 shrink-0" />
                <div>
                  <Dropdown.ItemLabel>Everyone</Dropdown.ItemLabel>
                  <Dropdown.ItemDescription class="text-xs text-ink-muted">
                    Visible to people in this conversation.
                  </Dropdown.ItemDescription>
                </div>
              </Dropdown.RadioItem>
              <Dropdown.RadioItem
                closeOnSelect
                value="private"
                class="items-start"
              >
                <LockIcon class="mt-0.5 size-4 shrink-0" />
                <div>
                  <Dropdown.ItemLabel>Only you</Dropdown.ItemLabel>
                  <Dropdown.ItemDescription class="text-xs text-ink-muted">
                    Your message and agent replies stay private and saved in
                    your history.
                  </Dropdown.ItemDescription>
                </div>
              </Dropdown.RadioItem>
            </Dropdown.RadioGroup>
            <Show when={props.locked}>
              <p class="px-3 py-2 text-xs text-ink-muted">
                {props.reason ?? 'Replies inherit this thread’s privacy.'}
              </p>
            </Show>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
      <Show when={props.private}>
        <span class="min-w-0 truncate text-ink-muted">
          {props.newThread
            ? 'Starts a private thread'
            : 'Saved in your history'}
        </span>
      </Show>
    </div>
  );
}
