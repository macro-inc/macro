import StatusCanceled from '@icon/system/fill/task-canceled-fill.svg';
import StatusDone from '@icon/system/fill/task-completed-fill.svg';
import StatusCreated from '@icon/system/regular/task-created.svg';
import StatusInProgress from '@icon/system/regular/task-in-progress.svg';
import StatusInReview from '@icon/system/regular/task-in-review.svg';
import { PROPERTY_OPTION_IDS } from '@property/identifiers';
import { cn } from '@ui/utils/classname';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { EntityIconProps } from './EntityIcon';
import { ICON_SIZE_CLASSES } from './entity-icon-sizes';

const STATUS_ICONS: Record<
  string,
  {
    icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
    label: string;
    color: string;
  }
> = {
  [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED]: {
    icon: StatusCreated,
    label: 'Not started',
    color: 'text-task-status-not-started',
  },
  [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS]: {
    icon: StatusInProgress,
    label: 'In progress',
    color: 'text-task-status-in-progress',
  },
  [PROPERTY_OPTION_IDS.STATUS.IN_REVIEW]: {
    icon: StatusInReview,
    label: 'In review',
    color: 'text-task-status-in-review',
  },
  [PROPERTY_OPTION_IDS.STATUS.COMPLETED]: {
    icon: StatusDone,
    label: 'Completed',
    color: 'text-task-status-completed',
  },
  [PROPERTY_OPTION_IDS.STATUS.CANCELED]: {
    icon: StatusCanceled,
    label: 'Canceled',
    color: 'text-task-status-canceled',
  },
};

/** Task identity reflects its live status, including lightweight preview seeds. */
export function TaskStatusIcon(
  props: Omit<EntityIconProps, 'targetType' | 'shared'> & {
    statusId?: string;
    completed?: boolean;
    /** Hide the glyph from assistive technology when its caller supplies the label. */
    decorative?: boolean;
  }
) {
  const status = () => {
    const id = props.statusId;
    if (id && Object.hasOwn(STATUS_ICONS, id)) return STATUS_ICONS[id];
    return STATUS_ICONS[
      props.completed
        ? PROPERTY_OPTION_IDS.STATUS.COMPLETED
        : PROPERTY_OPTION_IDS.STATUS.NOT_STARTED
    ];
  };

  return (
    <span
      role="img"
      aria-label={`Task: ${status().label}`}
      aria-hidden={props.decorative || undefined}
      data-icon-motion="none"
      class={cn(
        ICON_SIZE_CLASSES[props.size ?? 'xs'],
        props.theme === 'monochrome' ? 'text-current' : status().color,
        props.useBackground && 'bg-task/20 p-[20%]',
        props.class
      )}
    >
      <Dynamic
        component={status().icon}
        class="size-full"
        stroke-width={props.weight === 'bold' ? '2.3' : '2'}
      />
    </span>
  );
}
