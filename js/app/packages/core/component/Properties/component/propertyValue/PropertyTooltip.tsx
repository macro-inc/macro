import { usePropertyEntityDisplay } from '@core/component/Properties/hooks';
import type { Property } from '@core/component/Properties/types';
import {
  extractDomain,
  formatPropertyValue,
  isBooleanProperty,
  isDateProperty,
  isEntityProperty,
  isLinkProperty,
  isNumberProperty,
  isSelectProperty,
  isStringProperty,
  PropertyDataTypeIcon,
  hasValue as propertyHasValue,
} from '@core/component/Properties/utils';
import { UserIcon } from '@core/component/UserIcon';
import { useUnfurl } from '@core/signal/unfurl';
import LinkIcon from '@icon/regular/link.svg';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { proxyResource } from '@service-unfurl/client';
import {
  createSignal,
  For,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { PropertyValueIcon } from './PropertyValueIcon';

type PropertyTooltipProps = ParentProps<{
  property: Property;
}>;

/**
 * Tooltip content component for property values
 * Routes to type-specific tooltip content based on valueType
 */
export const PropertyTooltip = (props: PropertyTooltipProps): JSX.Element => {
  return (
    <Switch>
      <Match when={isStringProperty(props.property) && props.property}>
        {(property) => <StringTooltipContent property={property()} />}
      </Match>
      <Match when={isNumberProperty(props.property) && props.property}>
        {(property) => <NumberTooltipContent property={property()} />}
      </Match>
      <Match when={isBooleanProperty(props.property) && props.property}>
        {(property) => <BooleanTooltipContent property={property()} />}
      </Match>
      <Match when={isDateProperty(props.property) && props.property}>
        {(property) => <DateTooltipContent property={property()} />}
      </Match>
      <Match when={isSelectProperty(props.property) && props.property}>
        {(property) => <SelectTooltipContent property={property()} />}
      </Match>
      <Match when={isEntityProperty(props.property) && props.property}>
        {(property) => <EntityTooltipContent property={property()} />}
      </Match>
      <Match when={isLinkProperty(props.property) && props.property}>
        {(property) => <LinkTooltipContent property={property()} />}
      </Match>
    </Switch>
  );
};

/**
 * Shared tooltip wrapper with consistent header styling
 */
const TooltipWrapper = (props: {
  property: Property;
  children: JSX.Element;
}) => {
  const singleSelect = () => !props.property.isMultiSelect;
  const hasValue = () => propertyHasValue(props.property);
  return (
    <Show
      when={hasValue()}
      fallback={
        <div class="p-2 border border-edge-muted bg-panel text-xs">
          No {props.property.displayName} set
        </div>
      }
    >
      <div
        class="p-2 border border-edge-muted bg-panel"
        classList={{
          'flex flex-row gap-2 items-center': singleSelect(),
          'min-w-48 max-w-72': !singleSelect(),
        }}
      >
        <div
          class="flex items-center gap-2 text-ink-muted"
          classList={{
            'border-b border-edge-muted pb-1.5 mb-1.5': !singleSelect(),
          }}
        >
          <PropertyDataTypeIcon
            property={props.property}
            class="size-3.5 text-ink-muted"
          />
          <span class="text-xs">{props.property.displayName}</span>
        </div>
        {props.children}
      </div>
    </Show>
  );
};

const ValueContainer = (props: { children: JSX.Element }) => (
  <div class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted border border-edge-muted size-fit">
    {props.children}
  </div>
);

const StringTooltipContent = (props: {
  property: Property & { valueType: 'STRING' };
}) => {
  return (
    <TooltipWrapper property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <ValueContainer>
          <span class="truncate max-w-37.5">{props.property.value}</span>
        </ValueContainer>
      </div>
    </TooltipWrapper>
  );
};

const NumberTooltipContent = (props: {
  property: Property & { valueType: 'NUMBER' };
}) => {
  const displayValue = () =>
    formatPropertyValue(props.property, props.property.value);

  return (
    <TooltipWrapper property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <ValueContainer>
          <span class="truncate max-w-37.5">{displayValue()}</span>
        </ValueContainer>
      </div>
    </TooltipWrapper>
  );
};

const BooleanTooltipContent = (props: {
  property: Property & { valueType: 'BOOLEAN' };
}) => {
  const displayValue = () =>
    formatPropertyValue(props.property, props.property.value);

  return (
    <TooltipWrapper property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <ValueContainer>
          <span>{displayValue()}</span>
        </ValueContainer>
      </div>
    </TooltipWrapper>
  );
};

const DateTooltipContent = (props: {
  property: Property & { valueType: 'DATE' };
}) => {
  const displayValue = () =>
    formatPropertyValue(props.property, props.property.value);

  return (
    <TooltipWrapper property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <ValueContainer>
          <span class="truncate max-w-37.5">{displayValue()}</span>
        </ValueContainer>
      </div>
    </TooltipWrapper>
  );
};

const SelectTooltipContent = (props: {
  property: Property & { valueType: 'SELECT_STRING' | 'SELECT_NUMBER' };
}) => {
  const values = () => props.property.value ?? [];
  return (
    <TooltipWrapper property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <For each={values()}>
          {(optionId, index) => (
            <ValueContainer>
              <SelectValueIcon property={props.property} valueIndex={index()} />
              <span class="truncate max-w-37.5">
                {formatPropertyValue(props.property, optionId)}
              </span>
            </ValueContainer>
          )}
        </For>
      </div>
    </TooltipWrapper>
  );
};

const SelectValueIcon = (props: {
  property: Property & { valueType: 'SELECT_STRING' | 'SELECT_NUMBER' };
  valueIndex: number;
}) => {
  const optionId = () => props.property.value?.[props.valueIndex];
  return (
    <Show when={optionId()}>
      <PropertyValueIcon optionId={optionId()!} class="size-3 shrink-0" />
    </Show>
  );
};

const EntityTooltipContent = (props: {
  property: Property & { valueType: 'ENTITY' };
}) => {
  const entities = () => props.property.value ?? [];
  const isUserType = () => props.property.specificEntityType === 'USER';

  return (
    <TooltipWrapper property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <Switch>
          <Match when={isUserType()}>
            <div class="flex flex-col gap-1.5">
              <For each={entities()}>
                {(entity) => <UserEntityItem entity={entity} />}
              </For>
            </div>
          </Match>
          <Match when={!isUserType()}>
            <For each={entities()}>
              {(entity) => <EntityValuePill entity={entity} />}
            </For>
          </Match>
        </Switch>
      </div>
    </TooltipWrapper>
  );
};

const EntityValuePill = (props: { entity: EntityReference }) => {
  const { name, icon } = usePropertyEntityDisplay(
    () => props.entity.entity_id,
    () => props.entity.entity_type as EntityType,
    { fallbackIcon: null }
  );

  return (
    <ValueContainer>
      <Show when={icon()}>{icon()}</Show>
      <span class="truncate max-w-37.5">{name()}</span>
    </ValueContainer>
  );
};

const UserEntityItem = (props: { entity: EntityReference }) => {
  const { name } = usePropertyEntityDisplay(
    () => props.entity.entity_id,
    () => props.entity.entity_type as EntityType,
    { fallbackIcon: null }
  );

  return (
    <ValueContainer>
      <div class="size-4 rounded-full overflow-hidden shrink-0">
        <UserIcon id={props.entity.entity_id} isDeleted={false} size="fill" />
      </div>
      <span class="truncate max-w-37.5">{name()}</span>
    </ValueContainer>
  );
};

const LinkTooltipContent = (props: {
  property: Property & { valueType: 'LINK' };
}) => {
  const links = () => props.property.value ?? [];

  return (
    <TooltipWrapper property={props.property}>
      <div class="flex items-center gap-1.5 flex-wrap">
        <For each={links()}>{(url) => <LinkValuePill url={url} />}</For>
      </div>
    </TooltipWrapper>
  );
};

const LinkValuePill = (props: { url: string }) => {
  const [unfurlData] = useUnfurl(props.url);
  const [imageError, setImageError] = createSignal(false);

  const title = () => {
    const data = unfurlData();
    if (data?.type === 'success' && data.data.title) {
      return data.data.title;
    }
    return extractDomain(props.url);
  };

  const faviconUrl = () => {
    const data = unfurlData();
    if (data?.type === 'success' && data.data.favicon_url) {
      return proxyResource(data.data.favicon_url);
    }
    return null;
  };

  return (
    <a
      href={props.url}
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-ink-muted border border-edge-muted size-fit"
      title={props.url}
    >
      <Show
        when={faviconUrl() && !imageError()}
        fallback={<LinkIcon class="size-4 text-ink-muted" />}
      >
        <img
          src={faviconUrl()!}
          class="size-4 object-cover rounded"
          crossorigin="anonymous"
          alt=""
          onError={() => setImageError(true)}
        />
      </Show>
      <span class="truncate max-w-37.5">{title()}</span>
    </a>
  );
};
