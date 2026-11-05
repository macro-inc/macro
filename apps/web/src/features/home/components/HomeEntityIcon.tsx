import { ViewSidebar } from '@app/components/view-shell';
import { EntityIcon } from '@entity/extractors/entity-icon';
import type { EntityData } from '@entity/types/entity';

/** Shared entity icons sized for compact Home rows. */
export function HomeEntityIcon(props: { entity: EntityData }) {
  return (
    <ViewSidebar.Icon>
      <span
        class={
          props.entity.type === 'channel' &&
          props.entity.channelType === 'direct_message'
            ? 'size-5 overflow-hidden rounded-full'
            : 'size-4'
        }
      >
        <EntityIcon entity={props.entity} suppressClick showTooltip={false} />
      </span>
    </ViewSidebar.Icon>
  );
}
