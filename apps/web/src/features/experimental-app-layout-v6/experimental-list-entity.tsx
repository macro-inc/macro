import { isSkillEntity, ListEntity } from '@entity';
import { cn } from '@ui';
import type { ComponentProps } from 'solid-js';
import { useExperimentalPowersDetails } from './experimental-powers-details-context';

/** Comfortable generic soup row used only inside experimental list views. */
export function ExperimentalListEntity(
  props: ComponentProps<typeof ListEntity>
) {
  const powersDetails = useExperimentalPowersDetails();
  const selected = () => {
    const detail = powersDetails?.detail();
    return detail?.kind === 'entity' && detail.entity.id === props.entity.id;
  };
  const handleClick = (event: MouseEvent) => {
    if (
      powersDetails &&
      isSkillEntity(props.entity) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey
    ) {
      powersDetails.select({ kind: 'entity', entity: props.entity });
      return;
    }
    props.onClick?.(event);
  };

  return (
    <div
      class={cn(
        'w-full [&_.soup-list-entity]:mx-0 [&_.soup-list-entity]:min-h-11 [&_.soup-list-entity]:w-full [&_.soup-list-entity]:rounded-xl [&_.soup-list-entity]:py-1',
        selected() && '[&_.soup-list-entity]:bg-active'
      )}
    >
      <ListEntity {...props} onClick={handleClick} />
    </div>
  );
}
