import '@entity/composed/ListEntity.css';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createEntityDraggable, Entity, unreadFilterFn } from '@entity';
import { NarrowLayout } from '@entity/composed/list-entity/narrow-layout';
import {
  type BaseListEntityProps,
  type LayoutProps,
  useListLayout,
} from '@entity/composed/list-entity/shared';
import { mergeRefs } from '@solid-primitives/refs';
import { cn } from '@ui/utils/classname';
import { Match, Switch } from 'solid-js';
import { AgentGridLayout } from './agent-grid-layout';

/**
 * Agent-session list entity: the wide layout renders the session grid
 * (status / model / harness columns), narrow containers fall back to the
 * shared narrow layout. Sessions are propertyless, non-editable rows.
 */
export function AgentListEntity(props: BaseListEntityProps) {
  const unread = () => unreadFilterFn(props.entity);

  const layoutProps = (): LayoutProps => ({
    entity: props.entity,
    checked: props.checked,
    hideCheckbox: props.hideCheckbox,
    onChecked: props.onChecked,
    unread: unread(),
    isShared: false,
    hasNotifications: false,
    showHitSnippet: false,
    setSnippetContainerRef: () => {},
    chars: 0,
  });

  const draggable = createEntityDraggable({
    entity: props.entity,
    splitId: useSplitPanel()?.handle?.id,
  });

  const isWide = useListLayout()?.isWide ?? (() => true);

  return (
    <Entity.Root
      entity={props.entity}
      onClick={(e) => {
        if (e.metaKey && props.onChecked) {
          props.onChecked(!props.checked, e.shiftKey);
          return;
        }
        props.onClick?.(e);
      }}
      ref={mergeRefs(props.ref, draggable)}
      class={cn(
        'soup-list-entity @container/entity w-[calc(100%-0.5rem)] mr-1 relative group/narrow flex flex-col py-0.5 rounded-lg',
        {
          'min-h-10 mx-1': !isMobile(),
          'bg-list-selected': props.checked,
          'bg-list-selected-highlighted':
            props.checked && props.highlighted && !isTouchDevice(),
          'bg-list-highlighted':
            props.highlighted && !props.checked && !isTouchDevice(),
          'hover:bg-list-hover':
            !props.highlighted && !props.checked && !isTouchDevice(),
        }
      )}
      onMouseMove={props.onMouseMove}
    >
      <Switch>
        <Match when={isWide()}>
          <AgentGridLayout {...layoutProps()} />
        </Match>
        <Match when={true}>
          <NarrowLayout {...layoutProps()} />
        </Match>
      </Switch>
    </Entity.Root>
  );
}
