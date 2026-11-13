import { t } from '@app/lib/i18n';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { usePropertyEntityDisplay } from '@property/hooks/usePropertyEntityDisplay';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import {
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
} from '@ui';
import { Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type NotificationStacksContext,
  NotificationStacksProvider,
} from './context/notification-stacks-context';
import type { StackEntityKind } from './core/stack';
import { createStacksSource } from './queries/stacks-source';
import { AddToStackDialog } from './views/add-to-stack-dialog';
import { StacksSection } from './views/stacks-section';

/** How the app's entity display names each kind a stack can capture. */
const displayType = (kind: StackEntityKind): EntityType =>
  match(kind)
    .returnType<EntityType>()
    .with('channel', () => 'CHANNEL')
    .with('document', () => 'DOCUMENT')
    // In the app's entity model a Drive folder is a project and a task
    // project is an initiative.
    .with('folder', () => 'PROJECT')
    .with('project', () => 'INITIATIVE')
    .with('person', () => 'USER')
    .exhaustive();

/** The entity types a picker searches; a stack's "document" is a document or a task. */
const pickerTypes = (kind: StackEntityKind): EntityType[] =>
  kind === 'document' ? ['DOCUMENT', 'TASK'] : [displayType(kind)];

const searchPlaceholder = (kind: StackEntityKind) =>
  match(kind)
    .with('channel', () => t('notificationStacks.searchChannel'))
    .with('document', () => t('notificationStacks.searchDocument'))
    .with('folder', () => t('notificationStacks.searchFolder'))
    .with('project', () => t('notificationStacks.searchProject'))
    .with('person', () => t('notificationStacks.searchPerson'))
    .exhaustive();

function EntityLabel(props: { kind: StackEntityKind; id: string }) {
  const display = usePropertyEntityDisplay(
    () => props.id,
    () => displayType(props.kind)
  );
  return (
    <>
      <span class="flex shrink-0 items-center">{display.icon()}</span>
      <span class="truncate">{display.name()}</span>
    </>
  );
}

function EntityPicker(props: {
  kind: StackEntityKind;
  ids: readonly string[];
  onChange: (ids: string[]) => void;
  fill?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <p class="p-3 text-sm text-ink-muted">
          {t('notificationStacks.pickerLoading')}
        </p>
      }
    >
      <PropertyEntitySelector
        config={{
          isMultiSelect: true,
          placeholder: searchPlaceholder(props.kind),
          specificEntityType: pickerTypes(props.kind),
          visibleCheckboxes: true,
          fillHeight: props.fill,
        }}
        selectedOptions={() => new Set(props.ids)}
        setSelectedOptions={(ids) => props.onChange([...ids])}
      />
    </Suspense>
  );
}

/** The stacks feature over the notification service and the app's entity pickers. */
function createAppNotificationStacksContext(): NotificationStacksContext {
  return { stacks: createStacksSource(), EntityLabel, EntityPicker };
}

/** The Stacks section of Settings → Notifications. */
export function NotificationStacksSection() {
  return (
    <NotificationStacksProvider value={createAppNotificationStacksContext()}>
      <StacksSection />
    </NotificationStacksProvider>
  );
}

function AddChannelToStackDialog(
  props: ManagedDialogProps & { channelId: string; channelName?: string }
) {
  return (
    <NotificationStacksProvider value={createAppNotificationStacksContext()}>
      <AddToStackDialog {...props} />
    </NotificationStacksProvider>
  );
}

/** Choose which stacks capture a channel. Menus call `openAddChannelToStack`. */
export function openAddChannelToStackDialog(
  channel: { id: string; name?: string },
  options?: OpenDialogOptions
) {
  openDialog(
    AddChannelToStackDialog,
    { channelId: channel.id, channelName: channel.name },
    options
  );
}
