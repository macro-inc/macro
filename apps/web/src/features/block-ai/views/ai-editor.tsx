/**
 * The Illustrator editor: the Layers and Artboards panels on the left, the
 * canvas with the toolbar in the middle, the Properties panel on the
 * right, and Illustrator's keyboard shortcuts throughout.
 */

import { zoomLabel } from '@app/features/block-fig/core/camera';
import { controlOwnsKey } from '@app/features/block-fig/core/shortcuts';
import type { EdgeRect } from '@core/ai-engine/types';
import { IS_MAC } from '@core/constant/isMac';
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import { MainMenu } from '../components/main-menu';
import { FileNotice } from '../components/notices';
import { PeerAvatars } from '../components/peer-presence';
import { type MenuItem, StatusBar } from '../components/status-bar';
import { type SwatchPaint, ToolBar } from '../components/tool-bar';
import { useAiEditorContext } from '../context/ai-editor-context';
import { center, type Point } from '../core/geometry';
import {
  colorHex,
  type Paint,
  paintCss,
  solidPaint,
  strokeOf,
} from '../core/paint';
import { storesFile } from '../core/presence';
import {
  EDIT_ACTIONS,
  type EditorAction,
  keyLabel,
  nudgeOffset,
  SELECTION_ACTIONS,
  shortcutAction,
} from '../core/shortcuts';
import type { Tool } from '../core/tools';
import { createAiEditor } from '../primitives/create-ai-editor';
import { createAiViewer } from '../primitives/create-ai-viewer';
import { createFontLoader } from '../primitives/create-font-loader';
import { createPeerOverlays } from '../primitives/create-peer-overlays';
import { AiCanvas, type CanvasInvalidator } from './ai-canvas';
import { ArtboardsPanel } from './artboards-panel';
import { LayersPanel } from './layers-panel';
import { PropertiesView } from './properties-view';
import { TextEditor } from './text-editor';

const safeName = (name: string) =>
  name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'illustration';

/** A paint as the toolbar's swatches show it. */
function swatch(p: Paint | null): SwatchPaint {
  return {
    css: paintCss(p),
    hex:
      p?.type === 'solid'
        ? colorHex(p.color)
        : p?.type === 'gradient' && p.gradient.stops[0]
          ? colorHex(p.gradient.stops[0].color)
          : '000000',
    none: p === null,
  };
}

export function AiEditorView() {
  const context = useAiEditorContext();
  const { engine } = context;
  const viewer = createAiViewer({ engine, notifyError: context.notifyError });
  let invalidator: CanvasInvalidator | undefined;
  const collab = context.collaboration;
  const sharing = context.sharing;
  const editor = createAiEditor({
    engine,
    viewer,
    canEdit: context.canEdit,
    save: context.save,
    onDirty: (rect: EdgeRect) => invalidator?.invalidate(rect),
    notifyError: context.notifyError,
    sharing,
    stores: collab
      ? () =>
          storesFile(
            { peerId: collab.peerId, editor: context.canEdit() },
            collab.peers()
          )
      : undefined,
    online: collab ? () => collab.status() === 'connected' : undefined,
  });
  const fonts = createFontLoader({
    engine,
    source: context.fonts,
    onRegistered: () => invalidator?.refresh(),
  });
  const peers = collab
    ? createPeerOverlays(engine, viewer, collab.peers)
    : undefined;

  const [spaceHeld, setSpaceHeld] = createSignal(false);
  const [altHeld, setAltHeld] = createSignal(false);
  const [leftTab, setLeftTab] = createSignal<'layers' | 'artboards'>('layers');
  const [textEditing, setTextEditing] = createSignal<{
    id: number;
    at?: Point;
  }>();
  const [pointer, setPointer] = createSignal<Point | null>(null);
  const [showIllustratorNote, setShowIllustratorNote] = createSignal(
    engine.summary.illustrator
  );
  const [showWarnings, setShowWarnings] = createSignal(
    engine.warnings.length > 0
  );
  let root!: HTMLDivElement;

  onMount(() => {
    void (async () => {
      await viewer.load();
      await fonts.loadDocumentFonts();
    })();
    if (document.activeElement === document.body)
      root.focus({ preventScroll: true });
  });

  // ---- presence (an external system) ----------------------------------------

  createEffect(() => {
    if (!collab) return;
    const c = viewer.camera();
    const v = viewer.viewport();
    collab.setPresence({
      session: sharing?.session ?? 0,
      selection: viewer.selected(),
      cursor: pointer(),
      editing: editor.editingText() ?? null,
      editor: editor.enabled(),
      view:
        v.w > 0 ? { x: c.x, y: c.y, w: v.w / c.zoom, h: v.h / c.zoom } : null,
    });
  });

  // ---- actions --------------------------------------------------------------

  const setTool = (tool: Tool) => {
    if (editor.penPoints()) void editor.penFinish(false);
    if (tool !== 'artboard') viewer.setArtboard(undefined);
    viewer.setTool(tool);
  };

  /** Escape: finish the pen, drop the artboard or selection, then the tool. */
  const onEscape = () => {
    if (editor.penPoints()) {
      void editor.penFinish(false);
      return;
    }
    if (viewer.artboard() !== undefined) {
      viewer.setArtboard(undefined);
      return;
    }
    if (viewer.selected().length > 0) {
      viewer.select([]);
      return;
    }
    viewer.setTool('select');
  };

  /** Nothing to finish, deselect, or leave: Escape is the app's. */
  const escapeIdle = () =>
    !editor.penPoints() &&
    viewer.artboard() === undefined &&
    viewer.selected().length === 0 &&
    viewer.tool() === 'select';

  const deleteKey = () => {
    const board = viewer.artboard();
    if (viewer.tool() === 'artboard' && board !== undefined) {
      void editor.deleteArtboard(board);
      return;
    }
    void editor.deleteSelection();
  };

  const run = (action: EditorAction) =>
    match(action)
      .with('tool-select', () => setTool('select'))
      .with('tool-direct', () => setTool('direct'))
      .with('tool-pen', () => setTool('pen'))
      .with('tool-rectangle', () => setTool('rectangle'))
      .with('tool-ellipse', () => setTool('ellipse'))
      .with('tool-polygon', () => setTool('polygon'))
      .with('tool-star', () => setTool('star'))
      .with('tool-line', () => setTool('line'))
      .with('tool-type', () => setTool('type'))
      .with('tool-eyedropper', () => setTool('eyedropper'))
      .with('tool-artboard', () => setTool('artboard'))
      .with('tool-hand', () => setTool('hand'))
      .with('tool-zoom', () => setTool('zoom'))
      .with('undo', () => void editor.undo())
      .with('redo', () => void editor.redo())
      .with('group', () => void editor.group())
      .with('ungroup', () => void editor.ungroup())
      .with('make-clip', () => void editor.makeClip())
      .with('release-clip', () => void editor.releaseClip())
      .with('bring-forward', () => void editor.arrange('forward'))
      .with('send-backward', () => void editor.arrange('backward'))
      .with('bring-to-front', () => void editor.arrange('front'))
      .with('send-to-back', () => void editor.arrange('back'))
      .with('duplicate', () => void editor.duplicate())
      .with('delete', deleteKey)
      .with('copy', () => editor.copy())
      .with('cut', () => void editor.cut())
      .with('paste', () => void editor.paste())
      .with('select-all', () => viewer.selectAll())
      .with('deselect', () => viewer.select([]))
      .with('toggle-outline', () => viewer.setOutlineView((o) => !o))
      .with('create-outlines', () => void editor.createOutlines())
      .with('zoom-in', () => viewer.zoomStep(1))
      .with('zoom-out', () => viewer.zoomStep(-1))
      .with('zoom-fit', () => viewer.fitArtboard())
      .with('zoom-fit-all', () => viewer.fitAll())
      .with('zoom-100', () => viewer.zoomTo(1))
      .with('default-colors', () => void editor.defaultColors())
      .with('swap-colors', () => void editor.swapColors())
      .with('escape', onEscape)
      .with('enter', () => {
        if (editor.penPoints()) void editor.penFinish(false);
        else {
          const only = viewer.infos();
          if (only.length === 1 && only[0].kind === 'text' && editor.enabled())
            setTextEditing({ id: only[0].id });
        }
      })
      .with(
        'nudge-left',
        'nudge-right',
        'nudge-up',
        'nudge-down',
        'nudge-left-10',
        'nudge-right-10',
        'nudge-up-10',
        'nudge-down-10',
        (a) => {
          const o = nudgeOffset(a);
          if (o) void editor.nudge(o.dx, o.dy);
        }
      )
      .exhaustive();

  // ---- keyboard ---------------------------------------------------------------

  /** Whether an action applies now (else the key goes on to the app). */
  const applies = (action: EditorAction) => {
    if (EDIT_ACTIONS.has(action) && !editor.enabled()) return false;
    if (SELECTION_ACTIONS.has(action) && viewer.selected().length === 0)
      return false;
    if (action === 'escape' && escapeIdle()) return false;
    if (action === 'delete')
      return (
        viewer.selected().length > 0 ||
        (viewer.tool() === 'artboard' && viewer.artboard() !== undefined)
      );
    if (action === 'enter')
      return !!editor.penPoints() || viewer.infos().length === 1;
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]'))
      return;
    if (target.closest('[role="menu"], [role="dialog"]')) return;
    const control = target.closest('button, a[href]');
    if (control && controlOwnsKey(control.tagName, e)) return;
    if (e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      setSpaceHeld(true);
      return;
    }
    if (e.key === 'Alt') setAltHeld(true);
    const action = shortcutAction(e, IS_MAC);
    if (!action || !applies(action)) return;
    // ⌘V goes through the paste event, which carries pasted image files.
    if (action === 'paste') return;
    e.preventDefault();
    e.stopPropagation();
    run(action);
  };

  /**
   * Keys pressed in the editor reach it before the app's hotkeys (which
   * listen on the document while capturing), so where they overlap the
   * editor's shortcuts win, as in Illustrator. Keys it does not use go on
   * to the app.
   */
  onMount(() => {
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (!(e.target instanceof Node) || !root.contains(e.target)) return;
      onKeyDown(e);
    };
    const onWindowKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
      if (e.key === 'Alt') setAltHeld(false);
    };
    const release = () => {
      setSpaceHeld(false);
      setAltHeld(false);
    };
    window.addEventListener('keydown', onWindowKeyDown, true);
    window.addEventListener('keyup', onWindowKeyUp, true);
    window.addEventListener('blur', release);
    onCleanup(() => {
      window.removeEventListener('keydown', onWindowKeyDown, true);
      window.removeEventListener('keyup', onWindowKeyUp, true);
      window.removeEventListener('blur', release);
    });
  });

  /** ⌘V: pasted image files are placed; otherwise what was copied here. */
  const onPaste = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (!editor.enabled()) return;
    e.preventDefault();
    const files = [...(e.clipboardData?.files ?? [])].filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length === 0) {
      void editor.paste();
      return;
    }
    const v = viewer.visibleRect();
    void editor.placeImages(files, center(v));
  };

  // ---- menus --------------------------------------------------------------------

  const mod = (keys: string) => keyLabel(keys, IS_MAC);

  const downloadAi = async () => {
    try {
      const bytes = await engine.save();
      context.download(
        new Blob([bytes as BlobPart], { type: 'application/postscript' }),
        `${safeName(context.fileName())}.ai`
      );
    } catch (e) {
      context.notifyError(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const exportPng = async (scale: number) => {
    const board = viewer.activeArtboard();
    try {
      const png = await engine.exportPng(board?.id ?? null, scale, false);
      const suffix = scale === 1 ? '' : `@${scale}x`;
      context.download(
        png,
        `${safeName(board ? board.name : context.fileName())}${suffix}.png`
      );
    } catch (e) {
      context.notifyError(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const viewItems = (): (MenuItem | 'divider')[] => [
    {
      label: 'Zoom in',
      shortcut: mod('⌘+'),
      onSelect: () => run('zoom-in'),
    },
    {
      label: 'Zoom out',
      shortcut: mod('⌘-'),
      onSelect: () => run('zoom-out'),
    },
    {
      label: 'Fit artboard in window',
      shortcut: mod('⌘0'),
      onSelect: () => run('zoom-fit'),
      testId: 'ai-zoom-fit',
    },
    {
      label: 'Fit all in window',
      shortcut: mod('⌥⌘0'),
      onSelect: () => run('zoom-fit-all'),
      testId: 'ai-zoom-fit-all',
    },
    {
      label: 'Actual size',
      shortcut: mod('⌘1'),
      onSelect: () => run('zoom-100'),
      testId: 'ai-zoom-100',
    },
    'divider',
    {
      label: 'Outline',
      shortcut: mod('⌘Y'),
      checked: viewer.outlineView(),
      onSelect: () => run('toggle-outline'),
      testId: 'ai-outline-toggle',
    },
  ];

  const fileItems = (): (MenuItem | 'divider')[] => [
    {
      label: 'Download .ai',
      onSelect: () => void downloadAi(),
      testId: 'ai-menu-download',
    },
    {
      label: 'Export artboard as PNG',
      onSelect: () => void exportPng(1),
      testId: 'ai-menu-export-png',
    },
    {
      label: 'Export artboard as PNG @2x',
      onSelect: () => void exportPng(2),
      testId: 'ai-menu-export-png-2x',
    },
    'divider',
    ...viewItems(),
  ];

  // ---- the toolbar's swatches ----------------------------------------------

  /** The selection's fill and stroke, or the defaults new objects get. */
  const shownAppearance = () => {
    const first = viewer.infos()[0];
    return first
      ? { fill: first.fill, stroke: first.stroke }
      : editor.appearance();
  };

  const setStrokePaint = (hex: string | null, live: boolean) => {
    if (hex === null) {
      void editor.setStroke(null, live);
      return;
    }
    const paint = solidPaint(hex);
    if (!paint) return;
    if (viewer.infos().length > 0) void editor.updateStroke({ paint }, live);
    else {
      const current = editor.appearance().stroke;
      void editor.setStroke(
        current ? { ...current, paint } : strokeOf(paint, 1),
        live
      );
    }
  };

  const showPeer = (
    view: { x: number; y: number; w: number; h: number } | null
  ) => {
    if (view) viewer.zoomToRect(view);
  };

  return (
    <div
      ref={root}
      tabIndex={0}
      class="flex size-full min-h-0 bg-page outline-none"
      data-testid="ai-editor"
      onPaste={onPaste}
    >
      <aside class="flex w-60 shrink-0 flex-col border-edge-muted border-r bg-panel">
        <div class="flex h-9 shrink-0 items-center gap-1 border-edge-muted border-b px-2 text-xs">
          <MainMenu items={fileItems()} />
          <For each={['layers', 'artboards'] as const}>
            {(t) => (
              <button
                type="button"
                class="rounded-md px-2 py-1 font-medium"
                classList={{
                  'bg-hover text-ink': leftTab() === t,
                  'text-ink-muted': leftTab() !== t,
                }}
                data-testid={`ai-tab-${t}`}
                onClick={() => setLeftTab(t)}
              >
                {t === 'layers' ? 'Layers' : 'Artboards'}
              </button>
            )}
          </For>
        </div>
        <div class="min-h-0 flex-1">
          <Show
            when={leftTab() === 'layers'}
            fallback={<ArtboardsPanel viewer={viewer} editor={editor} />}
          >
            <LayersPanel viewer={viewer} editor={editor} />
          </Show>
        </div>
      </aside>
      <div class="relative min-w-0 flex-1">
        <AiCanvas
          viewer={viewer}
          editor={editor}
          spaceHeld={spaceHeld}
          altHeld={altHeld}
          onInvalidator={(i) => {
            invalidator = i;
          }}
          onEditText={(id, at) => setTextEditing({ id, at })}
          peers={peers}
          onPointer={collab ? setPointer : undefined}
        >
          <Show when={textEditing()} keyed>
            {(t) => (
              <TextEditor
                id={t.id}
                at={t.at}
                viewer={viewer}
                editor={editor}
                fonts={fonts}
                onDone={() => {
                  setTextEditing(undefined);
                  root.focus({ preventScroll: true });
                }}
              />
            )}
          </Show>
          <ToolBar
            tool={viewer.tool()}
            editable={editor.enabled()}
            onTool={setTool}
            fill={swatch(shownAppearance().fill)}
            stroke={swatch(shownAppearance().stroke?.paint ?? null)}
            onFill={
              editor.enabled()
                ? (hex, live) =>
                    void editor.setFill(
                      hex === null ? null : (solidPaint(hex) ?? null),
                      live
                    )
                : undefined
            }
            onStroke={editor.enabled() ? setStrokePaint : undefined}
            onSwap={
              editor.enabled() ? () => void editor.swapColors() : undefined
            }
            onDefault={
              editor.enabled() ? () => void editor.defaultColors() : undefined
            }
          />
          <div class="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
            <Show when={showIllustratorNote()}>
              <FileNotice
                testId="ai-illustrator-note"
                title="Saving writes a standard PDF-based .ai, which Illustrator opens. Illustrator-only editing data, such as live effects, is not kept."
                onDismiss={() => setShowIllustratorNote(false)}
              />
            </Show>
            <Show when={showWarnings()}>
              <FileNotice
                testId="ai-warnings"
                title="Some of this file is shown differently than Illustrator shows it:"
                details={engine.warnings}
                onDismiss={() => setShowWarnings(false)}
              />
            </Show>
          </div>
          <Show when={collab}>
            {(c) => (
              <PeerAvatars
                peers={c().peers()}
                status={c().status()}
                onShow={(peer) => showPeer(peer.presence.view)}
              />
            )}
          </Show>
          <StatusBar
            editable={editor.enabled()}
            saveState={editor.saveState()}
            canUndo={editor.canUndo()}
            canRedo={editor.canRedo()}
            onUndo={() => void editor.undo()}
            onRedo={() => void editor.redo()}
            zoomLabel={zoomLabel(viewer.camera().zoom)}
            zoomItems={viewItems()}
            mac={IS_MAC}
          />
        </AiCanvas>
      </div>
      <aside class="flex w-64 shrink-0 flex-col border-edge-muted border-l bg-panel">
        <PropertiesView viewer={viewer} editor={editor} fonts={fonts} />
      </aside>
    </div>
  );
}
