import { useUnfurl } from '@app/lib/queries/unfurl/unfurl';
import { UserIcon } from '@core/component/UserIcon';
import LinkIcon from '@icon/system/regular/link.svg';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { DateRangeProperty, Property } from '@property/types';
import {
  extractDomain,
  formatPropertyValue,
  formatTimeRange,
  isBooleanProperty,
  isDateProperty,
  isDateRangeProperty,
  isEntityProperty,
  isLinkProperty,
  isNumberProperty,
  isSelectProperty,
  isStringProperty,
  PropertyDataTypeIcon,
  hasValue as propertyHasValue,
} from '@property/utils';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import { proxyResource } from '@service-unfurl/proxy-resource';
import {
  children,
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
  trailingAction?: JSX.Element;
}>;

/**
 * Tooltip content component for property values
 * Routes to type-specific tooltip content based on valueType
 */
export const PropertyTooltip = (props: PropertyTooltipProps): JSX.Element => {
  return (
    <TooltipWrapper
      property={props.property}
      trailingAction={props.trailingAction}
    >
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
        <Match when={isDateRangeProperty(props.property) && props.property}>
          {(property) => <DateRangeTooltipContent property={property()} />}
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
    </TooltipWrapper>
  );
};

/**
 * Shared tooltip wrapper with consistent header styling
 */
const TooltipWrapper = (props: PropertyTooltipProps) => {
  const singleSelect = () => !props.property.isMultiSelect;
  const hasValue = () => propertyHasValue(props.property);
  const trailingAction = children(() => props.trailingAction);
  return (
    <Show
      when={hasValue()}
      fallback={
        <div class="flex min-w-0 items-center gap-4">
          <div class="text-xs">No {props.property.displayName} set</div>
          {trailingAction()}
        </div>
      }
    >
      <div
        classList={{
          'flex flex-row gap-2 items-center': singleSelect(),
          'min-w-48 max-w-72': !singleSelect(),
        }}
      >
        <div
          class="flex min-w-0 items-center gap-4"
          classList={{
            'border-b border-edge pb-1.5 mb-1.5': !singleSelect(),
          }}
        >
          <div class="flex min-w-0 items-center gap-2 text-ink-muted">
            <PropertyDataTypeIcon
              property={props.property}
              class="size-3.5 shrink-0 text-ink-muted"
            />
            <span class="min-w-0 text-xs">{props.property.displayName}</span>
          </div>
          <Show when={!singleSelect() && trailingAction.toArray().length > 0}>
            <div class="ml-auto shrink-0">{trailingAction()}</div>
          </Show>
        </div>
        {props.children}
        <Show when={singleSelect() && trailingAction.toArray().length > 0}>
          <div class="ml-2 shrink-0">{trailingAction()}</div>
        </Show>
      </div>
    </Show>
  );
};

const ValueContainer = (props: { children: JSX.Element }) => (
  <div class="inline-flex min-w-0 items-center gap-1.5 px-2 py-0.5 text-xs leading-5 text-ink-muted w-fit rounded-sm">
    {props.children}
  </div>
);

const StringTooltipContent = (props: {
  property: Property & { valueType: 'STRING' };
}) => {
  return (
    <div class="flex items-center gap-1.5 flex-wrap">
      <ValueContainer>
        <span class="truncate max-w-37.5">{props.property.value}</span>
      </ValueContainer>
    </div>
  );
};

const NumberTooltipContent = (props: {
  property: Property & { valueType: 'NUMBER' };
}) => {
  const displayValue = () =>
    formatPropertyValue(props.property, props.property.value);

  return (
    <div class="flex items-center gap-1.5 flex-wrap">
      <ValueContainer>
        <span class="truncate max-w-37.5">{displayValue()}</span>
      </ValueContainer>
    </div>
  );
};

const BooleanTooltipContent = (props: {
  property: Property & { valueType: 'BOOLEAN' };
}) => {
  const displayValue = () =>
    formatPropertyValue(props.property, props.property.value);

  return (
    <div class="flex items-center gap-1.5 flex-wrap">
      <ValueContainer>
        <span>{displayValue()}</span>
      </ValueContainer>
    </div>
  );
};

const DateTooltipContent = (props: {
  property: Property & { valueType: 'DATE' };
}) => {
  const displayValue = () =>
    formatPropertyValue(props.property, props.property.value);

  return (
    <div class="flex items-center gap-1.5 flex-wrap">
      <ValueContainer>
        <span class="truncate max-w-37.5">{displayValue()}</span>
      </ValueContainer>
    </div>
  );
};

const DateRangeTooltipContent = (props: { property: DateRangeProperty }) => (
  <TooltipWrapper property={props.property}>
    <div class="flex items-center gap-1.5 flex-wrap">
      <ValueContainer>
        <span class="truncate max-w-37.5">
          {props.property.value ? formatTimeRange(props.property.value) : ''}
        </span>
      </ValueContainer>
    </div>
  </TooltipWrapper>
);

const SelectTooltipContent = (props: {
  property: Property & { valueType: 'SELECT_STRING' | 'SELECT_NUMBER' };
}) => {
  const values = () => props.property.value ?? [];
  return (
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
  );
};

const EntityValuePill = (props: { entity: EntityReference }) => {
  const { name, icon } = usePropertyEntityDisplay(
    () => props.entity.entity_id,
    () => props.entity.entity_type,
    { fallbackIcon: null }
  );

  return (
    <ValueContainer>
      <Show when={icon()}>{icon()}</Show>
      <span class="min-w-0 truncate max-w-37.5">{name()}</span>
    </ValueContainer>
  );
};

const UserEntityItem = (props: { entity: EntityReference }) => {
  const { name } = usePropertyEntityDisplay(
    () => props.entity.entity_id,
    () => props.entity.entity_type,
    { fallbackIcon: null }
  );

  return (
    <ValueContainer>
      <div class="size-4 rounded-full overflow-hidden shrink-0">
        <UserIcon id={props.entity.entity_id} isDeleted={false} size="fill" />
      </div>
      <span class="min-w-0 truncate max-w-37.5">{name()}</span>
    </ValueContainer>
  );
};

const LinkTooltipContent = (props: {
  property: Property & { valueType: 'LINK' };
}) => {
  const links = () => props.property.value ?? [];

  return (
    <div class="flex items-center gap-1.5 flex-wrap">
      <For each={links()}>{(url) => <LinkValuePill url={url} />}</For>
    </div>
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
      class="inline-flex items-center gap-1.5 px-2 py-1 text-xs leading-none text-link hover:text-link-hover visited:text-link-visited h-fit w-fit rounded-sm"
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
