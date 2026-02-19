import type { EntityData } from '../types/entity';
import { EntityIcon } from '../extractors/entity-icon';
import { EntityTitle } from '../extractors/entity-title';

export function InlineEntity(props: { entity: EntityData }) {
  return (
    <div class="flex items-center gap-1 min-w-0 truncate">
      <span class="size-[1.25em] shrink-0">
        <EntityIcon entity={props.entity} />
      </span>
      <EntityTitle entity={props.entity} />
    </div>
  );
}
