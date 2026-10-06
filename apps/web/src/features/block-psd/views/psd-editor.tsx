/**
 * The Photoshop editor: the menu bar and options bar above, the tools at
 * the left, the canvas in the middle, and the Color, Properties, and
 * Layers panels at the right; Photoshop's keyboard shortcuts throughout,
 * and other people's pointers, selections, and avatars when the document
 * is shared.
 */

import { type Point, zoomLabel } from '@app/features/block-fig/core/camera';
import { paletteColor } from '@app/features/block-fig/primitives/create-peer-overlays';
import { IS_MAC } from '@core/constant/isMac';
import type { IRect } from '@core/psd-engine/types';
import ArrowUUpLeft from '@phosphor/arrow-u-up-left.svg';
import ArrowUUpRight from '@phosphor/arrow-u-up-right.svg';
import CloudArrowUp from '@phosphor/cloud-arrow-up.svg';
import CloudCheck from '@phosphor/cloud-check.svg';
import Keyboard from '@phosphor/keyboard.svg';
import WarningCircle from '@phosphor/warning-circle.svg';
import { Button } from '@ui/components/Button';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import { ColorPicker, ColorTargetSwitch } from '../components/color-picker';
import {
  AdjustDialog,
  CanvasSizeDialog,
  FilterDialog,
  ImageSizeDialog,
  NumberDialog,
  ShortcutsDialog,
} from '../components/dialogs';
import { MenuBar } from '../components/menu-bar';
import { NoticeBanner } from '../components/notice-banner';
import { OptionsBar } from '../components/options-bar';
import { PanelTabs } from '../components/panel-tabs';
import {
  FollowFrame,
  PeerAvatars,
  PeerCursors,
} from '../components/peer-presence';
import { Toolbar } from '../components/toolbar';
import { usePsdEditorContext } from '../context/psd-editor-context';
import { shareSelection, storesFile } from '../core/presence';
import { EDIT_COMMANDS, type KeyAction, keyAction } from '../core/shortcuts';
import type { DocSize } from '../core/tiles';
import { EDIT_TOOLS, PAINT_TOOLS, TOOL_GROUPS, type Tool } from '../core/tools';
import { degrees } from '../core/transform';
import { createCanvasTools } from '../primitives/create-canvas-tools';
import { createPsdCommands } from '../primitives/create-psd-commands';
import { createPsdEditor } from '../primitives/create-psd-editor';
import { createPsdView } from '../primitives/create-psd-view';
import { LayersPanel } from './layers-panel';
import { buildMenus } from './menus';
import { PropertiesPanel } from './properties-panel';
import { PsdCanvas } from './psd-canvas';
import { TextEditor, type TypeTarget } from './text-editor';

/** Why a document can't be edited as it is (its color mode or depth). */
function readOnlyReason(mode: string, depth: number): string {
  const name = match(mode)
    .with('cmyk', () => 'CMYK')
    .with('lab', () => 'Lab')
    .with('multichannel', () => 'Multichannel')
    .with('indexed', () => 'Indexed Color')
    .with('bitmap', () => 'Bitmap')
    .with('duotone', () => 'Duotone')
    .otherwise(() => `${depth}-bit`);
  return `This document is in ${name} mode, which opens for viewing. Convert it to 8-bit RGB to edit it.`;
}

export function PsdEditor() {
  const context = usePsdEditorContext();
  const { engine } = context;
  const collab = context.collaboration;
  const sharing = context.sharing;

  /** The canvas size the view last fitted. */
  let shownSize: DocSize = {
    width: engine.summary.width,
    height: engine.summary.height,
  };
  let compositor:
    | {
        invalidate: (r: IRect) => void;
        reset: (d: DocSize) => void;
        idle: () => boolean;
      }
    | undefined;
  const editor = createPsdEditor({
    engine,
    canEdit: context.canEdit,
    save: context.save,
    sharing,
    stores: collab
      ? () =>
          storesFile(
            { peerId: collab.peerId, editor: context.canEdit() },
            collab.peers()
          )
      : undefined,
    online: collab ? () => collab.status() === 'connected' : undefined,
    notifyError: context.notifyError,
    onDirty: (rect) => compositor?.invalidate(rect),
    onReset: (doc) => {
      compositor?.reset(doc);
      // A crop or resize: show the new canvas, as Photoshop does.
      if (doc.width !== shownSize.width || doc.height !== shownSize.height)
        view.fitDocument();
      shownSize = doc;
    },
  });
  const view = createPsdView({ docSize: editor.docSize });
  const [spaceHeld, setSpaceHeld] = createSignal(false);
  const [typing, setTyping] = createSignal<TypeTarget>();
  const [typingLayer, setTypingLayer] = createSignal<number>();
  const [showShortcuts, setShowShortcuts] = createSignal(false);
  const [colorTarget, setColorTarget] = createSignal<
    'foreground' | 'background'
  >('foreground');
  const [panel, setPanel] = createSignal<'properties' | 'color'>('properties');
  /** A swatch was clicked: the Color panel edits that color. */
  const pickColor = (which: 'foreground' | 'background') => {
    setColorTarget(which);
    setPanel('color');
  };
  const tools = createCanvasTools({
    editor,
    view,
    notifyError: context.notifyError,
    panning: spaceHeld,
    onType: (target) => setTyping(target),
  });
  const commands = createPsdCommands({
    editor,
    view,
    tools,
    fileName: context.fileName,
    download: context.download,
    notifyError: context.notifyError,
    notifyInfo: context.notifyInfo,
    onDialogClosed: () => root.focus({ preventScroll: true }),
  });
  let root!: HTMLDivElement;

  onMount(() => {
    void editor.start();
    if (document.activeElement === document.body)
      root.focus({ preventScroll: true });
  });

  const chooseTool = (tool: Tool) => {
    if (typing()) setTyping(undefined);
    view.setTool(tool);
    tools.toolChanged(tool);
  };

  // ---- keys ------------------------------------------------------------------

  const runKey = (action: KeyAction): boolean =>
    match(action)
      .with({ t: 'tool' }, (a) => {
        const group = TOOL_GROUPS.find((g) => g.key === a.key);
        const next = view.chooseToolKey(a.key, a.cycle);
        if (!next) return false;
        if (EDIT_TOOLS.has(next) && !editor.enabled()) {
          // Viewers keep the tool they had.
          view.setTool(group?.tools.find((t) => !EDIT_TOOLS.has(t)) ?? 'hand');
          return true;
        }
        tools.toolChanged(next);
        return true;
      })
      .with({ t: 'nudge' }, (a) => {
        if (!tools.transforming() && view.tool() !== 'move') return false;
        if (!editor.enabled()) return false;
        tools.nudge(a.dx, a.dy);
        return true;
      })
      .with({ t: 'opacity' }, (a) => {
        if (!editor.enabled()) return false;
        const value = a.value === 0 ? 1 : a.value / 10;
        if (PAINT_TOOLS.has(view.tool())) view.setBrush({ opacity: value });
        else if (editor.selected().length > 0)
          void editor.apply([
            {
              op: 'setLayer',
              ids: editor.selected(),
              opacity: Math.round(value * 255),
            },
          ]);
        return true;
      })
      .with({ t: 'command' }, (a) => {
        if (EDIT_COMMANDS.has(a.command) && !editor.enabled()) return false;
        return match(a.command)
          .with('commit', () => tools.commit())
          .with('cancel', () => {
            if (typing()) {
              setTyping(undefined);
              return true;
            }
            if (showShortcuts()) {
              setShowShortcuts(false);
              return true;
            }
            return tools.cancel();
          })
          .with('shortcuts', () => {
            setShowShortcuts((s) => !s);
            return true;
          })
          .with('featherSelection', () => {
            if (!editor.hasSelection()) return false;
            commands.run.openDialog({ kind: 'feather' });
            return true;
          })
          .with('delete', () => {
            if (editor.selected().length === 0 && !editor.hasSelection())
              return false;
            commands.run.delete();
            return true;
          })
          .otherwise((command) => {
            const run = commands.run[command] as (() => void) | undefined;
            if (!run) return false;
            run();
            return true;
          });
      })
      .exhaustive();

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]'))
      return;
    if (target.closest('[role="menu"], [role="dialog"]')) return;
    if (commands.dialog()) return;
    if (e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      setSpaceHeld(true);
      return;
    }
    const action = keyAction(e, IS_MAC);
    if (!action) return;
    // ⌘V goes through the paste event, which carries pasted images.
    if (!runKey(action)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * Keys pressed in the editor reach it before the app's hotkeys (which
   * listen on the document while capturing), so where they overlap the
   * editor's shortcuts win, as in Photoshop: V, M, B, T, ⌘Z, ⌘T… Keys it
   * does not use go on to the app (⌘K, ⌘S…).
   */
  onMount(() => {
    // The editor keeps the keys when the control that had them went away
    // or was disabled (focus falls back to the page), as long as the last
    // press was in the editor.
    let pressedInside = true;
    const onWindowPointerDown = (e: PointerEvent) => {
      pressedInside = e.target instanceof Node && root.contains(e.target);
    };
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (!(e.target instanceof Node)) return;
      const ours =
        root.contains(e.target) ||
        (pressedInside && e.target === document.body && root.isConnected);
      if (!ours) return;
      onKeyDown(e);
    };
    const onWindowKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    const release = () => setSpaceHeld(false);
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    window.addEventListener('keydown', onWindowKeyDown, true);
    window.addEventListener('keyup', onWindowKeyUp, true);
    window.addEventListener('blur', release);
    onCleanup(() => {
      window.removeEventListener('pointerdown', onWindowPointerDown, true);
      window.removeEventListener('keydown', onWindowKeyDown, true);
      window.removeEventListener('keyup', onWindowKeyUp, true);
      window.removeEventListener('blur', release);
    });
  });

  // Pasting images places them as layers; otherwise the last copy here.
  const onPaste = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (!editor.enabled()) return;
    e.preventDefault();
    const files = [...(e.clipboardData?.files ?? [])].filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length === 0) {
      void commands.paste();
      return;
    }
    for (const file of files) void commands.paste(file);
  };

  const dropFiles = async (files: File[], at: Point) => {
    for (const file of files)
      await commands.placeImage(
        await file.arrayBuffer(),
        file.name.replace(/\.[^.]+$/, '') || 'Layer',
        at
      );
  };

  // ---- other people ----------------------------------------------------------

  const [pointer, setPointer] = createSignal<Point | null>(null);
  const [following, setFollowing] = createSignal<string>();
  const followed = () => collab?.peers().find((p) => p.peerId === following());

  // Presence goes to the sync service (an external system).
  createEffect(() => {
    if (!collab) return;
    const c = view.camera();
    const v = view.viewport();
    collab.setPresence({
      session: sharing?.session ?? 0,
      cursor: pointer(),
      layers: editor.selected(),
      selection: shareSelection(editor.selection()),
      tool: view.tool(),
      editor: editor.enabled(),
      view:
        v.w > 0 ? { x: c.x, y: c.y, w: v.w / c.zoom, h: v.h / c.zoom } : null,
      editing: typingLayer() ?? null,
    });
  });

  // Following someone shows what they see.
  createEffect(
    on(followed, (peer) => {
      const area = peer?.presence.view;
      if (area) view.zoomToRect(area);
    })
  );

  const peerSelections = createMemo(() =>
    (collab?.peers() ?? []).flatMap((p) =>
      p.presence.selection
        ? [{ color: paletteColor(p.color), selection: p.presence.selection }]
        : []
    )
  );

  // ---- what shows ----------------------------------------------------------

  const summary = () => editor.summary();
  const notEditable = () =>
    !summary().editable
      ? readOnlyReason(summary().mode, summary().depth)
      : undefined;
  // The fonts the document's text uses, for the Properties panel.
  const [fonts, setFonts] = createSignal<string[]>([]);
  let fontsTimer: ReturnType<typeof setTimeout> | undefined;
  const loadFonts = async () => {
    try {
      setFonts([...new Set((await engine.fonts()).map((f) => f.family))]);
    } catch {
      setFonts([]);
    }
  };
  createEffect(
    on([editor.ready, editor.editVersion], ([ready]) => {
      if (!ready) return;
      clearTimeout(fontsTimer);
      fontsTimer = setTimeout(() => void loadFonts(), 400);
    })
  );
  onCleanup(() => clearTimeout(fontsTimer));

  const pending = () => {
    if (tools.transforming()) {
      const t = tools.overlay().transform?.box;
      const detail = t
        ? `W ${Math.round((Math.abs(t.w) / Math.max(1, t.start.w)) * 100)}% · H ${Math.round((Math.abs(t.h) / Math.max(1, t.start.h)) * 100)}% · ${degrees(t)}°`
        : undefined;
      return { label: 'Free Transform', detail };
    }
    if (tools.cropping() && view.tool() === 'crop') {
      const c = tools.overlay().crop;
      return { label: 'Crop', detail: c ? `${c.w} × ${c.h} px` : undefined };
    }
    return undefined;
  };

  const menus = () => buildMenus({ editor, view, commands, mac: IS_MAC });

  const filterDialog = () => {
    const d = commands.dialog();
    return d?.kind === 'filter' ? d : undefined;
  };
  const adjustDialog = () => {
    const d = commands.dialog();
    return d?.kind === 'adjust' ? d : undefined;
  };
  const expandDialog = () => {
    const d = commands.dialog();
    return d?.kind === 'expand' ? d : undefined;
  };

  /** The operations the canvas previews now (a dialog's). */
  let previewed: string | undefined;
  const preview = (ops: Parameters<typeof editor.apply>[0] | null) => {
    previewed = ops ? JSON.stringify(ops) : undefined;
    if (ops) void editor.preview(ops);
    else void editor.cancelPreview();
  };
  /** Keeps the preview when it shows these operations, else applies them. */
  const applyPreviewed = async (ops: Parameters<typeof editor.apply>[0]) => {
    const same = editor.previewing() && previewed === JSON.stringify(ops);
    previewed = undefined;
    if (same) {
      await editor.commitPreview();
      return;
    }
    if (editor.previewing()) await editor.cancelPreview();
    await editor.apply(ops);
  };

  return (
    <div
      ref={root}
      tabIndex={-1}
      class="relative flex size-full min-h-0 flex-col bg-page text-ink outline-none"
      data-testid="psd-editor"
      onPaste={onPaste}
    >
      <NoticeBanner
        warnings={engine.warnings}
        readOnlyReason={notEditable()}
        onConvert={context.canEdit() ? commands.run.convertToRgb : undefined}
      />
      <div class="flex h-9 shrink-0 items-center gap-2 border-edge-muted border-b bg-panel px-2">
        <MenuBar menus={menus()} />
        <span class="flex-1" />
        <Show when={editor.enabled()}>
          <Button
            variant="ghost"
            size="icon-sm"
            label="Undo"
            tooltip={`Undo · ${IS_MAC ? '⌘Z' : 'Ctrl+Z'}`}
            disabled={!editor.canUndo()}
            data-testid="psd-undo"
            onClick={() => void editor.undo()}
          >
            <ArrowUUpLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            label="Redo"
            tooltip={`Redo · ${IS_MAC ? '⇧⌘Z' : 'Ctrl+⇧Z'}`}
            disabled={!editor.canRedo()}
            data-testid="psd-redo"
            onClick={() => void editor.redo()}
          >
            <ArrowUUpRight />
          </Button>
          <span
            class="flex size-6 items-center justify-center text-ink-muted"
            data-testid="psd-save-state"
            data-state={editor.saveState()}
            title={match(editor.saveState())
              .with('saved', () => 'All changes saved')
              .with('unsaved', () => 'Unsaved changes')
              .with('saving', () => 'Saving…')
              .with('error', () => 'Save failed')
              .exhaustive()}
          >
            {match(editor.saveState())
              .with('saved', () => <CloudCheck class="size-4" />)
              .with('error', () => (
                <WarningCircle class="size-4 text-failure" />
              ))
              .otherwise(() => (
                <CloudArrowUp class="size-4 animate-pulse" />
              ))}
          </span>
        </Show>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Keyboard shortcuts"
          tooltip={`Keyboard shortcuts · ${IS_MAC ? '⌘/' : 'Ctrl+/'}`}
          onClick={() => setShowShortcuts((s) => !s)}
        >
          <Keyboard />
        </Button>
      </div>
      <OptionsBar
        tool={view.tool()}
        brush={view.brush()}
        options={view.toolOptions()}
        pending={pending()}
        onBrush={view.setBrush}
        onOptions={view.setToolOptions}
        onCommit={() => void tools.commit()}
        onCancel={() => void tools.cancel()}
      >
        <Button
          variant="ghost"
          size="xs"
          tooltip={`Fit on Screen · ${IS_MAC ? '⌘0' : 'Ctrl+0'}`}
          data-testid="psd-zoom-fit"
          onClick={() => commands.run.zoomFit()}
        >
          Fit Screen
        </Button>
        <Button
          variant="ghost"
          size="xs"
          tooltip={`100% · ${IS_MAC ? '⌘1' : 'Ctrl+1'}`}
          data-testid="psd-zoom-100"
          onClick={() => commands.run.zoom100()}
        >
          100%
        </Button>
      </OptionsBar>
      <div class="flex min-h-0 flex-1">
        <Toolbar
          tool={view.tool()}
          shown={view.shownTool}
          editable={editor.enabled()}
          foreground={view.foreground()}
          background={view.background()}
          onTool={chooseTool}
          onSwapColors={view.swapColors}
          onResetColors={view.resetColors}
          onPickColor={pickColor}
        />
        <div class="relative min-w-0 flex-1">
          <PsdCanvas
            editor={editor}
            view={view}
            tools={tools}
            onCompositor={(hooks) => {
              compositor = hooks;
            }}
            peerSelections={collab ? peerSelections : undefined}
            guides={() => summary().guides}
            onPointer={collab ? setPointer : undefined}
            onDropFiles={
              editor.enabled()
                ? (files, at) => void dropFiles(files, at)
                : undefined
            }
          >
            <Show when={collab}>
              {(c) => (
                <PeerCursors peers={c().peers()} camera={view.camera()} />
              )}
            </Show>
            <Show when={typing()} keyed>
              {(target) => (
                <TextEditor
                  editor={editor}
                  view={view}
                  target={target}
                  onLayer={setTypingLayer}
                  onDone={() => {
                    setTyping(undefined);
                    root.focus({ preventScroll: true });
                  }}
                />
              )}
            </Show>
            <Show when={!editor.ready()}>
              <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-ink-muted text-sm">
                Opening…
              </div>
            </Show>
            <div
              class="pointer-events-none absolute bottom-2 left-2 rounded-md bg-menu/90 px-2 py-0.5 text-[11px] text-ink-muted tabular-nums shadow-sm"
              data-testid="psd-status"
            >
              <span data-testid="psd-zoom">
                {zoomLabel(view.camera().zoom)}
              </span>{' '}
              · {summary().width} × {summary().height} px
            </div>
          </PsdCanvas>
          <Show when={collab}>
            {(c) => (
              <PeerAvatars
                peers={c().peers()}
                following={following()}
                onFollow={setFollowing}
                status={c().status()}
              />
            )}
          </Show>
          <Show when={followed()}>
            {(peer) => (
              <FollowFrame
                peer={peer()}
                onStop={() => setFollowing(undefined)}
              />
            )}
          </Show>
          <Show when={showShortcuts()}>
            <ShortcutsDialog
              mac={IS_MAC}
              onClose={() => setShowShortcuts(false)}
            />
          </Show>
        </div>
        <aside
          class="flex w-72 shrink-0 flex-col overflow-hidden border-edge-muted border-l bg-panel"
          data-testid="psd-panels"
        >
          <div class="flex max-h-[45%] shrink-0 flex-col border-edge-muted border-b">
            <PanelTabs
              tabs={[
                {
                  value: 'properties',
                  label: 'Properties',
                  testId: 'psd-tab-properties',
                },
                { value: 'color', label: 'Color', testId: 'psd-tab-color' },
              ]}
              value={panel()}
              onChange={setPanel}
            />
            <div class="min-h-0 overflow-y-auto">
              <Show
                when={panel() === 'color'}
                fallback={
                  <PropertiesPanel
                    editor={editor}
                    documentFonts={fonts()}
                    onEditText={(id) => setTyping({ layer: id })}
                  />
                }
              >
                <div
                  class="flex flex-col gap-2 px-3 py-2.5"
                  data-testid="psd-color-panel"
                >
                  <ColorTargetSwitch
                    target={colorTarget()}
                    foreground={view.foreground()}
                    background={view.background()}
                    onTarget={setColorTarget}
                  />
                  <ColorPicker
                    color={
                      colorTarget() === 'foreground'
                        ? view.foreground()
                        : view.background()
                    }
                    testId="psd-color"
                    onChange={(c) =>
                      colorTarget() === 'foreground'
                        ? view.setForeground(c)
                        : view.setBackground(c)
                    }
                  />
                </div>
              </Show>
            </div>
          </div>
          <LayersPanel editor={editor} commands={commands} />
        </aside>
      </div>
      <Switch>
        <Match when={commands.dialog()?.kind === 'imageSize'}>
          <ImageSizeDialog
            width={summary().width}
            height={summary().height}
            onCancel={commands.closeDialog}
            onApply={(width, height, interpolation) => {
              commands.closeDialog();
              void editor.apply([
                { op: 'imageSize', width, height, interpolation },
              ]);
            }}
          />
        </Match>
        <Match when={commands.dialog()?.kind === 'canvasSize'}>
          <CanvasSizeDialog
            width={summary().width}
            height={summary().height}
            onCancel={commands.closeDialog}
            onApply={(width, height, anchor) => {
              commands.closeDialog();
              void editor.apply([{ op: 'canvasSize', width, height, anchor }]);
            }}
          />
        </Match>
        <Match when={filterDialog()}>
          {(d) => (
            <FilterDialog
              filter={d().filter}
              onPreview={(spec) =>
                preview(spec ? commands.filterOp(spec) : null)
              }
              onCancel={() => {
                commands.closeDialog();
                preview(null);
              }}
              onApply={(spec) => {
                commands.closeDialog();
                void applyPreviewed(commands.filterOp(spec));
              }}
            />
          )}
        </Match>
        <Match when={adjustDialog()}>
          {(d) => (
            <AdjustDialog
              adjustment={d().adjustment}
              onPreview={(adjustment) =>
                preview(
                  adjustment
                    ? commands.filterOp({ type: 'adjust', adjustment })
                    : null
                )
              }
              onCancel={() => {
                commands.closeDialog();
                preview(null);
              }}
              onApply={(adjustment) => {
                commands.closeDialog();
                void applyPreviewed(
                  commands.filterOp({ type: 'adjust', adjustment })
                );
              }}
            />
          )}
        </Match>
        <Match when={commands.dialog()?.kind === 'feather'}>
          <NumberDialog
            title="Feather Selection"
            label="Radius"
            unit="px"
            value={5}
            min={0.1}
            max={1000}
            testId="psd-feather-dialog"
            onCancel={commands.closeDialog}
            onApply={(radius) => {
              commands.closeDialog();
              void editor.select({ type: 'feather', radius });
            }}
          />
        </Match>
        <Match when={expandDialog()}>
          {(d) => (
            <NumberDialog
              title={d().contract ? 'Contract Selection' : 'Expand Selection'}
              label={d().contract ? 'Contract by' : 'Expand by'}
              unit="px"
              value={2}
              min={1}
              max={500}
              testId="psd-expand-dialog"
              onCancel={commands.closeDialog}
              onApply={(pixels) => {
                commands.closeDialog();
                void editor.select({
                  type: 'expand',
                  pixels: Math.round(d().contract ? -pixels : pixels),
                });
              }}
            />
          )}
        </Match>
        <Match when={commands.dialog()?.kind === 'resolution'}>
          <NumberDialog
            title="Resolution"
            label="Resolution"
            unit="ppi"
            value={summary().resolution}
            min={1}
            max={10000}
            testId="psd-resolution-dialog"
            onCancel={commands.closeDialog}
            onApply={(ppi) => {
              commands.closeDialog();
              void editor.apply([{ op: 'setResolution', ppi }]);
            }}
          />
        </Match>
      </Switch>
    </div>
  );
}
