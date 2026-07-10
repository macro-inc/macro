import '@entity/composed/ListEntity.css';
import { SwipableRow, SwipableRowContext } from '@app/component/mobile/SwipableRow';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createEntityDraggable, Entity, unreadFilterFn } from '@entity';
import { NarrowLayout } from '@entity/composed/list-entity/narrow-layout';
import {
  type BaseListEntityProps,
  type LayoutProps,
  useListLayout,
} from '@entity/composed/list-entity/shared';
import type { EntityRowConfig } from '@entity/extractors-notification';
import { mergeRefs } from '@solid-primitives/refs';
import { cn } from '@ui/utils/classname';
import { type JSX, Match, Show, Switch, useContext } from 'solid-js';
import { CompanyGridLayout } from './company-grid-layout';

function MaybeEntityRow(props: {
  entityId: string;
  children: JSX.Element;
  config?: EntityRowConfig;
}) {
  const ctx = useContext(SwipableRowContext);
  return (
    <Show when={isMobile() && ctx} fallback={props.children}>
      <SwipableRow
        id={props.entityId}
        swipeLeftColor={props.config?.swipeLeftColor}
        swipeLeftRevealedComponent={props.config?.swipeLeftRevealedComponent}
        swipeRightColor={props.config?.swipeRightColor}
        swipeRightRevealedComponent={props.config?.swipeRightRevealedComponent}
      >
        {props.children}
      </SwipableRow>
    </Show>
  );
}

/**
 * Customers-list row that renders CRM properties (Stage, Owner, Revenue)
 * in fixed-width grid columns so they line up vertically across rows,
 * mirroring `TaskListEntity`.
 */
export function CompanyListEntity(props: BaseListEntityProps) {
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
    streamState: undefined,
    setSnippetContainerRef: () => {},
    chars: 0,
    onProjectClick: props.onProjectClick,
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
          'bg-accent/8': props.checked,
          'bg-accent/16':
            props.checked && props.highlighted && !isTouchDevice(),
          'bg-active/60':
            props.highlighted && !props.checked && !isTouchDevice(),
          'hover:bg-active/30':
            !props.highlighted && !props.checked && !isTouchDevice(),
        }
      )}
      onMouseMove={props.onMouseMove}
    >
      <Switch>
        <Match when={isWide()}>
          <MaybeEntityRow
            entityId={props.entity.id}
            config={props.entityRowConfig}
          >
            <CompanyGridLayout {...layoutProps()} />
          </MaybeEntityRow>
        </Match>
        <Match when={true}>
          <MaybeEntityRow
            entityId={props.entity.id}
            config={props.entityRowConfig}
          >
            <NarrowLayout {...layoutProps()} />
          </MaybeEntityRow>
        </Match>
      </Switch>
    </Entity.Root>
  );
}
