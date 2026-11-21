import { openProject } from '@app/features/projects/open-project';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { EntityIconProps } from '@core/component/EntityIcon';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import { createCallback } from '@solid-primitives/rootless';
import type { Accessor } from 'solid-js';
import { usePropertyEntityDisplay } from './usePropertyEntityDisplay';

/**
 * A referenced item's display and the click that opens it, shared by
 * `EntityLinkPill` and the side panel's collection chips. The click goes
 * through the mention-link path, in a new split on Shift; a project goes
 * through `openProject`, which retargets a split already showing it.
 */
export function usePropertyEntityLink(
  reference: Accessor<EntityReference | undefined>,
  options?: {
    iconSize?: EntityIconProps['size'];
    /** Name to show while the item's own read loads, such as a picker's label. */
    loadingName?: Accessor<string | undefined>;
  }
) {
  const layout = useSplitLayout();
  const display = usePropertyEntityDisplay(
    () => reference()?.entity_id ?? '',
    () => reference()?.entity_type,
    {
      iconSize: options?.iconSize,
      specificMessageId: () => reference()?.specific_message_id,
      loadingName: options?.loadingName,
    }
  );

  /** False for a value with no page to open: a person, or a document or project not loaded yet. */
  const canOpen = () =>
    Boolean(display.nativeProjectId() || display.blockOrFileType());

  // `openDocument` reads the surrounding split from context, which a plain
  // event handler runs without.
  const open = createCallback((event: MouseEvent) => {
    event.stopPropagation();
    const value = reference();
    if (!value) return;

    const projectId = display.nativeProjectId();
    if (projectId) {
      openProject(layout, projectId, { newSplit: event.shiftKey });
      return;
    }

    const type = display.blockOrFileType();
    if (!type) return;
    openDocument(type, value.entity_id, display.linkParams(), event.shiftKey);
  });

  return { display, canOpen, open };
}
