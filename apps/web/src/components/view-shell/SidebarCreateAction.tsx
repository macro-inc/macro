import BuildingsIcon from '@icon/system/regular/buildings.svg';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import TaskIcon from '@icon/system/regular/check-square.svg';
import RoutineIcon from '@icon/system/regular/clock-counter-clockwise.svg';
import EmailIcon from '@icon/system/regular/envelope.svg';
import FileIcon from '@icon/system/regular/file.svg';
import ProjectIcon from '@icon/system/regular/folder.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, type ButtonProps } from '@ui';
import {
  type Accessor,
  type Component,
  createContext,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

export const SidebarCreatePresentation = createContext<Accessor<string>>();

type CreateIcon = Component<{ class?: string }>;
const creationLabels: Record<string, { label: string; icon: CreateIcon }> = {
  Home: { label: 'New Chat', icon: ChatIcon },
  Drive: { label: 'New File', icon: FileIcon },
  Tasks: { label: 'New Task', icon: TaskIcon },
  Projects: { label: 'New Project', icon: ProjectIcon },
  Email: { label: 'New Email', icon: EmailIcon },
  Calendar: { label: 'New Event', icon: CalendarIcon },
  Chat: { label: 'New Message', icon: ChatIcon },
  Agents: { label: 'New Chat', icon: ChatIcon },
  Routines: { label: 'New Routine', icon: RoutineIcon },
  Customers: { label: 'New Customer', icon: BuildingsIcon },
  Calls: { label: 'New Call', icon: PhoneIcon },
};

/** Centered creation segments in navigation; compact actions in main toolbars. */
export function SidebarCreateAction(
  props: Omit<ButtonProps, 'variant' | 'size' | 'class'> & {
    sidebarLabel?: string;
    sidebarIcon?: CreateIcon;
  }
) {
  const [local, rest] = splitProps(props, [
    'sidebarLabel',
    'sidebarIcon',
    'children',
  ]);
  const sidebar = useContext(SidebarCreatePresentation);
  const description = () => creationLabels[sidebar?.() ?? ''];
  return (
    <Button
      {...rest}
      variant={sidebar ? 'ghost' : 'outline'}
      size="md"
      depth={sidebar ? 4 : undefined}
      fullWidth={false}
      glass={false}
      data-sidebar-create=""
      tooltip={props.tooltip ?? props['aria-label'] ?? props.label}
      class={
        sidebar
          ? 'h-8 w-max min-w-[120px] shrink-0 justify-center gap-1.5 rounded-full border-0 bg-surface px-2 text-xs font-medium text-ink ring-1 ring-inset ring-edge-frame shadow-[0_1px_3px_oklch(0_0_0/0.12)]'
          : 'h-8 min-w-8 gap-1.5 px-3 text-sm leading-5'
      }
    >
      <Show
        when={sidebar}
        fallback={
          <>
            <PlusIcon class="size-3.5 shrink-0" />
            {local.children}
          </>
        }
      >
        <Dynamic
          component={local.sidebarIcon ?? description()?.icon ?? PlusIcon}
          class="size-4 shrink-0"
        />
        <span class="shrink-0 whitespace-nowrap">
          {local.sidebarLabel ??
            description()?.label ??
            props['aria-label'] ??
            props.label ??
            'New'}
        </span>
        <Show
          when={
            props['aria-haspopup'] === 'menu' ||
            props['aria-haspopup'] === true ||
            props['aria-haspopup'] === 'true'
          }
        >
          <CaretDownIcon class="size-3 shrink-0" />
        </Show>
      </Show>
    </Button>
  );
}
