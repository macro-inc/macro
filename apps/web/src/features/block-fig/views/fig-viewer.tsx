/**
 * The `.fig` viewer: layers on the left, the canvas in the middle, the
 * design panel on the right, Figma's keyboard shortcuts throughout.
 */

import { IS_MAC } from '@core/constant/isMac';
import type { NodeInfo, Rect } from '@core/fig-engine/types';
import {
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import { DesignPanel } from '../components/design-panel';
import { ShortcutsDialog } from '../components/shortcuts-dialog';
import { ViewerToolbar } from '../components/viewer-toolbar';
import { useFigViewerContext } from '../context/fig-viewer-context';
import { zoomLabel } from '../core/camera';
import { stepPage } from '../core/pages';
import {
  controlOwnsKey,
  EDIT_ACTIONS,
  shortcutAction,
  type ViewerAction,
} from '../core/shortcuts';
import { deleteVertex, VECTOR_EDITABLE } from '../core/vector';
import { createFigEditor } from '../primitives/create-fig-editor';
import { createFigViewer } from '../primitives/create-fig-viewer';
import { AssetsPanel } from './assets-panel';
import { LayersPanel } from './layers-panel';
import { TextEditor } from './text-editor';
import { ViewerCanvas } from './viewer-canvas';

const safeName = (name: string) =>
  name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export';

export function FigViewer() {
  const context = useFigViewerContext();
  const { engine } = context;
  const viewer = createFigViewer({
    engine,
    notifyError: context.notifyError,
  });
  let invalidate: ((rect: Rect) => void) | undefined;
  const editor = createFigEditor({
    engine,
    viewer,
    canEdit: () => context.canEdit?.() ?? false,
    save: context.save,
    fileKey: context.fileKey,
    onDirty: (rect) => invalidate?.(rect),
    notifyError: context.notifyError,
  });

  const [spaceHeld, setSpaceHeld] = createSignal(false);
  const [altHeld, setAltHeld] = createSignal(false);
  const [deepHeld, setDeepHeld] = createSignal(false);
  const [showShortcuts, setShowShortcuts] = createSignal(false);
  const [leftTab, setLeftTab] = createSignal<'layers' | 'assets'>('layers');
  const [info, setInfo] = createSignal<NodeInfo>();
  let root!: HTMLDivElement;
  let searchInput: HTMLInputElement | undefined;

  onMount(() => {
    void viewer.openPage(0);
    if (document.activeElement === document.body)
      root.focus({ preventScroll: true });
  });

  // The design panel follows a single selection (and edits to it).
  let infoRequest = 0;
  createEffect(
    on([viewer.selected, viewer.editVersion], ([selected]) => {
      const request = ++infoRequest;
      if (selected.length !== 1) {
        setInfo(undefined);
        return;
      }
      engine
        .nodeInfo(viewer.page(), selected[0].id)
        .then((i) => {
          if (request === infoRequest) setInfo(i);
        })
        .catch(() => {
          if (request === infoRequest) setInfo(undefined);
        });
    })
  );

  // ---- export -------------------------------------------------------------

  const exportSelection = async (scale: number) => {
    const ids = viewer.selected().map((s) => s.id);
    if (ids.length === 0) {
      context.notifyInfo('Select a layer to export');
      return;
    }
    for (const id of ids) {
      try {
        const blob = await engine.exportPng(viewer.page(), id, scale);
        const name =
          ids.length === 1 && info()?.name
            ? info()?.name
            : `${context.fileName()}-${id}`;
        context.download(
          blob,
          `${safeName(name ?? 'export')}${scale === 1 ? '' : `@${scale}x`}.png`
        );
      } catch (e) {
        context.notifyError(e instanceof Error ? e.message : 'Export failed');
      }
    }
  };

  const copyPng = async () => {
    const id = viewer.selected()[0]?.id;
    if (!id) {
      context.notifyInfo('Select a layer to copy');
      return;
    }
    try {
      const png = engine.exportPng(viewer.page(), id, 2);
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': png }),
      ]);
      context.notifyInfo('Copied as PNG');
    } catch {
      context.notifyError('Could not copy the image');
    }
  };

  /** The single selected layer as an SVG document. */
  const selectedSvg = async (): Promise<
    { svg: string; name: string } | undefined
  > => {
    const id = viewer.selected()[0]?.id;
    if (!id) {
      context.notifyInfo('Select a layer to export');
      return undefined;
    }
    const name = info()?.id === id ? info()?.name : undefined;
    return {
      svg: await engine.exportSvg(viewer.page(), id),
      name: safeName(name ?? `${context.fileName()}-${id}`),
    };
  };

  const exportSvg = async () => {
    try {
      const out = await selectedSvg();
      if (!out) return;
      context.download(
        new Blob([out.svg], { type: 'image/svg+xml' }),
        `${out.name}.svg`
      );
    } catch (e) {
      context.notifyError(e instanceof Error ? e.message : 'Export failed');
    }
  };

  /** Figma's "Copy as SVG": the markup as text. */
  const copySvg = async () => {
    try {
      const out = await selectedSvg();
      if (!out) return;
      await navigator.clipboard.writeText(out.svg);
      context.notifyInfo('Copied as SVG');
    } catch {
      context.notifyError('Could not copy the SVG');
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      context.notifyInfo('Copied');
    } catch {
      context.notifyError('Could not copy');
    }
  };

  // ---- keyboard -------------------------------------------------------------

  const openStep = (step: 1 | -1) => {
    const next = stepPage(viewer.pages, viewer.page(), step);
    if (next !== undefined) void viewer.openPage(next);
  };

  const run = (action: ViewerAction) =>
    match(action)
      .with('tool-move', () => viewer.setTool('move'))
      .with('tool-hand', () => viewer.setTool('hand'))
      .with('zoom-in', () => viewer.zoomStep(1))
      .with('zoom-out', () => viewer.zoomStep(-1))
      .with('zoom-100', () => viewer.zoom100())
      .with('zoom-fit', () => viewer.zoomToFit())
      .with('zoom-selection', () => viewer.zoomToSelection())
      .with('next-frame', () => viewer.stepFrame(1))
      .with('previous-frame', () => viewer.stepFrame(-1))
      .with('next-page', () => openStep(1))
      .with('previous-page', () => openStep(-1))
      .with('select-all', () => void viewer.selectAll())
      .with('escape', () => {
        if (showShortcuts()) setShowShortcuts(false);
        else viewer.escapeSelection();
      })
      .with('select-parent', () => viewer.selectParent())
      .with('select-children', () => void viewer.selectChildren())
      .with('next-sibling', () => void viewer.selectSibling(1))
      .with('previous-sibling', () => void viewer.selectSibling(-1))
      .with('toggle-ui', () => viewer.setUiHidden((h) => !h))
      .with('toggle-outline', () => viewer.setOutlineView((o) => !o))
      .with('toggle-rulers', () => viewer.setRulers((r) => !r))
      .with('toggle-pixel-grid', () => viewer.setPixelGrid((g) => !g))
      .with('toggle-layers', () => {
        viewer.setUiHidden(false);
        viewer.setLayersOpen((o) => !o);
      })
      .with('toggle-design', () => {
        viewer.setUiHidden(false);
        viewer.setDesignOpen((o) => !o);
      })
      .with('collapse-layers', () => viewer.collapseLayers())
      .with('copy-png', () => void copyPng())
      .with('export', () => void exportSelection(2))
      .with('find', () => {
        viewer.setUiHidden(false);
        viewer.setLayersOpen(true);
        setLeftTab('layers');
        queueMicrotask(() => searchInput?.focus());
      })
      .with('show-shortcuts', () => setShowShortcuts((s) => !s))
      .with('tool-frame', () => viewer.setTool('frame'))
      .with('tool-rectangle', () => viewer.setTool('rectangle'))
      .with('tool-ellipse', () => viewer.setTool('ellipse'))
      .with('tool-text', () => viewer.setTool('text'))
      .with('tool-line', () => viewer.setTool('line'))
      .with('tool-arrow', () => viewer.setTool('arrow'))
      .with('tool-pen', () => viewer.setTool('pen'))
      .with('undo', () => {
        editor.endVectorEdit();
        editor.undo();
      })
      .with('redo', () => {
        editor.endVectorEdit();
        editor.redo();
      })
      .with('delete', () => void editor.deleteSelection())
      .with('duplicate', () => void editor.duplicateSelection())
      .with('copy', () => editor.copy())
      .with('cut', () => void editor.cut())
      .with('paste', () => void editor.paste())
      .with('group', () => void editor.group())
      .with('ungroup', () => void editor.ungroup())
      .with('frame-selection', () => void editor.group(true))
      .with('add-auto-layout', () => void editor.addAutoLayout())
      .with('create-component', () => void editor.createComponent())
      .with('detach-instance', () => void editor.detachInstance())
      .with('remove-auto-layout', () => void editor.removeAutoLayout())
      .with('boolean-union', () => void editor.booleanOp('UNION'))
      .with('boolean-subtract', () => void editor.booleanOp('SUBTRACT'))
      .with('boolean-intersect', () => void editor.booleanOp('INTERSECT'))
      .with('boolean-exclude', () => void editor.booleanOp('XOR'))
      .with('flatten', () => void editor.flatten())
      .with('bring-forward', () => void editor.arrange('forward'))
      .with('send-backward', () => void editor.arrange('backward'))
      .with('bring-to-front', () => void editor.arrange('front'))
      .with('send-to-back', () => void editor.arrange('back'))
      .with('toggle-visible', () => {
        const visible = info()?.visible ?? true;
        void editor.setProps({ visible: !visible });
      })
      .with('toggle-locked', () => {
        const locked = info()?.locked ?? false;
        void editor.setProps({ locked: !locked });
      })
      .with('rename', () => viewer.requestRename())
      .with('nudge-left', () => void editor.nudge(-1, 0))
      .with('nudge-right', () => void editor.nudge(1, 0))
      .with('nudge-up', () => void editor.nudge(0, -1))
      .with('nudge-down', () => void editor.nudge(0, 1))
      .with('nudge-left-10', () => void editor.nudge(-10, 0))
      .with('nudge-right-10', () => void editor.nudge(10, 0))
      .with('nudge-up-10', () => void editor.nudge(0, -10))
      .with('nudge-down-10', () => void editor.nudge(0, 10))
      .exhaustive();

  /**
   * Enter on a lone text layer types into it, and on a lone shape edits its
   * points, as in Figma.
   */
  const enterAction = (
    action: ViewerAction
  ): ViewerAction | 'edit-text' | 'edit-vector' => {
    const i = info();
    if (
      action !== 'select-children' ||
      !editor.enabled() ||
      viewer.selected().length !== 1
    )
      return action;
    if (i?.type === 'TEXT') return 'edit-text';
    if (i && VECTOR_EDITABLE.has(i.type)) return 'edit-vector';
    return action;
  };

  /**
   * Keys while drawing with the pen or editing points: Enter and Escape
   * finish, Delete removes the selected point. Returns whether it was used.
   */
  const shapeKey = (e: KeyboardEvent): boolean => {
    const finish = e.key === 'Enter' || e.key === 'Escape';
    if (editor.penPath()) {
      if (!finish) return false;
      void editor.penFinish(false);
      return true;
    }
    const edit = editor.vectorEdit();
    if (!edit) return false;
    if (finish) {
      editor.endVectorEdit();
      return true;
    }
    if (
      (e.key === 'Delete' || e.key === 'Backspace') &&
      edit.selected !== undefined
    ) {
      void editor.setVectorNetwork(deleteVertex(edit.network, edit.selected));
      return true;
    }
    return false;
  };

  const [textEditing, setTextEditing] = createSignal<string>();

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    // A focused select or button keeps the keys it uses itself.
    const control = target.closest('select, button, a[href]');
    if (control && controlOwnsKey(control.tagName, e)) return;
    if (e.key === ' ') {
      e.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (e.key === 'Alt') setAltHeld(true);
    if (e.key === 'Meta' || e.key === 'Control') setDeepHeld(true);
    if (shapeKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const action = shortcutAction(e, IS_MAC);
    if (!action) return;
    if (EDIT_ACTIONS.has(action) && !editor.enabled()) return;
    // ⌘V goes through the paste event, which carries pasted image files.
    if (action === 'paste') return;
    e.preventDefault();
    e.stopPropagation();
    const resolved = enterAction(action);
    if (resolved === 'edit-text') setTextEditing(info()?.id);
    else if (resolved === 'edit-vector') {
      const id = info()?.id;
      if (id) void editor.editVector(id);
    } else run(resolved);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') setSpaceHeld(false);
    if (e.key === 'Alt') setAltHeld(false);
    if (e.key === 'Meta' || e.key === 'Control') setDeepHeld(false);
  };

  // Pasting image files places them in the middle of the view.
  const onPaste = (e: ClipboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest?.('input, textarea, [contenteditable="true"]')) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) =>
      f.type.startsWith('image/')
    );
    if (!editor.enabled()) return;
    e.preventDefault();
    if (files.length === 0) {
      // Layers copied here, in another file, or in Figma.
      void editor.paste(e.clipboardData?.getData('text/html') || undefined);
      return;
    }
    const c = viewer.camera();
    const v = viewer.viewport();
    const at = { x: c.x + v.w / 2 / c.zoom, y: c.y + v.h / 2 / c.zoom };
    void viewer
      .containerAt(at)
      .then((parent) => editor.importImages(files, at, parent));
  };

  const releaseModifiers = () => {
    setSpaceHeld(false);
    setAltHeld(false);
    setDeepHeld(false);
  };
  onMount(() => {
    window.addEventListener('blur', releaseModifiers);
    onCleanup(() => window.removeEventListener('blur', releaseModifiers));
  });

  const zoomItems = () => [
    {
      label: 'Zoom in',
      shortcut: IS_MAC ? '⌘+' : 'Ctrl++',
      onSelect: () => run('zoom-in'),
    },
    {
      label: 'Zoom out',
      shortcut: IS_MAC ? '⌘-' : 'Ctrl+-',
      onSelect: () => run('zoom-out'),
    },
    {
      label: 'Zoom to fit',
      shortcut: '⇧1',
      onSelect: () => run('zoom-fit'),
      testId: 'fig-zoom-fit',
    },
    {
      label: 'Zoom to selection',
      shortcut: '⇧2',
      onSelect: () => run('zoom-selection'),
    },
    {
      label: 'Zoom to 100%',
      shortcut: '⇧0',
      onSelect: () => run('zoom-100'),
      testId: 'fig-zoom-100',
    },
    'divider' as const,
    {
      label: 'Pixel grid',
      shortcut: "⇧'",
      checked: viewer.pixelGrid(),
      onSelect: () => run('toggle-pixel-grid'),
    },
    {
      label: 'Rulers',
      shortcut: '⇧R',
      checked: viewer.rulers(),
      onSelect: () => run('toggle-rulers'),
    },
    {
      label: 'Outline view',
      shortcut: IS_MAC ? '⌘Y' : 'Ctrl+Y',
      checked: viewer.outlineView(),
      onSelect: () => run('toggle-outline'),
      testId: 'fig-outline-toggle',
    },
    {
      label: 'Show UI',
      shortcut: IS_MAC ? '⌘\\' : 'Ctrl+\\',
      checked: !viewer.uiHidden(),
      onSelect: () => run('toggle-ui'),
    },
  ];

  const showLayers = () => !viewer.uiHidden() && viewer.layersOpen();
  const showDesign = () => !viewer.uiHidden() && viewer.designOpen();

  return (
    <div
      ref={root}
      tabIndex={0}
      class="flex size-full min-h-0 bg-page outline-none"
      data-testid="fig-viewer"
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onPaste={onPaste}
    >
      <Show when={showLayers()}>
        <aside class="flex w-60 shrink-0 flex-col border-edge-muted border-r bg-panel">
          <div class="flex h-9 shrink-0 items-center gap-1 border-edge-muted border-b px-2 text-xs">
            <For each={['layers', 'assets'] as const}>
              {(t) => (
                <button
                  type="button"
                  class="rounded-md px-2 py-1 font-medium"
                  classList={{
                    'bg-hover text-ink': leftTab() === t,
                    'text-ink-muted': leftTab() !== t,
                  }}
                  data-testid={`fig-tab-${t}`}
                  onClick={() => setLeftTab(t)}
                >
                  {t === 'layers' ? 'Layers' : 'Assets'}
                </button>
              )}
            </For>
          </div>
          <Show
            when={leftTab() === 'layers'}
            fallback={
              <AssetsPanel viewer={viewer} engine={engine} editor={editor} />
            }
          >
            <LayersPanel
              viewer={viewer}
              engine={engine}
              editor={editor}
              searchRef={(el) => {
                searchInput = el;
              }}
            />
          </Show>
        </aside>
      </Show>
      <div class="relative min-w-0 flex-1">
        <ViewerCanvas
          viewer={viewer}
          engine={engine}
          spaceHeld={spaceHeld}
          altHeld={altHeld}
          deepHeld={deepHeld}
          editor={editor}
          info={info}
          onEditText={(id) => setTextEditing(id)}
          onInvalidator={(fn) => {
            invalidate = fn;
          }}
        >
          <Show when={textEditing()}>
            {(id) => (
              <TextEditor
                id={id()}
                viewer={viewer}
                editor={editor}
                engine={engine}
                onDone={() => {
                  setTextEditing(undefined);
                  root.focus({ preventScroll: true });
                }}
              />
            )}
          </Show>
          <Show when={viewer.loadingPage()}>
            <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-ink-muted text-sm">
              Loading page…
            </div>
          </Show>
          <Show when={!viewer.uiHidden()}>
            <ViewerToolbar
              tool={viewer.tool()}
              onTool={(tool) => {
                if (editor.penPath()) void editor.penFinish();
                viewer.setTool(tool);
              }}
              onBoolean={
                editor.enabled() && editor.editableIds().length > 0
                  ? (op) => void editor.booleanOp(op)
                  : undefined
              }
              onFlatten={() => void editor.flatten()}
              editable={editor.enabled()}
              saveState={editor.saveState()}
              canUndo={editor.canUndo()}
              canRedo={editor.canRedo()}
              onUndo={() => editor.undo()}
              onRedo={() => editor.redo()}
              zoomLabel={zoomLabel(viewer.camera().zoom)}
              zoomItems={zoomItems()}
              onShortcuts={() => setShowShortcuts((s) => !s)}
            />
          </Show>
          <Show when={showShortcuts()}>
            <ShortcutsDialog
              mac={IS_MAC}
              onClose={() => setShowShortcuts(false)}
            />
          </Show>
        </ViewerCanvas>
      </div>
      <Show when={showDesign()}>
        <aside class="flex w-64 shrink-0 flex-col border-edge-muted border-l bg-panel">
          <DesignPanel
            info={info()}
            onAlign={
              editor.enabled() ? (how) => void editor.align(how) : undefined
            }
            onPatch={
              editor.enabled()
                ? (patch, live) =>
                    void editor.setProps(
                      patch,
                      live ? `panel-${Object.keys(patch).join(',')}` : undefined
                    )
                : undefined
            }
            onAddAutoLayout={
              editor.enabled() ? () => void editor.addAutoLayout() : undefined
            }
            selectionCount={viewer.selected().length}
            page={viewer.pages[viewer.page()]}
            onExport={(scale) => void exportSelection(scale)}
            onExportSvg={() => void exportSvg()}
            onCopySvg={() => void copySvg()}
            onCopyPng={() => void copyPng()}
            onBoolean={
              editor.enabled() ? (op) => void editor.booleanOp(op) : undefined
            }
            onFlatten={() => void editor.flatten()}
            onCopyText={(text) => void copyText(text)}
          />
        </aside>
      </Show>
    </div>
  );
}
