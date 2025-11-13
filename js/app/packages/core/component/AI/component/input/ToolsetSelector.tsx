import DropdownMenu from '@core/component/FormControls/DropdownMenu';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { Tooltip } from '@core/component/Tooltip';
import type { ToolSet } from '@service-cognition/generated/schemas';
import { type ParentProps, Show, type Signal } from 'solid-js';

type ToolSetName = ToolSet['type'];

const TOOLSET_TO_DISPLAY = {
  none: 'ASK',
  all: 'AGENT',
} as const satisfies Record<ToolSetName, string>;

const TOOLSET_FROM_DISPLAY = {
  ASK: 'none',
  AGENT: 'all',
} as const satisfies Record<string, ToolSetName>;

export type Source = 'chat' | 'channel' | 'document' | 'email' | 'everything';

const SOURCE_TO_DISPLAY = {
  everything: 'ALL',
  chat: 'CHATS',
  channel: 'CHANNELS',
  document: 'DOCUMENTS',
  email: 'EMAILS',
} as const satisfies Record<Source, string>;

const SOURCE_FROM_DISPLAY = {
  ALL: 'everything',
  CHATS: 'chat',
  CHANNELS: 'channel',
  DOCUMENTS: 'document',
  EMAILS: 'email',
} as const satisfies Record<string, Source>;

export function ToolsetSelector(props: {
  toolset: Signal<ToolSet>;
  sources: Signal<Source>;
}) {
  const [toolset, setToolset] = props.toolset;
  const [source, setSource] = props.sources;

  const StyledTriggerLabel = (props: ParentProps) => {
    return (
      <span class="text-[.85rem] font-medium font-mono">
        <Tooltip
          tooltip={"Tell the agent which sources to consider in it's search"}
        >
          {props.children}
        </Tooltip>
      </span>
    );
  };
  return (
    <div class="flex items-center gap-x-1">
      <SegmentedControl
        defaultValue={TOOLSET_TO_DISPLAY[toolset().type]}
        onChange={(s) => {
          setToolset({
            type: TOOLSET_FROM_DISPLAY[s as keyof typeof TOOLSET_FROM_DISPLAY],
          });
        }}
        list={Object.keys(TOOLSET_FROM_DISPLAY)}
      />

      <Show when={toolset().type === 'all'}>
        <div class="flex">
          <DropdownMenu
            theme="secondary"
            triggerLabel={<StyledTriggerLabel>Source</StyledTriggerLabel>}
          >
            <SegmentedControl
              defaultValue={SOURCE_TO_DISPLAY[source()]}
              onChange={(s) => {
                setSource(
                  SOURCE_FROM_DISPLAY[s as keyof typeof SOURCE_FROM_DISPLAY]
                );
              }}
              list={Object.keys(SOURCE_FROM_DISPLAY)}
            />
          </DropdownMenu>

          <span class="bg-accent text-panel font-mono text-xs font-medium p-1">
            {SOURCE_TO_DISPLAY[source()]}
          </span>
        </div>
      </Show>
    </div>
  );
}
