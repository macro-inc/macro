import { tryMacroId, useDisplayNameParts } from '@core/user';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { Property } from '../types';
import {
  formatBoolean,
  formatDate,
  formatNumber,
  formatPropertyValue,
  getEntityValues,
  getLinkValues,
  getSelectValues,
  hasValue,
  isBooleanProperty,
  isDateProperty,
  isEntityProperty,
  isLinkProperty,
  isNumberProperty,
  isSelectProperty,
  isStringProperty,
} from '../utils';

type Props = {
  property: Property;
  /** Rendered when the property has no value. */
  fallback?: JSX.Element;
  class?: string;
  /** Override the rendered text (overrides default extraction). */
  text?: string;
};

/**
 * Renders a property's value as text (single-line, truncate-friendly).
 *
 * Routes by valueType to produce the right representation:
 * - STRING: raw value
 * - NUMBER: formatted number
 * - BOOLEAN: "True"/"False"
 * - DATE: formatted date
 * - SELECT_*: first option's display label
 * - ENTITY+USER (single): user's first name
 * - ENTITY+USER (multi): "N people"
 * - ENTITY (non-user): "1 item" / "N items"
 * - LINK: first URL
 *
 * Caller is responsible for any container/border/padding.
 */
export function PropertyText(props: Props) {
  const userId = () => {
    if (props.text !== undefined) return undefined;
    if (!isEntityProperty(props.property)) return undefined;
    if (props.property.specificEntityType !== 'USER') return undefined;

    const entities = getEntityValues(props.property);
    return entities.length === 1 ? entities[0].entity_id : undefined;
  };

  return (
    <Show
      when={userId()}
      fallback={
        <PrimitivePropertyText
          property={props.property}
          fallback={props.fallback}
          class={props.class}
          text={props.text}
        />
      }
    >
      {(id) => (
        <UserPropertyText
          id={id()}
          fallback={props.fallback}
          class={props.class}
        />
      )}
    </Show>
  );
}

function PrimitivePropertyText(props: Props) {
  const text = () => props.text ?? extractText(props.property);
  const empty = () => !text();

  return (
    <Show when={!empty()} fallback={props.fallback ?? null}>
      <span class={cn('truncate', props.class)}>{text()}</span>
    </Show>
  );
}

function UserPropertyText(props: {
  id: string;
  fallback?: JSX.Element;
  class?: string;
}) {
  const parts = useDisplayNameParts(tryMacroId(props.id), {
    emailFallback: 'local-part',
  });
  const text = () => parts.firstName() || parts.fullName();

  return (
    <Show when={text()} fallback={props.fallback ?? null}>
      <span class={cn('truncate', props.class)}>{text()}</span>
    </Show>
  );
}

function extractText(property: Property): string {
  if (!hasValue(property)) return '';

  if (isStringProperty(property)) return property.value ?? '';
  if (isNumberProperty(property))
    return property.value === null ? '' : formatNumber(property.value);
  if (isBooleanProperty(property))
    return property.value === null ? '' : formatBoolean(property.value);
  if (isDateProperty(property))
    return property.value === null ? '' : formatDate(property.value);

  if (isSelectProperty(property)) {
    const first = getSelectValues(property)[0];
    return first ? formatPropertyValue(property, first) : '';
  }

  if (isEntityProperty(property)) {
    const entities = getEntityValues(property);
    if (entities.length === 0) return '';
    if (property.specificEntityType === 'USER') {
      return entities.length === 2 ? '2 people' : `${entities.length} people`;
    }
    return entities.length === 1 ? '1 item' : `${entities.length} items`;
  }

  if (isLinkProperty(property)) {
    return getLinkValues(property)[0] ?? '';
  }

  return '';
}
