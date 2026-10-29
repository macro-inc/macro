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
import type { Op, TextLayer } from '@core/psd-engine/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { gestureKey, newLayerOp } from '../core/ops';
import {
  defaultTextStyle,
  fromPsText,
  pointText,
  retext,
  textLayerName,
} from '../core/text';
import type { PsdEditor } from '../primitives/create-psd-editor';
import type { PsdView } from '../primitives/create-psd-view';
import { createSerialQueue } from '../primitives/serial-queue';

export type TypeTarget = { layer: number } | { at: Point };

export function TextEditor(props: {
  editor: PsdEditor;
  view: PsdView;
  target: TypeTarget;
  /** New text typed before the box opened. */
  initialText?: string;
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
  const [editing, setEditing] = createSignal(layerId !== undefined);
  let layer: TextLayer | undefined;
  let created = false;
  /**
   * The layer's name while it is the one its text gives it: typing keeps
   * it in step. Undefined once someone named the layer themselves.
   */
  let autoName: string | undefined;
  let input!: HTMLTextAreaElement;
  let finished = false;

  onMount(() => {
    const load = async () => {
      if (layerId !== undefined) {
        let info: Awaited<ReturnType<typeof editor.engine.layerInfo>>;
        try {
          info = await editor.engine.layerInfo(layerId);
        } catch (error) {
          Telemetry.error(error, { surface: 'psd-editor' });
          // Nothing was typed: finishing now would delete the layer.
          finished = true;
          props.onDone();
          return;
        }
        if (!info?.text) {
          props.onDone();
          return;
        }
        layer = info.text;
        if (info.name === textLayerName(info.text.text)) autoName = info.name;
        setValue(fromPsText(info.text.text));
        const b = info.bounds;
        if (b) setAnchor({ x: b.x, y: b.y + b.h });
        props.onLayer?.(layerId);
      }
      input.focus();
      input.select();
      if (props.initialText) update(props.initialText);
    };
    fireAndForget(load(), 'psd-editor');
  });

  const update = (text: string) => {
    setValue(text);
    fireAndForget(
      queue.run(async () => {
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
          autoName = textLayerName(next.text);
          setEditing(created);
          props.onLayer?.(layerId);
          return;
        }
        if (!layer) return;
        const next = retext(layer, text);
        layer = next;
        const ops: Op[] = [{ op: 'setText', id: layerId, text: next }];
        const name = textLayerName(next.text);
        if (autoName !== undefined && name.length > 0 && name !== autoName) {
          ops.push({ op: 'setLayer', ids: [layerId], name });
          autoName = name;
        }
        await editor.apply(ops, key);
      }),
      'psd-editor'
    );
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
    if (!finished) fireAndForget(finish(), 'psd-editor');
  });

  const at = () => pageToScreen(view.camera(), anchor());

  return (
    <div
      class="menu-surface absolute z-20 w-72 p-2"
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
            fireAndForget(finish(), 'psd-editor');
          }
        }}
        onBlur={() => fireAndForget(finish(), 'psd-editor')}
      />
      <div class="mt-1 flex items-center justify-between text-[11px] text-ink-muted">
        <Show when={editing()} fallback={<span>New text</span>}>
          <span>Editing text</span>
        </Show>
        <span>Esc or {IS_MAC ? '⌘' : 'Ctrl'}↵ to finish</span>
      </div>
    </div>
  );
}
