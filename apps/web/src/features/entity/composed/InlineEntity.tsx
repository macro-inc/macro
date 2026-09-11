import { Entity } from '../entity';
import type { EntityData } from '../types/entity';

// Goes through the `Entity` namespace like every other composed row rather
// than reaching into the extractors directly. Beyond matching them: the
// barrel exports this module before `./entity`, so importing an extractor
// here would start one mid-cycle and leave `entity.ts` reading a member that
// is still initializing.
export function InlineEntity(props: { entity: EntityData }) {
  return (
    <div class="flex items-center gap-1 min-w-0 truncate">
      <span class="size-[1.25em] shrink-0">
        <Entity.Icon entity={props.entity} />
      </span>
      <Entity.Title entity={props.entity} />
    </div>
  );
}
