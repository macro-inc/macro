/**
 * The `.fig` viewer: layers on the left, the canvas in the middle, the
 * design panel on the right, Figma's keyboard shortcuts throughout.
 */

import { IS_MAC } from '@core/constant/isMac';
import type { NodeInfo } from '@core/fig-engine/types';
import {
  createEffect,
  createSignal,
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
import { shortcutAction, type ViewerAction } from '../core/shortcuts';
import { createFigViewer } from '../primitives/create-fig-viewer';
import { LayersPanel } from './layers-panel';
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

  const [spaceHeld, setSpaceHeld] = createSignal(false);
  const [altHeld, setAltHeld] = createSignal(false);
  const [deepHeld, setDeepHeld] = createSignal(false);
  const [showShortcuts, setShowShortcuts] = createSignal(false);
  const [info, setInfo] = createSignal<NodeInfo>();
  let root!: HTMLDivElement;
  let searchInput: HTMLInputElement | undefined;

  onMount(() => {
    void viewer.openPage(0);
    if (document.activeElement === document.body)
      root.focus({ preventScroll: true });
  });

  // The design panel follows a single selection.
  let infoRequest = 0;
  createEffect(
    on(viewer.selected, (selected) => {
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
        queueMicrotask(() => searchInput?.focus());
      })
      .with('show-shortcuts', () => setShowShortcuts((s) => !s))
      .exhaustive();

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    if (e.key === ' ') {
      e.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (e.key === 'Alt') setAltHeld(true);
    if (e.key === 'Meta' || e.key === 'Control') setDeepHeld(true);
    const action = shortcutAction(e, IS_MAC);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    run(action);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') setSpaceHeld(false);
    if (e.key === 'Alt') setAltHeld(false);
    if (e.key === 'Meta' || e.key === 'Control') setDeepHeld(false);
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
    >
      <Show when={showLayers()}>
        <aside class="flex w-60 shrink-0 flex-col border-edge-muted border-r bg-panel">
          <LayersPanel
            viewer={viewer}
            engine={engine}
            searchRef={(el) => {
              searchInput = el;
            }}
          />
        </aside>
      </Show>
      <div class="relative min-w-0 flex-1">
        <ViewerCanvas
          viewer={viewer}
          engine={engine}
          spaceHeld={spaceHeld}
          altHeld={altHeld}
          deepHeld={deepHeld}
        >
          <Show when={viewer.loadingPage()}>
            <div class="pointer-events-none absolute inset-0 flex items-center justify-center text-ink-muted text-sm">
              Loading page…
            </div>
          </Show>
          <Show when={!viewer.uiHidden()}>
            <ViewerToolbar
              tool={viewer.tool()}
              onTool={viewer.setTool}
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
            selectionCount={viewer.selected().length}
            page={viewer.pages[viewer.page()]}
            onExport={(scale) => void exportSelection(scale)}
            onCopyPng={() => void copyPng()}
            onCopyText={(text) => void copyText(text)}
          />
        </aside>
      </Show>
    </div>
  );
}
