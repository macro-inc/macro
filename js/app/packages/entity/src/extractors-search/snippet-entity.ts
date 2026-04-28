import { visibleLength, windowSearchMatch } from '@core/util/searchHighlight';
import {
  type CallEntity,
  type EmailEntity,
  type EntityData,
  isCallEntity,
  isEmailEntity,
} from '../types/entity';
import { isSearchEntity } from '../types/search';

/**
 * Entities whose inline row snippet renders search hit content via
 * windowSearchMatch + HighlightRender (as opposed to entity-derived previews
 * such as channel latest messages or task properties).
 */
export type SnippetEntity = EmailEntity | CallEntity;

export const isSnippetEntity = (entity: EntityData): entity is SnippetEntity =>
  isEmailEntity(entity) || isCallEntity(entity);

/**
 * Hit content rendered as the row snippet for a SnippetEntity:
 * - email: longest hit (best context window around the highlight)
 * - call: first hit (typically the first transcript match)
 */
export const getSnippetHitContent = (
  entity: EntityData
): string | undefined => {
  if (!isSnippetEntity(entity)) return undefined;
  if (!isSearchEntity(entity)) return undefined;
  const hits = entity.search.contentHitData;
  if (!hits?.length) return undefined;
  if (isEmailEntity(entity)) {
    let bestIdx = 0;
    let bestLen = visibleLength(hits[0].content);
    for (let i = 1; i < hits.length; i++) {
      const len = visibleLength(hits[i].content);
      if (len > bestLen) {
        bestLen = len;
        bestIdx = i;
      }
    }
    return hits[bestIdx].content;
  }
  return hits[0].content;
};

/**
 * True when windowSearchMatch does not trim the content — the rendered
 * snippet shows the full text, so an expandable view reveals nothing new.
 */
export const isHitSnippetComplete = (content: string, chars: number): boolean =>
  visibleLength(windowSearchMatch(content, chars)) >= visibleLength(content);
