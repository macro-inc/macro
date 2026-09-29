import SpreadsheetIcon from '@icon/wide-spreadsheet.svg';
import CalendarIcon from '@phosphor/calendar.svg';
import EmailIcon from '@phosphor/envelope.svg';
import FileIcon from '@phosphor/file.svg';
import PdfIcon from '@phosphor/file-pdf.svg';
import ChannelIcon from '@phosphor/hash-straight.svg';
import TaskIcon from '@phosphor/list-checks.svg';
import CallIcon from '@phosphor/phone-call.svg';
import { Dynamic } from 'solid-js/web';

// Direct icon imports keep the authenticated block registry/editor runtimes
// out of the public homepage's initial dependency graph.
const mentionIcons = {
  md: { icon: FileIcon, color: 'text-note' },
  task: { icon: TaskIcon, color: 'text-task' },
  email: { icon: EmailIcon, color: 'text-email' },
  channel: { icon: ChannelIcon, color: 'text-default' },
  spreadsheet: { icon: SpreadsheetIcon, color: 'text-success' },
  call: { icon: CallIcon, color: 'text-default' },
  calendar: { icon: CalendarIcon, color: 'text-default' },
  pdf: { icon: PdfIcon, color: 'text-pdf' },
};

import { HoverCard } from '@ui/components/HoverCard';
import { createSignal } from 'solid-js';

/** A local example entity, using the app's icon and hover-card primitives. */
export function HomepageMention(props: {
  kind:
    | 'md'
    | 'pdf'
    | 'task'
    | 'email'
    | 'channel'
    | 'spreadsheet'
    | 'call'
    | 'calendar';
  label: string;
  description: string;
  href: string;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <HoverCard
      triggerAs="span"
      triggerClass="inline"
      triggerTabIndex={-1}
      open={open()}
      onOpenChange={setOpen}
      placement="top"
      openDelay={180}
      closeDelay={150}
      trigger={
        <>
          <a
            class="homepage-mention"
            href={props.href}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onClick={() => setOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          >
            <Dynamic
              component={mentionIcons[props.kind].icon}
              class={`size-4.5 shrink-0 ${mentionIcons[props.kind].color}`}
              aria-hidden="true"
            />
            <span>{props.label}</span>
          </a>
          {'\u2060'}
        </>
      }
      content={
        <div class="workspace-demo glass max-w-72 rounded-2xl bg-panel p-4 text-sm text-ink shadow-lg">
          <div class="mb-2 flex items-center gap-2 font-medium">
            <Dynamic
              component={mentionIcons[props.kind].icon}
              class={`size-4.5 shrink-0 ${mentionIcons[props.kind].color}`}
              aria-hidden="true"
            />
            <span>{props.label}</span>
          </div>
          <p class="m-0 text-xs leading-5 text-ink-muted">
            {props.description}
          </p>
        </div>
      }
    />
  );
}
