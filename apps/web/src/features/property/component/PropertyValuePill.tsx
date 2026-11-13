import { t } from '@app/lib/i18n';
import { cn } from '@ui';
import { type ComponentProps, type JSX, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SYSTEM_PROPERTY_IDS } from '../identifiers';
import { Property } from '../property';
import { getEntityValues, hasValue } from '../utils';
import { EntityLinkPill } from './EntityLinkPill';
import { ProjectLinkPill } from './ProjectLinkPill';
import { SourceLinkPill } from './SourceLinkPill';

type PropertyValuePillProps = Pick<
  ComponentProps<typeof Property.Root>,
  'property' | 'canEdit' | 'onSave' | 'onEdit'
> & {
  emptyLabel?: JSX.Element;
  showLabel?: boolean;
  class?: string;
  iconClass?: string;
  variant?: ComponentProps<typeof Property.Pill>['variant'];
  size?: ComponentProps<typeof Property.Pill>['size'];
  hoverActions?: JSX.Element;
  hoverTrailingAction?: JSX.Element;
  entitySelfFilter?: ComponentProps<
    typeof Property.PopoverEditor
  >['entitySelfFilter'];
  /** The pill's name opens the task's project, leaving the caret to change it. */
  opensProject?: boolean;
  /** The editor the pill opens; `Property.SheetEditor` inside a touch sheet. */
  editor?: typeof Property.PopoverEditor;
};

/** Controlled property pill shared by task and project composers. */
export function PropertyValuePill(props: PropertyValuePillProps) {
  return (
    <Property.Root
      property={props.property}
      canEdit={props.canEdit}
      onSave={props.onSave}
      onEdit={props.onEdit}
    >
      {(property) => {
        const isUserEntity = () =>
          property().valueType === 'ENTITY' &&
          property().specificEntityType === 'USER';
        const isMultiUserEntity = () =>
          isUserEntity() && getEntityValues(property()).length > 1;
        /** One referenced item other than a person: its name opens the item. */
        const isLinkableEntity = () =>
          property().valueType === 'ENTITY' &&
          !isUserEntity() &&
          getEntityValues(property()).length === 1;

        const pill = () => (
          <Property.Pill
            class={props.class}
            variant={props.variant ?? 'outline'}
            size={props.size}
          >
            <Show
              when={
                props.showLabel &&
                property().propertyDefinitionId !==
                  SYSTEM_PROPERTY_IDS.SOURCE &&
                hasValue(property())
              }
            >
              <span class="shrink-0 text-ink-muted">
                {property().displayName}:
              </span>
            </Show>
            <span class="inline-flex min-w-0 items-center gap-1">
              <Show when={hasValue(property())}>
                <Switch
                  fallback={
                    <Property.Icon
                      property={property()}
                      class={cn('shrink-0', props.iconClass)}
                    />
                  }
                >
                  <Match when={isMultiUserEntity()}>
                    <Property.UserStack property={property()} maxUsers={2} />
                  </Match>
                  <Match when={isUserEntity()}>
                    <Property.Icon property={property()} />
                  </Match>
                </Switch>
              </Show>
              <Property.Text
                property={property()}
                hideIcon={property().specificEntityType === 'INITIATIVE'}
                resolveSingleEntity={
                  props.showLabel ||
                  property().specificEntityType === 'INITIATIVE'
                }
                class="min-w-0 max-w-60"
                fallback={
                  <Property.Empty
                    propertyDefinitionId={property().propertyDefinitionId}
                    label={props.emptyLabel ?? property().displayName}
                    iconClass={props.iconClass}
                  />
                }
              />
            </span>
            <Property.Caret />
          </Property.Pill>
        );

        return (
          <>
            <Property.Tooltip
              property={property()}
              actions={props.hoverActions}
              trailingAction={props.hoverTrailingAction}
            >
              <Switch fallback={pill()}>
                <Match
                  when={
                    property().propertyDefinitionId ===
                    SYSTEM_PROPERTY_IDS.SOURCE
                  }
                >
                  <SourceLinkPill
                    property={property()}
                    class={props.class}
                    iconClass={props.iconClass}
                    fallback={pill()}
                  />
                </Match>
                <Match when={props.opensProject}>
                  <ProjectLinkPill
                    property={property()}
                    class={props.class}
                    iconClass={props.iconClass}
                    fallback={pill()}
                  />
                </Match>
                <Match when={isLinkableEntity()}>
                  <EntityLinkPill
                    property={property()}
                    class={props.class}
                    iconClass={props.iconClass}
                    fallback={pill()}
                    label={props.showLabel ? property().displayName : undefined}
                    openLabel={(name) =>
                      t('entityActions.openEntityNamed', { name })
                    }
                    changeLabel={t('entityActions.changeEntity', {
                      property: property().displayName,
                    })}
                  />
                </Match>
              </Switch>
            </Property.Tooltip>
            <Dynamic
              component={props.editor ?? Property.PopoverEditor}
              entitySelfFilter={props.entitySelfFilter}
            />
          </>
        );
      }}
    </Property.Root>
  );
}
