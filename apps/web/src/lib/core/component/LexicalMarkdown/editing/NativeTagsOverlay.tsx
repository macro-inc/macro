import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { type ComponentProps, Show } from 'solid-js';
import { TagsMenu } from '../component/menu/TagsMenu';
import type { MenuOperations } from '../shared/inlineMenu';
import { createNativeTagsMenuHost } from './overlay-hosts/native-tags-menu';

export type NativeTagsOptions = Pick<
  ComponentProps<typeof TagsMenu>,
  'applyTargetLabel' | 'isApplied' | 'onApplyTag' | 'portalScope'
>;

/** The shared tags menu over the native search controller and insert command. */
export function NativeTagsOverlay(props: {
  view: EditorView;
  menu: MenuOperations;
  source: NativeTagsOptions;
  alive: () => boolean;
}) {
  const host = createNativeTagsMenuHost(props.view, props.alive);
  return (
    <Show when={props.alive()}>
      <TagsMenu
        host={host}
        menu={props.menu}
        useBlockBoundary={true}
        portalScope={props.source.portalScope}
        applyTargetLabel={props.source.applyTargetLabel}
        isApplied={props.source.isApplied}
        onApplyTag={props.source.onApplyTag}
      />
    </Show>
  );
}
