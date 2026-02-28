import { isMobile } from '@core/mobile/isMobile';
import type { ItemType } from '@service-storage/client';
import { For, Show } from 'solid-js';
import { type BlockTool, ToolButton } from './BlockTool';
import { type FileOperation, SplitFileMenu } from './SplitFileMenu';
import { SplitHeaderRight } from './SplitHeader';
import { SplitToolbarLeft, SplitToolbarRight } from './SplitToolbar';

interface BlockToolbarProps {
  tools: BlockTool[];
  ops: FileOperation[];
  id: string;
  itemType: ItemType;
  name: string;
  formattedName?: string;
}

export function BlockToolbar(props: BlockToolbarProps) {
  return (
    <Show
      when={isMobile()}
      fallback={
        <>
          <Show when={props.ops.length > 0}>
            <SplitToolbarLeft>
              <SplitFileMenu
                id={props.id}
                itemType={props.itemType}
                name={props.name}
                formattedName={props.formattedName}
                ops={props.ops}
              />
            </SplitToolbarLeft>
          </Show>
          <SplitToolbarRight>
            <For each={props.tools}>
              {(tool) => (
                <Show when={!tool.condition || tool.condition()}>
                  {tool.buttonComponent ? (
                    <tool.buttonComponent />
                  ) : (
                    <ToolButton tool={tool} />
                  )}
                </Show>
              )}
            </For>
          </SplitToolbarRight>
        </>
      }
    >
      <SplitHeaderRight>
        <SplitFileMenu
          id={props.id}
          itemType={props.itemType}
          name={props.name}
          formattedName={props.formattedName}
          ops={props.ops}
          tools={props.tools}
        />
      </SplitHeaderRight>
    </Show>
  );
}
