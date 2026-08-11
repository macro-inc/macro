import {
  EntityIcon,
  reminderReferenceIconType,
} from '@core/component/EntityIcon';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { isAccessiblePreviewItem } from '@queries/preview';
import { Show } from 'solid-js';
import { ReminderReferenceBadge } from '../../components/Badges';
import { Entity } from '../../entity';
import type { ReminderEntity } from '../../types/entity';

type Reference = NonNullable<ReminderEntity['referencedEntity']>;

/**
 * A reminder row always leads with the bell, so what it is about has to be
 * said beside its name.
 *
 * Which way round depends on whether the description is the user's own. The
 * composer's description step is optional, and skipping it names the reminder
 * after the entity — so the title either *is* the reference and takes its icon
 * inline, or it is the user's own text and the reference trails as a badge,
 * the way `CallWideContent` trails a call with its channel.
 */
export function ReminderWideContent(props: { entity: ReminderEntity }) {
  return (
    <Show
      when={props.entity.referencedEntity}
      fallback={
        <span class="truncate">
          <Entity.Title entity={props.entity} />
        </span>
      }
    >
      {(reference) => (
        <ReferencedReminder entity={props.entity} reference={reference()} />
      )}
    </Show>
  );
}

function ReferencedReminder(props: {
  entity: ReminderEntity;
  reference: Reference;
}) {
  const { item, name } = useItemPreviewData(() => ({
    id: props.reference.id,
    type: props.reference.type,
  }));

  // `name()` is the "Untitled" placeholder while the reference resolves and
  // for one the caller cannot see, so neither can be compared nor shown. Until
  // it lands the row is the bare description — no icon, no badge.
  const referenceName = () =>
    isAccessiblePreviewItem(item()) ? name().trim() || undefined : undefined;

  const titleIsReference = () => {
    const resolved = referenceName();
    return resolved !== undefined && resolved === props.entity.name?.trim();
  };

  return (
    <>
      {/* Grouped tighter than the row's own gap, so the icon reads as part of
          the name rather than as a second leading icon after the bell. */}
      <span class="flex min-w-0 items-center gap-1.5">
        <Show when={titleIsReference()}>
          <EntityIcon
            class="size-4 shrink-0"
            targetType={reminderReferenceIconType(props.reference)}
            size="fill"
          />
        </Show>
        <span class="truncate">
          <Entity.Title entity={props.entity} />
        </span>
      </span>
      <Show when={!titleIsReference() && referenceName()}>
        {(text) => (
          <ReminderReferenceBadge name={text()}>
            <EntityIcon
              class="size-3 shrink-0"
              targetType={reminderReferenceIconType(props.reference)}
              size="fill"
              theme="monochrome"
            />
          </ReminderReferenceBadge>
        )}
      </Show>
    </>
  );
}
