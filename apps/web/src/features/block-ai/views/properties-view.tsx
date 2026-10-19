/**
 * The Properties panel for the current selection, wired to the editor:
 * what the selected objects share (or "Mixed"), and their changes as
 * engine operations. Font changes load the family before the text is laid
 * out again.
 */

import {
  BLEND_MODES,
  type BlendMode,
  type Info,
  type Paint,
} from '@core/ai-engine/types';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type PanelModel,
  type PanelPaint,
  PropertiesPanel,
} from '../components/properties-panel';
import {
  center,
  rotationOf,
  scaleAbout,
  toEdges,
  toRect,
} from '../core/geometry';
import { paintCss, paintHex, paintKind, solidPaint } from '../core/paint';
import type { AiEditor } from '../primitives/create-ai-editor';
import type { AiViewer } from '../primitives/create-ai-viewer';
import type { FontLoader } from '../primitives/create-font-loader';

const TITLES: Record<string, string> = {
  layer: 'Layer',
  group: 'Group',
  clipGroup: 'Clip Group',
  path: 'Path',
  text: 'Text',
  image: 'Image',
  artwork: 'Artwork',
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** A paint as the panel shows it; containers' paints are unknown (mixed). */
function panelPaint(paints: (Paint | null)[], containers: boolean): PanelPaint {
  const first = paints[0] ?? null;
  return {
    css: paintCss(first),
    hex: paintHex(first) ?? '000000',
    none: first === null && !containers,
    label: paintKind(first),
    gradient: first?.type === 'gradient',
    mixed: containers || paints.some((p) => !same(p, first)),
  };
}

const isBlendMode = (value: string): value is BlendMode =>
  (BLEND_MODES as readonly string[]).includes(value);

const isContainer = (i: Info) =>
  i.kind === 'group' || i.kind === 'clipGroup' || i.kind === 'layer';

export function PropertiesView(props: {
  viewer: AiViewer;
  editor: AiEditor;
  fonts: FontLoader;
}) {
  const viewer = props.viewer;
  const editor = props.editor;
  const fonts = props.fonts;

  const model = (): PanelModel => {
    const infos = viewer.infos();
    const none = {
      group: false,
      ungroup: false,
      clip: false,
      release: false,
      outline: false,
      pathfinder: false,
      distribute: false,
    };
    if (infos.length === 0) {
      const art = viewer.activeArtboard();
      return {
        title: art ? art.name : 'No selection',
        count: 0,
        artboard: art ? { name: art.name, rect: toRect(art.rect) } : undefined,
        can: none,
      };
    }
    const first = infos[0];
    const containers = infos.some(isContainer);
    const strokes = infos.map((i) => i.stroke);
    const firstStroke = strokes[0];
    const allText = infos.every((i) => i.kind === 'text');
    const text = allText ? first.text : null;
    return {
      title:
        infos.length === 1
          ? (TITLES[first.kind] ?? 'Object')
          : `${infos.length} Objects`,
      count: infos.length,
      bounds: viewer.selectionBounds(),
      rotation: rotationOf(first.transform),
      fill: panelPaint(
        infos.map((i) => i.fill),
        containers
      ),
      stroke: {
        ...panelPaint(
          strokes.map((s) => s?.paint ?? null),
          containers
        ),
        width: firstStroke?.width ?? 0,
        cap: firstStroke?.cap ?? 'butt',
        join: firstStroke?.join ?? 'miter',
        dash: firstStroke?.dash ?? [],
      },
      opacity: {
        value: first.opacity,
        mixed: infos.some((i) => i.opacity !== first.opacity),
      },
      blend: first.blend,
      text: text
        ? {
            family: text.family,
            style: text.style,
            styles: fonts.stylesOf(text.family),
            size: text.size,
            tracking: text.tracking,
            lineHeight: text.lineHeight,
            align: text.align,
            width: text.width,
            fromFile: text.fromFile,
            missing: !text.fromFile && !fonts.canLoad(text.family),
          }
        : undefined,
      can: {
        group: infos.length > 0,
        ungroup: infos.some((i) => i.kind === 'group'),
        clip: infos.length > 1,
        release: infos.some((i) => i.kind === 'clipGroup'),
        outline: infos.some((i) => i.kind === 'text'),
        pathfinder: infos.length > 1,
        distribute: infos.length > 2,
      },
    };
  };

  /** Loads a family before text is laid out in it, then applies the change. */
  const changeText = async (
    patch: Parameters<AiEditor['setText']>[0],
    live: boolean
  ) => {
    const text = viewer.infos().find((i) => i.kind === 'text')?.text;
    if (text && (patch.family || patch.style)) {
      const family = patch.family ?? text.family;
      const style = patch.style ?? text.style;
      await fonts.ensure(family, style, text.text);
    }
    await editor.setText(patch, live);
    fireAndForget(fonts.refresh(), 'ai-editor');
  };

  return (
    <PropertiesPanel
      model={model()}
      editable={editor.enabled()}
      fonts={{
        documentFamilies: [
          ...new Set(['Inter', ...fonts.documentFonts().map((f) => f.family)]),
        ],
        googleFamilies: fonts.families().map((f) => f.family),
        preview: fonts.preview,
        onOpen: () => fireAndForget(fonts.loadCatalog(), 'ai-editor'),
      }}
      actions={{
        onBounds: (patch, live) =>
          fireAndForget(editor.setBounds(patch, live), 'ai-editor'),
        onRotation: (degrees, live) =>
          fireAndForget(editor.setRotation(degrees, live), 'ai-editor'),
        onFlip: (vertical) => {
          const box = viewer.selectionBounds();
          if (box)
            fireAndForget(
              editor.transformSelection(
                scaleAbout(vertical ? 1 : -1, vertical ? -1 : 1, center(box))
              ),
              'ai-editor'
            );
        },
        onFill: (hex, live) =>
          fireAndForget(
            editor.setFill(
              hex === null ? null : (solidPaint(hex) ?? null),
              live
            ),
            'ai-editor'
          ),
        onStroke: (hex, live) => {
          if (hex === null) {
            fireAndForget(editor.setStroke(null, live), 'ai-editor');
            return;
          }
          const paint = solidPaint(hex);
          if (paint)
            fireAndForget(editor.updateStroke({ paint }, live), 'ai-editor');
        },
        onStrokeProps: (patch, live) =>
          fireAndForget(editor.updateStroke(patch, live), 'ai-editor'),
        onOpacity: (value, live) =>
          fireAndForget(
            editor.setNodes({ opacity: value }, viewer.selected(), live),
            'ai-editor'
          ),
        onBlend: (mode) => {
          if (isBlendMode(mode))
            fireAndForget(
              editor.setNodes({ blend: mode }, viewer.selected()),
              'ai-editor'
            );
        },
        onText: (patch, live) =>
          fireAndForget(changeText(patch, live), 'ai-editor'),
        onAlign: (how) => fireAndForget(editor.align(how), 'ai-editor'),
        onDistribute: (axis) =>
          fireAndForget(editor.distribute(axis), 'ai-editor'),
        onBoolean: (mode) => fireAndForget(editor.booleanOp(mode), 'ai-editor'),
        onArrange: (how) => fireAndForget(editor.arrange(how), 'ai-editor'),
        onGroup: () => fireAndForget(editor.group(), 'ai-editor'),
        onUngroup: () => fireAndForget(editor.ungroup(), 'ai-editor'),
        onClip: () => fireAndForget(editor.makeClip(), 'ai-editor'),
        onRelease: () => fireAndForget(editor.releaseClip(), 'ai-editor'),
        onOutline: () => fireAndForget(editor.createOutlines(), 'ai-editor'),
        onArtboard: (patch) => {
          const art = viewer.activeArtboard();
          if (!art) return;
          fireAndForget(
            editor.apply([
              {
                op: 'setArtboard',
                id: art.id,
                name: patch.name,
                rect: patch.rect && toEdges(patch.rect),
              },
            ]),
            'ai-editor'
          );
        },
      }}
    />
  );
}
