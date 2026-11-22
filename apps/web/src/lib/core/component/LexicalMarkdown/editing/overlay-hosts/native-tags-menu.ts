import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  dispatchApplicationCommandIfSessionEdit,
  dispatchApplicationCommandSettled,
} from '../../plugins/group-b/command';
import type { TagsMenuHost } from './tags';

/** Native tags menu commands; removal settles before the insertion is issued. */
export function createNativeTagsMenuHost(
  view: EditorView,
  alive: () => boolean
): TagsMenuHost {
  const active = () => alive() && view.isMounted;
  const insert = async (
    tag: Parameters<TagsMenuHost['insertTag']>[0]
  ): Promise<void> => {
    const removal = await dispatchApplicationCommandSettled(
      view,
      'group-a.search-remove',
      {}
    );
    if (removal.status === 'error') throw removal.error;
    if (removal.status === 'cancelled' || !active()) return;
    const inserted = await dispatchApplicationCommandSettled(
      view,
      'group-a.insert-tag-mention',
      {
        optionId: tag.optionId,
        propertyDefinitionId: tag.propertyDefinitionId,
        scope: tag.scope,
        name: tag.name,
        ...(tag.color === undefined ? {} : { color: tag.color }),
      }
    );
    if (inserted.status === 'error') throw inserted.error;
  };
  return {
    root: () => (active() ? view.root : null),
    closeSearch() {
      // Closing the UI writes only under current session edit access.
      if (active())
        dispatchApplicationCommandIfSessionEdit(
          view,
          'group-a.search-close',
          {}
        );
    },
    insertTag(tag) {
      if (!active()) return;
      fireAndForget(insert(tag), 'native-tags-menu');
    },
  };
}
