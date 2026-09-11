import {
  setCreateMenuOpen,
  useCreateMenuBlocks,
} from '@app/features/command/Launcher';
import { openCreateCompanyModal } from '@app/features/companies/CreateCompanyModal';
import { useOpenEventComposer } from '@block-calendar/components/use-open-event-composer';
import { hapticImpact } from '@core/mobile/haptics';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import MessageIcon from '@phosphor/chat-circle.svg';
import MoreIcon from '@phosphor/dots-three.svg';
import EmailIcon from '@phosphor/envelope-simple.svg';
import DocumentIcon from '@phosphor/file-text.svg';
import TaskIcon from '@phosphor/list-checks.svg';
import CreateIcon from '@phosphor/plus.svg';
import { Show } from 'solid-js';
import {
  MobileCreateMenu,
  type MobileCreateMenuItem,
} from './MobileCreateMenu';
import { MobileDockIsland } from './MobileDockIsland';
import { mobilePageCreateLabel } from './mobile-page-create-action';
import { useForegroundMobileView } from './use-mobile-nav';

/** The current view's New action, alongside the mobile AI composer. */
export function MobilePageCreateButton() {
  const foregroundView = useForegroundMobileView();
  const createBlocks = useCreateMenuBlocks();
  const openEventComposer = useOpenEventComposer();
  const quickActions = (): MobileCreateMenuItem[] => [
    ...[
      { label: 'Email', icon: EmailIcon },
      { label: 'Message', icon: MessageIcon },
      { label: 'Document', icon: DocumentIcon },
    ].map(({ label, icon }) => {
      const block = createBlocks().find((entry) => entry.label === label);
      return {
        label,
        icon,
        disabled: !block,
        onSelect: () => block?.keyDownHandler(),
      };
    }),
    { label: 'Event', icon: CalendarIcon, onSelect: () => openEventComposer() },
    {
      label: 'Task',
      icon: TaskIcon,
      disabled: !createBlocks().some((entry) => entry.label === 'Task'),
      onSelect: () =>
        createBlocks()
          .find((entry) => entry.label === 'Task')
          ?.keyDownHandler(),
    },
    { label: 'More', icon: MoreIcon, onSelect: () => setCreateMenuOpen(true) },
  ];
  const action = () => {
    if (foregroundView() === 'companies') {
      return { label: 'Company', run: openCreateCompanyModal };
    }
    if (foregroundView() === 'calendar') {
      return { label: 'Event', run: () => openEventComposer() };
    }
    const label = mobilePageCreateLabel(foregroundView());
    const block = createBlocks().find((entry) => entry.label === label);
    if (block?.keyDownHandler && label) {
      return { label, run: block.keyDownHandler };
    }
    return { label: 'New', run: () => setCreateMenuOpen(true) };
  };

  return (
    <Show when={foregroundView() !== 'agents'}>
      <Show
        when={foregroundView() === 'inbox'}
        fallback={
          <MobileDockIsland class="shrink-0">
            <button
              type="button"
              aria-label={
                action().label === 'New'
                  ? 'New'
                  : `New ${action().label.toLowerCase()}`
              }
              onPointerDown={() => hapticImpact('light')}
              onClick={() => action().run()}
              class="relative flex h-(--mobile-chrome-button-size) shrink-0 items-center justify-center gap-1.5 rounded-full pl-3 pr-4 text-[15px] font-medium whitespace-nowrap"
            >
              <CreateIcon class="size-5.5 shrink-0" />
              <span>{action().label}</span>
            </button>
          </MobileDockIsland>
        }
      >
        <MobileCreateMenu items={quickActions()} />
      </Show>
    </Show>
  );
}
