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

/** Inline entity link. Existing sources open in the demo; other links navigate normally. */
export function HomepageMention(props: {
  kind: keyof typeof mentionIcons;
  label: string;
  description: string;
  href: string;
  onOpen?: (trigger: HTMLAnchorElement) => void;
}) {
  return (
    <a
      class="homepage-mention"
      href={props.href}
      target={
        props.href.startsWith('/') && !props.onOpen ? '_blank' : undefined
      }
      rel={
        props.href.startsWith('/') && !props.onOpen ? 'noreferrer' : undefined
      }
      aria-description={props.description}
      onClick={(event) => {
        if (
          !props.onOpen ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        )
          return;
        event.preventDefault();
        props.onOpen(event.currentTarget);
      }}
    >
      <Dynamic
        component={mentionIcons[props.kind].icon}
        class={`size-4.5 shrink-0 ${mentionIcons[props.kind].color}`}
        aria-hidden="true"
      />
      <span>{props.label}</span>
    </a>
  );
}
