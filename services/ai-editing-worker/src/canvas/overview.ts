import {
  drawableIds,
  type GraphicsDocument,
  worldBounds,
} from '@macro-inc/graphics';
import {
  richTextPlainText,
  validCanvasText,
} from '@macro-inc/lexical-core/canvas-text';

/** Semantic graph, not raster ASCII: exact IDs and connections, approximate spatial rows. */
export function canvasOverview(document: GraphicsDocument, itemIds?: string[]) {
  const all = drawableIds(document).filter(
    (id) => !itemIds || itemIds.includes(id)
  );
  const ids = all.slice(0, 100);
  const names = new Map(ids.map((id, index) => [id, `n${index + 1}`]));
  let labelsTruncated = false;
  const lines = ids.map((id) => {
    const item = document.items[id];
    const bounds = worldBounds(document, id);
    const content =
      item.type === 'text'
        ? item.geometry.content
        : 'geometry' in item && 'label' in item.geometry
          ? item.geometry.label?.content
          : undefined;
    const plainText =
      content && validCanvasText(content)
        ? richTextPlainText(content).replace(/\s+/g, ' ')
        : '';
    if (plainText.length > 100) labelsTruncated = true;
    const label = plainText.slice(0, 100);
    if (item.type === 'connector') {
      const start = item.geometry.start.binding?.targetId;
      const end = item.geometry.end.binding?.targetId;
      return `${names.get(id)}: ${start ? (names.get(start) ?? start) : 'free'} -> ${end ? (names.get(end) ?? end) : 'free'} ${JSON.stringify(label)}`;
    }
    return `${names.get(id)}: ${item.type} ${JSON.stringify(label)} @(${Math.round(bounds.x)},${Math.round(bounds.y)}) ${Math.round(bounds.width)}x${Math.round(bounds.height)}`;
  });
  return {
    approximate: true,
    truncated: all.length > ids.length || labelsTruncated,
    legend: Object.fromEntries([...names].map(([id, name]) => [name, id])),
    graph: lines.join('\n'),
  };
}
