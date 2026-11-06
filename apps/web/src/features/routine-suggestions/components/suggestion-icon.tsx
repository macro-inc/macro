import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import ChartIcon from '@icon/system/regular/chart-bar.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import CodeIcon from '@icon/system/regular/code.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FileTextIcon from '@icon/system/regular/file-text.svg';
import FlagIcon from '@icon/system/regular/flag.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import TagIcon from '@icon/system/regular/tag.svg';
import type { Surface } from '@service-scheduled-action/generated/schemas';
import { cn } from '@ui';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import { surfaceLook } from '../../routines/components/routine-template-strip';

/** What a catalog routine does, as an icon; others take their area's. */
function iconFor(surface: Surface, catalogKey: string | undefined) {
  return match(catalogKey)
    .with('email_tags', 'document_tags', () => TagIcon)
    .with('inbox', () => EnvelopeIcon)
    .with('invoices', 'triage', 'call_tasks', () => CheckSquareIcon)
    .with('brief', () => CalendarIcon)
    .with('stuck', () => FlagIcon)
    .with('updates', 'mentions', () => ChatIcon)
    .with('pipeline', () => ChartIcon)
    .with('pull_requests', () => CodeIcon)
    .with('agent_digest', () => SparkleIcon)
    .otherwise(() =>
      match(surface)
        .with('files', () => FileTextIcon)
        .with('calls', () => PhoneIcon)
        .otherwise(() => surfaceLook(surface).icon)
    );
}

/** A suggestion's icon in a soft violet tile. */
export function SuggestionIcon(props: {
  surface: Surface;
  /** The catalog routine it suggests, if any. */
  catalogKey?: string;
  class?: string;
}) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-bg text-violet-ink',
        props.class
      )}
    >
      <Dynamic
        component={iconFor(props.surface, props.catalogKey)}
        class="size-4"
      />
    </span>
  );
}
