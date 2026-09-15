import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import {
  setCreateMenuOpen,
  useCreateMenuBlocks,
} from '@app/features/command/Launcher';
import { openCreateCompanyModal } from '@app/features/companies/CreateCompanyModal';
import { useOpenEventComposer } from '@block-calendar/components/use-open-event-composer';
import { hapticImpact } from '@core/mobile/haptics';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
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
import type { MobileNavViewId } from './mobile-nav-views';
import { mobilePageCreateBlock } from './mobile-page-create-action';
import { useForegroundMobileView } from './use-mobile-nav';

const QUICK_CREATE_VIEWS = [
  { view: 'mail', icon: EmailIcon },
  { view: 'channels', icon: MessageIcon },
  { view: 'documents', icon: DocumentIcon },
  { view: 'calendar', icon: CalendarIcon },
  { view: 'tasks', icon: TaskIcon },
] as const;

/** The current view's New action, alongside the mobile AI composer. */
export function MobilePageCreateButton() {
  const foregroundView = useForegroundMobileView();
  const createBlocks = useCreateMenuBlocks();
  const calendarEnabled = useCalendarUiFlag();
  const openEventComposer = useOpenEventComposer();
  const openCreateMenu = () => setCreateMenuOpen(true);

  const actionForView = (
    view: MobileNavViewId | undefined
  ): Pick<MobileCreateMenuItem, 'label' | 'onSelect'> | undefined => {
    if (view === 'companies') {
      return { label: 'Company', onSelect: openCreateCompanyModal };
    }
    if (view === 'calendar') {
      return calendarEnabled()
        ? { label: 'Event', onSelect: () => openEventComposer() }
        : undefined;
    }
    const block = mobilePageCreateBlock(view, createBlocks());
    return block && { label: block.label, onSelect: block.keyDownHandler };
  };

  const quickActions = (): MobileCreateMenuItem[] => [
    ...QUICK_CREATE_VIEWS.flatMap(({ view, icon }) => {
      const action = actionForView(view);
      return action ? [{ ...action, icon }] : [];
    }),
    { label: 'More', icon: MoreIcon, onSelect: openCreateMenu },
  ];
  const action = () =>
    actionForView(foregroundView()) ?? {
      label: 'New',
      onSelect: openCreateMenu,
    };

  return (
    <Show when={foregroundView() !== 'agents' && !virtualKeyboardVisible()}>
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
              onClick={() => action().onSelect()}
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
