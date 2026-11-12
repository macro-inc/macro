import GitHubIcon from '@icon/mcp-github.svg';
import CrmIcon from '@icon/system/regular/building-office.svg';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import RoutinesIcon from '@icon/system/regular/clock-clockwise.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import MailIcon from '@icon/system/regular/envelope.svg';
import DocsIcon from '@icon/system/regular/file.svg';
import DriveIcon from '@icon/system/regular/folder-simple.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import TasksIcon from '@icon/system/regular/list-checks.svg';
import CallsIcon from '@icon/system/regular/phone-call.svg';
import CanvasIcon from '@icon/system/regular/shapes.svg';
import AgentsIcon from '@icon/system/regular/sparkle.svg';
import SpreadsheetsIcon from '@icon/wide-spreadsheet.svg';
import SkillsIcon from '@phosphor/blueprint.svg';
import SnippetsIcon from '@phosphor/brackets-curly.svg';
import ChatIcon from '@phosphor/chats-circle.svg';
import FormsIcon from '@phosphor/clipboard-text.svg';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import './product-mention.css';

const products = [
  { name: 'Macro Mail', href: '/email', icon: MailIcon },
  { name: 'Macro CRM', href: '/crm', icon: CrmIcon },
  { name: 'Macro Chat', href: '/channels', icon: ChatIcon },
  { name: 'Macro Tasks', href: '/tasks', icon: TasksIcon },
  { name: 'Macro Docs', href: '/documents', icon: DocsIcon },
  { name: 'Macro Calls', href: '/calls', icon: CallsIcon },
  { name: 'Macro Agents', href: '/agents', icon: AgentsIcon },
  { name: 'Macro Calendar', href: '/calendar', icon: CalendarIcon },
  { name: 'Macro Databases', href: '/databases', icon: DatabaseIcon },
  { name: 'Macro Booking Links', href: '/booking-links', icon: LinkIcon },
  { name: 'Macro Drive', href: '/drive', icon: DriveIcon },
  { name: 'Macro Forms', href: '/forms', icon: FormsIcon },
  { name: 'Macro Spreadsheets', href: '/spreadsheets', icon: SpreadsheetsIcon },
  { name: 'Macro Canvas', href: '/canvas', icon: CanvasIcon },
  { name: 'Macro Routines', href: '/routines', icon: RoutinesIcon },
  { name: 'Macro Skills', href: '/skills', icon: SkillsIcon },
  { name: 'Macro Snippets', href: '/snippets', icon: SnippetsIcon },
  { name: 'Macro GitHub', href: '/github', icon: GitHubIcon },
];
const productNames = new RegExp(
  `(${products.map((product) => product.name).join('|')})`,
  'g'
);

/** Explicit product names in section copy become navigable product mentions. */
export function ProductCopy(props: { text: string }) {
  return (
    <For each={props.text.split(productNames)}>
      {(part) => (
        <Show
          when={products.find((product) => product.name === part)}
          fallback={part}
        >
          {(product) => (
            <a class="product-mention" href={product().href}>
              <Dynamic component={product().icon} aria-hidden="true" />
              <span>{product().name.replace('Macro ', '')}</span>
            </a>
          )}
        </Show>
      )}
    </For>
  );
}
