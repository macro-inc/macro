import { t } from '@app/lib/i18n';
import LinkBreakIcon from '@icon/system/regular/link-break.svg';
import PushPinSlashIcon from '@icon/system/regular/push-pin-slash.svg';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { usePropertiesContext } from '@property/context/PropertiesContext';
import { openPropertyEditor } from '@property/editor/state/propertyEditor';
import type { Property as PropertyT } from '@property/types';
import { hasValue, toPropertyApiValue } from '@property/utils';
import { Button } from '@ui';
import {
  type Component,
  type ComponentProps,
  createSignal,
  type JSX,
  Show,
} from 'solid-js';

type InlinePropertyValueProps = {
  property: PropertyT;
  /** Owning entity ID; a composer has no entity yet, so it passes none. */
  entityId?: string;
  /** Label rendered when the property is empty. Defaults to "None". */
  emptyLabel?: JSX.Element;
  class?: string;
  iconClass?: string;
  showLabel?: boolean;
  canManage?: boolean;
  /** The editor the pill opens; see `PropertyValuePill`. */
  editor?: ComponentProps<typeof PropertyValuePill>['editor'];
};

/**
 * Inline property pill shown beneath a task title when the side panel is
 * closed. Built from @property primitives — same visual surface as before,
 * but routes through Property.Root / Tooltip / Pill so any property
 * type renders correctly without bespoke per-type components.
 */
export const InlinePropertyValue: Component<InlinePropertyValueProps> = (
  props
) => {
  const ctx = usePropertiesContext();
  const usesInlineEditor = () =>
    ['STRING', 'NUMBER', 'BOOLEAN', 'LINK'].includes(props.property.valueType);
  const canManage = () =>
    props.canManage && ctx.canEdit && !props.property.isMetadata;
  const canUnlink = () =>
    canManage() &&
    !props.property.isRequired &&
    !props.property.propertyId.startsWith('pending:') &&
    hasValue(props.property);
  const [unlinking, setUnlinking] = createSignal(false);
  const unlink = async () => {
    if (unlinking()) return;
    const cleared = toPropertyApiValue(props.property, null);
    if (!cleared) return;
    setUnlinking(true);
    try {
      await ctx.saveHandler.saveProperty(props.property, cleared);
    } catch {
      // The save handler reports the failure and keeps the value.
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <PropertyValuePill
      property={props.property}
      variant="secondary"
      size="xs"
      showLabel={
        props.showLabel ??
        (props.property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.STATUS &&
          props.property.propertyDefinitionId !==
            SYSTEM_PROPERTY_IDS.PRIORITY &&
          !(
            ctx.entityType === 'TASK' &&
            (props.property.propertyDefinitionId ===
              SYSTEM_PROPERTY_IDS.ASSIGNEES ||
              props.property.propertyDefinitionId ===
                SYSTEM_PROPERTY_IDS.PROJECT)
          ))
      }
      canEdit={ctx.canEdit}
      onSave={ctx.saveHandler.saveProperty}
      onEdit={
        props.entityId && usesInlineEditor()
          ? (property, anchor) =>
              openPropertyEditor(
                [
                  {
                    id: props.entityId!,
                    name: ctx.documentName ?? 'Document',
                    entityType: ctx.entityType,
                  },
                ],
                'direct',
                property,
                { restoreFocus: () => anchor?.focus() }
              )
          : undefined
      }
      class={props.class}
      iconClass={props.iconClass ?? 'size-3 touch:size-4 shrink-0'}
      emptyLabel={props.emptyLabel}
      opensProject={
        props.entityId !== undefined &&
        ctx.entityType === 'TASK' &&
        props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT
      }
      hoverTrailingAction={
        <Show when={canManage()}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('entityActions.unpinProperty')}
            disabled={unlinking()}
            onClick={() =>
              ctx.onPropertyUnpinned?.(
                props.property.propertyId,
                props.property.propertyDefinitionId
              )
            }
          >
            <PushPinSlashIcon class="size-3.5 shrink-0" />
          </Button>
        </Show>
      }
      hoverActions={
        <Show when={canUnlink()}>
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left hover:bg-hover disabled:opacity-50"
            disabled={unlinking()}
            onClick={unlink}
          >
            <LinkBreakIcon class="size-3.5 shrink-0" />
            {unlinking()
              ? t('entityActions.unlinking')
              : t('entityActions.unlinkValue')}
          </button>
        </Show>
      }
      entitySelfFilter={{ entityType: ctx.entityType, blockId: props.entityId }}
      editor={props.editor}
    />
  );
};
