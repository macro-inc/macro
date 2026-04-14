import { BlockLink } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Component, createSignal, type ParentProps, Show } from 'solid-js';
import { usePropertyEntityDisplay } from '../../hooks';
import type { Property } from '../../types';
import DeleteIcon from '@icon/bold/x-bold.svg';

type EntityValueDisplayProps = ParentProps<{
  property: Property;
  entityId: string;
  entityType: EntityType;
  specificMessageId?: string | null;
  canEdit?: boolean;
  onRemove?: () => void;
  onEdit?: (anchor?: HTMLElement) => void;
  isSaving?: boolean;
}>;

export const EntityIcon: Component<EntityValueDisplayProps> = (props) => {
  const [isHovered, setIsHovered] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  const { name, icon, blockOrFileType, linkParams } = usePropertyEntityDisplay(
    () => props.entityId,
    () => props.entityType,
    {
      specificMessageId: () => props.specificMessageId,
    }
  );

  const content = (
    <div class="flex items-center gap-2">
      <div class="flex-shrink-0">{icon()}</div>
      <span class="truncate">{name()}</span>
    </div>
  );

  const innerContent = (
    <Show when={blockOrFileType()} fallback={props.children ?? content}>
      {(linkType) => (
        <BlockLink
          blockOrFileName={linkType()}
          id={props.entityId}
          params={linkParams()}
        >
          {props.children ?? content}
        </BlockLink>
      )}
    </Show>
  );

  const handleClick = (e: MouseEvent) => {
    if (!props.canEdit || !props.onEdit) return;
    e.stopPropagation();
    props.onEdit(containerRef);
  };

  return (
    <div
      ref={containerRef}
      class="relative inline-flex max-w-[140px] shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        class="px-2 py-0.5 border border-edge-muted hover:bg-hover bg-transparent text-ink inline-flex items-center w-full"
        onClick={handleClick}
        role={props.canEdit && props.onEdit ? 'button' : undefined}
        tabIndex={props.canEdit && props.onEdit ? 0 : undefined}
      >
        <span class="truncate flex-1">{innerContent}</span>
        <Show
          when={
            props.canEdit && isHovered() && !props.isSaving && props.onRemove
          }
        >
          <div
            class="absolute right-0 inset-y-0 flex items-center pr-1 pl-2 bg-gradient-to-r from-transparent to-hover to-40%"
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            <Show when={props.onRemove}>
              <button
                onClick={() => props.onRemove!()}
                disabled={props.isSaving}
                class="size-4 p-0.5 flex items-center justify-center text-ink-muted hover:text-failure-ink"
              >
                <DeleteIcon class="size-3" />
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};
