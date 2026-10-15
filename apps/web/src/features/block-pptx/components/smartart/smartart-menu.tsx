/**
 * The SmartArt part of the slide's right-click menu: Add Shape, Change
 * Layout, Change Colors, Reset Graphic, and Convert to Shapes or Text.
 */

import {
  ContextMenuContent,
  MenuItem,
  SubTrigger,
} from '@core/component/ContextMenu';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg';
import Palette from '@icon/system/regular/palette.svg';
import PlusSquare from '@icon/system/regular/plus-square.svg';
import Swap from '@icon/system/regular/swap.svg';
import TextAa from '@icon/system/regular/text-aa.svg';
import TreeStructure from '@icon/system/regular/tree-structure.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { For, type JSX } from 'solid-js';
import { colorGroups, shortId } from '../../core/smartart';
import type { SmartArtState } from '../../primitives/create-smart-art';

function Sub(props: {
  text: string;
  icon?: JSX.Element;
  disabled?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <ContextMenu.Sub overlap gutter={2}>
      <SubTrigger
        text={props.text}
        icon={props.icon}
        disabled={props.disabled}
      />
      <ContextMenu.Portal>
        <ContextMenuContent submenu class={props.class ?? 'w-56'}>
          {props.children}
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}

const ADD = [
  { position: 'after', text: 'Add Shape After' },
  { position: 'before', text: 'Add Shape Before' },
  { position: 'above', text: 'Add Shape Above' },
  { position: 'below', text: 'Add Shape Below' },
  { position: 'assistant', text: 'Add Assistant' },
] as const;

export function SmartArtMenuItems(props: {
  smartArt: SmartArtState;
  readonly: boolean;
}) {
  const s = () => props.smartArt;
  const outline = () => s().outline();
  const ro = () => props.readonly;
  const supported = () => !!outline()?.layout.supported;
  const org = () => shortId(outline()?.layout.id ?? '') === 'orgChart1';
  const catalog = () => s().catalog();
  return (
    <>
      <Sub
        text="Add Shape"
        icon={<PlusSquare class="size-4" />}
        disabled={ro() || !supported()}
      >
        <For
          each={ADD.filter(
            (a) =>
              (a.position !== 'assistant' || org()) &&
              (a.position === 'after' || !!s().activeNode())
          )}
        >
          {(a) => (
            <MenuItem
              text={a.text}
              onClick={() => void s().addNode(a.position)}
            />
          )}
        </For>
      </Sub>
      <Sub
        text="Change Layout"
        icon={<TreeStructure class="size-4" />}
        disabled={ro()}
      >
        <For each={catalog()?.layouts ?? []}>
          {(layout) => (
            <MenuItem
              text={layout.name}
              selectorType="radio"
              value={layout.short}
              groupValue={shortId(outline()?.layout.id ?? '')}
              onClick={() => void s().setLayout(layout.short)}
            />
          )}
        </For>
      </Sub>
      <Sub
        text="Change Colors"
        icon={<Palette class="size-4" />}
        disabled={ro()}
        class="max-h-[60vh] w-64 overflow-y-auto"
      >
        <For each={colorGroups(catalog())}>
          {(group) => (
            <>
              <div class="px-2 pt-1.5 pb-0.5 font-medium text-ink-muted text-xs">
                {group.label}
              </div>
              <For each={group.items}>
                {(item) => (
                  <MenuItem
                    text={item.name}
                    selectorType="radio"
                    value={item.short}
                    groupValue={shortId(outline()?.colors ?? '')}
                    onClick={() => void s().setColors(item.short)}
                  />
                )}
              </For>
            </>
          )}
        </For>
      </Sub>
      <MenuItem
        text="Reset Graphic"
        icon={ArrowCounterClockwise}
        disabled={ro() || !supported()}
        onClick={() => void s().reset()}
      />
      <MenuItem
        text="Convert to Shapes"
        icon={Swap}
        disabled={ro()}
        onClick={() => void s().convert('shapes')}
      />
      <MenuItem
        text="Convert to Text"
        icon={TextAa}
        disabled={ro()}
        onClick={() => void s().convert('text')}
      />
    </>
  );
}
