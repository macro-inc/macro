import { EntityIcon } from '@entity/extractors/entity-icon';
import { type EntityData, isGithubPrEntity } from '@entity/types/entity';

/** Shared entity icons sized for compact Home rows. */
export function HomeEntityIcon(props: { entity: EntityData }) {
  return (
    <span
      class="flex size-5 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <span
        class={
          props.entity.type === 'channel' &&
          props.entity.channelType === 'direct_message'
            ? 'size-5 overflow-hidden rounded-full'
            : 'size-4'
        }
      >
        <EntityIcon
          entity={props.entity}
          class={isGithubPrEntity(props.entity) ? undefined : 'text-current'}
          suppressClick
          showTooltip={false}
        />
      </span>
    </span>
  );
}
