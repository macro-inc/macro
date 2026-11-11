import PushPinIcon from '@icon/system/regular/push-pin.svg';
import PushPinSlashIcon from '@icon/system/regular/push-pin-slash.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import type { Property } from '@property/types';
import { Button } from '@ui';
import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  Show,
  type Signal,
  useContext,
} from 'solid-js';

type PropertyRowActionsContextValue = {
  canPin: Accessor<boolean>;
  canRemove: Accessor<boolean>;
  reservePin: Accessor<boolean>;
  reserveRemove: Accessor<boolean>;
  isPinned: Accessor<boolean>;
  isSaving: Accessor<boolean>;
  pinLabel: Accessor<string>;
  togglePin: (event: MouseEvent) => void;
  removeFromEntity: (event: MouseEvent) => Promise<void>;
};

const PropertyRowActionsContext =
  createContext<PropertyRowActionsContextValue>();

export function isPendingProperty(property: Property): boolean {
  return property.propertyId.startsWith('pending:');
}

function usePropertyRowActions() {
  const context = useContext(PropertyRowActionsContext);
  if (!context) {
    throw new Error('Property row actions require PropertyRowActions.Root');
  }
  return context;
}

function PropertyRowActionsRoot(props: {
  canRemoveFromEntity: boolean;
  canPinPendingProperty?: boolean;
  onRemovePendingProperty: (property: Property) => void;
  onPropertyPinned?: (propertyId: string) => void;
  property: Property;
  saving?: Signal<boolean>;
  onRefresh?: () => Promise<unknown>;
  children: JSX.Element;
}) {
  const ctx = usePropertiesContext();
  const [isSaving, setIsSaving] = props.saving ?? createSignal(false);

  const panelCanRemove = () => ctx.canEdit && Boolean(ctx.removeProperty);
  const panelCanPin = () =>
    ctx.canEdit &&
    Boolean(
      props.onPropertyPinned && ctx.onPropertyUnpinned && ctx.pinnedPropertyIds
    );
  const canRemove = () =>
    props.canRemoveFromEntity &&
    ctx.canEdit &&
    !props.property.isMetadata &&
    (isPendingProperty(props.property) || Boolean(ctx.removeProperty));
  const canPin = () =>
    panelCanPin() &&
    !props.property.isMetadata &&
    (!isPendingProperty(props.property) ||
      props.canPinPendingProperty === true);
  const isPinned = () =>
    ctx.pinnedPropertyIds?.().includes(props.property.propertyId) ?? false;
  const pinLabel = () => (isPinned() ? 'Unpin from title' : 'Pin below title');

  const stopRowInteraction = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const togglePin = (event: MouseEvent) => {
    stopRowInteraction(event);
    if (!canPin() || isSaving()) return;
    if (isPinned()) {
      ctx.onPropertyUnpinned?.(
        props.property.propertyId,
        props.property.propertyDefinitionId
      );
    } else {
      props.onPropertyPinned?.(props.property.propertyId);
    }
  };

  const removeFromEntity = async (event: MouseEvent) => {
    stopRowInteraction(event);
    if (!canRemove() || isSaving()) return;

    if (isPendingProperty(props.property)) {
      props.onRemovePendingProperty(props.property);
      return;
    }

    const remove = ctx.removeProperty;
    if (!remove) return;

    setIsSaving(true);
    try {
      await remove(props.property.propertyId);
      ctx.onPropertyUnpinned?.(
        props.property.propertyId,
        props.property.propertyDefinitionId
      );
      await (props.onRefresh ?? ctx.onRefresh)();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PropertyRowActionsContext.Provider
      value={{
        canPin,
        canRemove,
        reservePin: () => panelCanPin() || canPin(),
        reserveRemove: () => panelCanRemove() || canRemove(),
        isPinned,
        isSaving,
        pinLabel,
        togglePin,
        removeFromEntity,
      }}
    >
      <Show when={panelCanRemove() || panelCanPin() || canRemove() || canPin()}>
        <div
          class="flex shrink-0 items-center gap-0.5"
          onMouseDown={stopRowInteraction}
        >
          {props.children}
        </div>
      </Show>
    </PropertyRowActionsContext.Provider>
  );
}

/** Keeps a row's action column aligned when one of its actions is unavailable. */
function ActionSlot() {
  return <span aria-hidden="true" class="size-6 shrink-0 touch:size-9" />;
}

function PropertyPinAction() {
  const actions = usePropertyRowActions();

  return (
    <Show
      when={actions.canPin()}
      fallback={
        <Show when={actions.reservePin()}>
          <ActionSlot />
        </Show>
      }
    >
      <Button
        variant="ghost"
        size="icon-xs"
        data-property-row-action
        title={actions.pinLabel()}
        aria-label={actions.pinLabel()}
        aria-pressed={actions.isPinned()}
        disabled={actions.isSaving()}
        class="text-ink-extra-muted aria-pressed:bg-button-tertiary-bg aria-pressed:not-data-disabled:hover:bg-button-tertiary-hover"
        onClick={actions.togglePin}
      >
        <Show
          when={actions.isPinned()}
          fallback={<PushPinIcon class="size-4" />}
        >
          <PushPinSlashIcon class="size-4 text-accent" />
        </Show>
      </Button>
    </Show>
  );
}

function PropertyRemoveAction() {
  const actions = usePropertyRowActions();

  return (
    <Show
      when={actions.canRemove()}
      fallback={
        <Show when={actions.reserveRemove()}>
          <ActionSlot />
        </Show>
      }
    >
      <Button
        variant="danger-ghost"
        size="icon-xs"
        data-property-row-action
        tooltip="Remove from entity"
        aria-label="Remove from entity"
        disabled={actions.isSaving()}
        class="transition pointer-events-none opacity-0 group-hover/property-row:pointer-events-auto group-hover/property-row:opacity-100 group-focus-within/property-row:pointer-events-auto group-focus-within/property-row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 touch:pointer-events-auto touch:opacity-100"
        onClick={actions.removeFromEntity}
      >
        <TrashIcon class="size-4" />
      </Button>
    </Show>
  );
}

export const PropertyRowActions = {
  Root: PropertyRowActionsRoot,
  Pin: PropertyPinAction,
  Remove: PropertyRemoveAction,
};
