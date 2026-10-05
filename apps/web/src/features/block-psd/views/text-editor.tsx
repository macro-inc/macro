/**
 * Typing with the Type tool: a text box under the text being edited (or at
 * the click that starts new point text). Each keystroke lays the layer out
 * again in the engine, so the canvas shows the text as it is typed; the
 * typing is one undo step. New text becomes a layer at its first
 * character; text emptied when typing ends is removed, as in Photoshop.
 * Escape or ⌘/Ctrl+Enter ends typing.
 */

import { type Point, pageToScreen } from '@app/features/block-fig/core/camera';
import { IS_MAC } from '@core/constant/isMac';
import type { TextLayer } from '@core/psd-engine/types';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { gestureKey, newLayerOp } from '../core/ops';
import { defaultTextStyle, fromPsText, pointText, retext } from '../core/text';
import type { PsdEditor } from '../primitives/create-psd-editor';
import type { PsdView } from '../primitives/create-psd-view';
import { createSerialQueue } from '../primitives/serial-queue';

export type TypeTarget = { layer: number } | { at: Point };

export function TextEditor(props: {
  editor: PsdEditor;
  view: PsdView;
  target: TypeTarget;
  /** The layer being typed into, once there is one (for presence). */
  onLayer?: (id: number | undefined) => void;
  onDone: () => void;
}) {
  const { editor, view } = props;
  const key = gestureKey('type', Math.floor(Math.random() * 1e9));
  const queue = createSerialQueue(() => {});
  const [value, setValue] = createSignal('');
  const [anchor, setAnchor] = createSignal<Point>(
    'at' in props.target ? props.target.at : { x: 0, y: 0 }
  );
  let layerId: number | undefined =
    'layer' in props.target ? props.target.layer : undefined;
  let layer: TextLayer | undefined;
  let created = false;
  let input!: HTMLTextAreaElement;
  let finished = false;

  onMount(() => {
    const load = async () => {
      if (layerId !== undefined) {
        const info = await editor.engine.layerInfo(layerId);
        if (!info?.text) {
          props.onDone();
          return;
        }
        layer = info.text;
        setValue(fromPsText(info.text.text));
        const b = info.bounds;
        if (b) setAnchor({ x: b.x, y: b.y + b.h });
        props.onLayer?.(layerId);
      }
      input.focus();
      input.select();
    };
    void load();
  });

  const update = (text: string) => {
    setValue(text);
    void queue.run(async () => {
      if (layerId === undefined) {
        if (text.length === 0 || !('at' in props.target)) return;
        const options = view.toolOptions();
        const next = pointText(text, props.target.at, {
          ...defaultTextStyle(view.foreground(), options.fontSize),
          font: options.font,
        });
        const result = await editor.apply(
          [newLayerOp(editor.activeRow(), { type: 'text', text: next })],
          key
        );
        layerId = result?.created[0];
        layer = next;
        created = layerId !== undefined;
        props.onLayer?.(layerId);
        return;
      }
      if (!layer) return;
      const next = retext(layer, text);
      layer = next;
      await editor.apply([{ op: 'setText', id: layerId, text: next }], key);
    });
  };

  const finish = async () => {
    if (finished) return;
    finished = true;
    await queue.idle();
    // Emptied text is removed.
    if (layerId !== undefined && value().trim().length === 0)
      await editor.apply(
        [{ op: 'delete', ids: [layerId] }],
        created ? key : undefined
      );
    props.onLayer?.(undefined);
    props.onDone();
  };

  onCleanup(() => {
    if (!finished) void finish();
  });

  const at = () => pageToScreen(view.camera(), anchor());

  return (
    <div
      class="absolute z-20 w-72 rounded-lg border border-edge-muted bg-menu p-2 shadow-lg"
      style={{
        left: `${Math.max(8, at().x)}px`,
        top: `${Math.max(8, at().y + 8)}px`,
      }}
      data-testid="psd-text-editing"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <textarea
        ref={input}
        class="h-20 w-full resize-none rounded border border-edge-muted bg-input p-1.5 text-ink text-sm outline-none focus:border-edge-focus"
        placeholder="Type…"
        value={value()}
        data-testid="psd-text-input"
        onInput={(e) => update(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          const mod = IS_MAC ? e.metaKey : e.ctrlKey;
          if (e.key === 'Escape' || (e.key === 'Enter' && mod)) {
            e.preventDefault();
            void finish();
          }
        }}
        onBlur={() => void finish()}
      />
      <div class="mt-1 flex items-center justify-between text-[11px] text-ink-muted">
        <Show
          when={created || layerId !== undefined}
          fallback={<span>New text</span>}
        >
          <span>Editing text</span>
        </Show>
        <span>Esc or {IS_MAC ? '⌘' : 'Ctrl'}↵ to finish</span>
      </div>
    </div>
  );
}
