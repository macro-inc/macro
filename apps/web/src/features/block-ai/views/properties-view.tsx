/**
 * The Properties panel for the current selection, wired to the editor:
 * what the selected objects share (or "Mixed"), and their changes as
 * engine operations. Font changes load the family before the text is laid
 * out again.
 */

import type { BlendMode, Info, Paint, Stroke } from '@core/ai-engine/types';
import {
  type PanelModel,
  type PanelPaint,
  PropertiesPanel,
} from '../components/properties-panel';
import { center, rotationOf, scaleAbout, toRect } from '../core/geometry';
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
    void fonts.refresh();
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
        onOpen: () => void fonts.loadCatalog(),
      }}
      actions={{
        onBounds: (patch, live) => void editor.setBounds(patch, live),
        onRotation: (degrees, live) => void editor.setRotation(degrees, live),
        onFlip: (vertical) => {
          const box = viewer.selectionBounds();
          if (box)
            void editor.transformSelection(
              scaleAbout(vertical ? 1 : -1, vertical ? -1 : 1, center(box))
            );
        },
        onFill: (hex, live) =>
          void editor.setFill(
            hex === null ? null : (solidPaint(hex) ?? null),
            live
          ),
        onStroke: (hex, live) => {
          if (hex === null) {
            void editor.setStroke(null, live);
            return;
          }
          const paint = solidPaint(hex);
          if (paint)
            void editor.updateStroke({ paint } as Partial<Stroke>, live);
        },
        onStrokeProps: (patch, live) => void editor.updateStroke(patch, live),
        onOpacity: (value, live) =>
          void editor.setNodes({ opacity: value }, viewer.selected(), live),
        onBlend: (mode) =>
          void editor.setNodes({ blend: mode as BlendMode }, viewer.selected()),
        onText: (patch, live) => void changeText(patch, live),
        onAlign: (how) => void editor.align(how),
        onDistribute: (axis) => void editor.distribute(axis),
        onBoolean: (mode) => void editor.booleanOp(mode),
        onArrange: (how) => void editor.arrange(how),
        onGroup: () => void editor.group(),
        onUngroup: () => void editor.ungroup(),
        onClip: () => void editor.makeClip(),
        onRelease: () => void editor.releaseClip(),
        onOutline: () => void editor.createOutlines(),
        onArtboard: (patch) => {
          const art = viewer.activeArtboard();
          if (!art) return;
          void editor.apply([
            {
              op: 'setArtboard',
              id: art.id,
              name: patch.name,
              rect: patch.rect && {
                x0: patch.rect.x,
                y0: patch.rect.y,
                x1: patch.rect.x + patch.rect.w,
                y1: patch.rect.y + patch.rect.h,
              },
            },
          ]);
        },
      }}
    />
  );
}
