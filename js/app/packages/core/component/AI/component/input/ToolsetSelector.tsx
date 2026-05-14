import type { ToolSet } from '@service-cognition/generated/schemas';
import { Dropdown, SegmentedControl } from '@ui';
import { Show, type Signal } from 'solid-js';

export type Source = 'chat' | 'channel' | 'document' | 'email' | 'everything';

const SOURCES = [
  { value: 'everything' as const, label: 'ALL' },
  { value: 'chat' as const, label: 'CHATS' },
  { value: 'channel' as const, label: 'CHANNELS' },
  { value: 'document' as const, label: 'DOCUMENTS' },
  { value: 'email' as const, label: 'EMAILS' },
] as const;

const SOURCE_TO_DISPLAY = Object.fromEntries(
  SOURCES.map((s) => [s.value, s.label])
) as Record<Source, string>;

export function ToolsetSelector(props: {
  toolset: Signal<ToolSet>;
  sources: Signal<Source>;
}) {
  const [toolset, _setToolset] = props.toolset;
  const [source, setSource] = props.sources;

  return (
    <div class="flex items-center gap-x-1">
      <Show when={toolset().type === 'all'}>
        <div class="flex">
          <Dropdown>
            <Dropdown.Trigger size="sm">
              <span>SOURCE</span>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content>
                <SegmentedControl
                  size="sm"
                  value={source()}
                  onChange={(s) => setSource(s)}
                  options={SOURCES.map((s) => ({
                    value: s.value,
                    label: s.label,
                  }))}
                />
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown>
          <span class="bg-edge-muted text-ink font-mono text-xs font-medium px-1 flex items-center">
            {SOURCE_TO_DISPLAY[source()]}
          </span>
        </div>
      </Show>
    </div>
  );
}
