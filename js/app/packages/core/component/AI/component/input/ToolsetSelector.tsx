import DropdownMenu from '@core/component/FormControls/DropdownMenu';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import type { ToolSet } from '@service-cognition/generated/schemas';
import { Show, type Signal } from 'solid-js';

type ToolSetName = ToolSet['type'];

const TOOLSETS = [
  {
    value: 'none' as const,
    label: 'ASK',
    tooltip: 'Simple answers to simple questions',
  },
  {
    value: 'all' as const,
    label: 'AGENT',
    tooltip: 'Dynamically search Macro for useful context',
  },
] as const;

const TOOLSET_TO_DISPLAY = Object.fromEntries(
  TOOLSETS.map((t) => [t.value, t.label])
) as Record<ToolSetName, string>;

const TOOLSET_FROM_DISPLAY = Object.fromEntries(
  TOOLSETS.map((t) => [t.label, { value: t.value, tooltip: t.tooltip }])
) as Record<string, { value: ToolSetName; tooltip: string }>;

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

const SOURCE_FROM_DISPLAY = Object.fromEntries(
  SOURCES.map((s) => [s.label, s.value])
) as Record<string, Source>;

export function ToolsetSelector(props: {
  toolset: Signal<ToolSet>;
  sources: Signal<Source>;
}) {
  const [toolset, setToolset] = props.toolset;
  const [source, setSource] = props.sources;

  return (
    <div class="flex items-center gap-x-1">
      <SegmentedControl
        size="SM"
        defaultValue={TOOLSET_TO_DISPLAY[toolset().type]}
        onChange={(s) => {
          setToolset({
            type: TOOLSET_FROM_DISPLAY[s as keyof typeof TOOLSET_FROM_DISPLAY]
              .value,
          });
        }}
        list={TOOLSETS.map((t) => ({
          value: t.label,
          label: t.label,
          tooltip: t.tooltip,
        }))}
      />

      <Show when={toolset().type === 'all'}>
        <div class="flex">
          <DropdownMenu
            size="SM"
            theme="secondary"
            triggerLabel={<span>SOURCE</span>}
          >
            <SegmentedControl
              defaultValue={SOURCE_TO_DISPLAY[source()]}
              onChange={(s) => {
                setSource(
                  SOURCE_FROM_DISPLAY[s as keyof typeof SOURCE_FROM_DISPLAY]
                );
              }}
              list={SOURCES.map((s) => s.label)}
            />
          </DropdownMenu>
          <span class="bg-edge-muted text-ink font-mono text-xs font-medium px-1 flex items-center">
            {SOURCE_TO_DISPLAY[source()]}
          </span>
        </div>
      </Show>
    </div>
  );
}
