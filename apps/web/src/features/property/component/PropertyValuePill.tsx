import { type ComponentProps, type JSX, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Property } from '../property';
import { getEntityValues, hasValue } from '../utils';
import { ProjectLinkPill } from './ProjectLinkPill';

type PropertyValuePillProps = Pick<
  ComponentProps<typeof Property.Root>,
  'property' | 'canEdit' | 'onSave' | 'onEdit'
> & {
  emptyLabel?: JSX.Element;
  showLabel?: boolean;
  class?: string;
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

        const pill = () => (
          <Property.Pill
            class={props.class}
            variant={props.variant ?? 'outline'}
            size={props.size}
          >
            <Show when={props.showLabel && hasValue(property())}>
              <span class="shrink-0 text-ink-muted">
                {property().displayName}:
              </span>
            </Show>
            <span class="inline-flex min-w-0 items-center gap-1">
              <Switch
                fallback={
                  <Property.Icon
                    property={property()}
                    class="size-3 shrink-0"
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
              <Property.Text
                property={property()}
                resolveSingleEntity={
                  props.showLabel ||
                  property().specificEntityType === 'INITIATIVE'
                }
                class="min-w-0 max-w-60"
                fallback={
                  <Property.Empty
                    label={props.emptyLabel ?? property().displayName}
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
              <Show when={props.opensProject} fallback={pill()}>
                <ProjectLinkPill
                  property={property()}
                  class={props.class}
                  fallback={pill()}
                />
              </Show>
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
