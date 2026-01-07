import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { BlockLink } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import DeleteIcon from '@icon/bold/x-bold.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { type Component, createSignal, type ParentProps, Show } from 'solid-js';
import { usePropertyEntityDisplay } from '../../hooks';
import type { Property } from '../../types';

type EntityValueDisplayProps = ParentProps<{
  property: Property;
  entityId: string;
  entityType: EntityType;
  specificMessageId?: string | null;
  canEdit?: boolean;
  onRemove?: () => void;
  isSaving?: boolean;
}>;

export const EntityIcon: Component<EntityValueDisplayProps> = (props) => {
  const [isHovered, setIsHovered] = createSignal(false);

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
      <span class="truncate font-mono">{name()}</span>
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

  return (
    <div
      class="relative inline-flex max-w-[140px] shrink-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        class={`text-xs px-2 py-1 border border-edge hover:bg-hover cursor-pointer bg-transparent text-ink inline-flex items-center w-full min-h-[24px]`}
      >
        <span class="truncate flex-1">{innerContent}</span>
        <Show
          when={
            props.canEdit && isHovered() && !props.isSaving && props.onRemove
          }
        >
          <div class="absolute right-1 inset-y-0 flex items-center">
            <DeprecatedIconButton
              icon={DeleteIcon}
              theme="clear"
              size="xs"
              class="!text-failure !bg-[#2a2a2a] hover:!bg-[#444444] !cursor-pointer !w-4 !h-4 !min-w-4 !min-h-4"
              onClick={props.onRemove}
            />
          </div>
        </Show>
      </div>
    </div>
  );
};
