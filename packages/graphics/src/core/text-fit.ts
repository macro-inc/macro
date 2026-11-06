import type { GraphicsDocument, GraphicsItem } from './model';
import { freezeDocument, worldBounds } from './scene';
import {
  canLabel,
  measureShapeLabel,
  shapeLabelLayout,
  withShapeLabel,
} from './shapes/label';
import type { TextFitMode, TextMeasurer } from './shapes/text';

export type TextFitRequest = { id: string; mode?: TextFitMode };
export type TextFitEffect = {
  id: string;
  policy: TextFitMode;
  measured: { width: number; height: number };
  fontSize: number;
  renderedFontSize: number;
  bounds: { x: number; y: number; width: number; height: number };
  overflow: boolean;
};
export type TextFitResult = {
  document: GraphicsDocument;
  effects: TextFitEffect[];
};

/** The host supplies its actual renderer. No guessed line counts or hidden durable writes. */
export function fitTextLayout(
  document: GraphicsDocument,
  requests: TextFitRequest[],
  measure: TextMeasurer
): TextFitResult {
  const items: Record<string, GraphicsItem> = { ...document.items };
  const effects: TextFitEffect[] = [];
  for (const request of requests) {
    let item = items[request.id];
    if (item?.type === 'text') {
      const policy = request.mode ?? item.geometry.fitText ?? 'grow';
      const fontSize = item.geometry.fontSize;
      let geometry = { ...item.geometry, autoWidth: false, fitText: policy };
      let measured = measure(geometry);
      if (policy === 'grow') {
        if (measured.width > geometry.width + 0.5) {
          geometry.width = measured.width;
          measured = measure(geometry);
        }
        geometry.height = Math.max(geometry.height, measured.height);
      } else if (
        measured.height > geometry.height + 0.5 ||
        measured.width > geometry.width + 0.5
      ) {
        if (policy === 'error')
          throw new Error(
            `Text ${item.id} needs height ${Math.ceil(measured.height)} at width ${geometry.width}. Fixed geometry was preserved; choose fitText grow or explicit contain.`
          );
        let low = 1,
          high = geometry.fontSize;
        for (let pass = 0; pass < 12; pass++) {
          const fontSize = (low + high) / 2;
          const size = measure({ ...geometry, fontSize });
          if (
            size.height <= geometry.height &&
            size.width <= geometry.width + 0.5
          )
            low = fontSize;
          else high = fontSize;
        }
        geometry.fontSize = low;
        measured = measure(geometry);
        if (
          measured.height > geometry.height + 0.5 ||
          measured.width > geometry.width + 0.5
        )
          throw new Error(
            `Text ${item.id} cannot fit its fixed bounds, even with explicit contain. Grow the box.`
          );
      }
      item = { ...item, geometry };
      items[item.id] = item;
      effects.push({
        id: item.id,
        policy,
        measured,
        fontSize,
        renderedFontSize: geometry.fontSize,
        bounds: worldBounds({ ...document, items }, item.id),
        overflow: false,
      });
    } else if (canLabel(item) && item.geometry.label) {
      const policy = request.mode ?? item.geometry.label.fitText ?? 'grow';
      if (item.type === 'connector' && policy !== 'grow')
        throw new Error(
          'Connector labels use natural width and grow fitting. Fixed contain/error fitting requires a text item or box.'
        );
      const label = measureShapeLabel(
        item,
        { ...item.geometry.label, fitText: policy },
        measure
      );
      item = withShapeLabel(item, label);
      if (policy === 'grow' && item.type !== 'connector') {
        const ratio = item.type === 'ellipse' ? Math.SQRT1_2 : 1;
        const width = Math.max(
          item.geometry.width,
          (label.fontSize * 2 + 24) / ratio
        );
        if (width !== item.geometry.width) {
          item = { ...item, geometry: { ...item.geometry, width } };
          item = withShapeLabel(item, measureShapeLabel(item, label, measure));
        }
        const height = Math.max(
          item.geometry.height,
          (item.geometry.label!.height + 24) / ratio
        );
        item = { ...item, geometry: { ...item.geometry, height } };
      }
      const layout = shapeLabelLayout(item)!;
      const scale = Math.hypot(layout.transform[0], layout.transform[1]);
      if (policy === 'error' && scale < 0.999)
        throw new Error(
          `Label ${item.id} does not fit its fixed interior at font size ${label.fontSize}. Geometry and font were preserved; choose grow or explicit contain.`
        );
      items[item.id] = item;
      effects.push({
        id: item.id,
        policy,
        measured: {
          width: layout.geometry.width,
          height: layout.geometry.height,
        },
        fontSize: label.fontSize,
        renderedFontSize: label.fontSize * scale,
        bounds: worldBounds({ ...document, items }, item.id),
        overflow: false,
      });
    }
    if (
      item &&
      item.type !== 'surface' &&
      item.type !== 'group' &&
      'width' in item.geometry &&
      (item.geometry.width > 100_000 || item.geometry.height > 100_000)
    )
      throw new Error(
        'Measured text exceeds the 100000-unit Canvas bound. Split the text into smaller items.'
      );
  }
  return { document: freezeDocument({ ...document, items }), effects };
}
