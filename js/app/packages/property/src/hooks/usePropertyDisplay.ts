import { tryMacroId, useDisplayNameParts } from '@core/user';
import { createMemo } from 'solid-js';
import type { Property } from '../types';
import {
  formatBoolean,
  formatDate,
  formatNumber,
  formatPropertyValue,
  getEntityValues,
  getLinkValues,
  getSelectValues,
  hasValue,
  isBooleanProperty,
  isDateProperty,
  isEntityProperty,
  isLinkProperty,
  isNumberProperty,
  isSelectProperty,
  isStringProperty,
} from '../utils';

export interface PropertyDisplay {
  isEmpty: boolean;
  isUser: boolean;
  /** Best single-value representation as text. */
  text: string;
  /** For SELECT properties: the first option's id. */
  firstOptionId: string | undefined;
  /** For ENTITY+USER: the first user id. */
  firstUserId: string | undefined;
  /** Count of values for multi-value properties (0 for single). */
  count: number;
}

/**
 * Centralizes the "extract a displayable representation from a property"
 * logic that today is duplicated across InlinePropertyValue / ListProperty /
 * Condensed.
 */
export function usePropertyDisplay(
  property: () => Property
): () => PropertyDisplay {
  return createMemo(() => {
    const p = property();
    const empty = !hasValue(p);
    const isUser = isEntityProperty(p) && p.specificEntityType === 'USER';

    let text = '';
    let firstOptionId: string | undefined;
    let firstUserId: string | undefined;
    let count = 0;

    if (isStringProperty(p)) {
      text = p.value ?? '';
    } else if (isNumberProperty(p)) {
      text = p.value === null ? '' : formatNumber(p.value);
    } else if (isBooleanProperty(p)) {
      text = p.value === null ? '' : formatBoolean(p.value);
    } else if (isDateProperty(p)) {
      text = p.value === null ? '' : formatDate(p.value);
    } else if (isSelectProperty(p)) {
      const values = getSelectValues(p);
      count = values.length;
      firstOptionId = values[0];
      text = firstOptionId ? formatPropertyValue(p, firstOptionId) : '';
    } else if (isEntityProperty(p)) {
      const entities = getEntityValues(p);
      count = entities.length;
      if (isUser) {
        firstUserId = entities[0]?.entity_id;
        if (entities.length === 1 && firstUserId) {
          const parts = useDisplayNameParts(tryMacroId(firstUserId));
          text = parts.firstName() || 'Unknown';
        } else if (entities.length > 1) {
          text =
            entities.length === 2 ? '2 people' : `${entities.length} people`;
        }
      } else if (entities.length > 0) {
        text = entities.length === 1 ? '1 item' : `${entities.length} items`;
      }
    } else if (isLinkProperty(p)) {
      const links = getLinkValues(p);
      count = links.length;
      text = links[0] ?? '';
    }

    return { isEmpty: empty, isUser, text, firstOptionId, firstUserId, count };
  });
}
