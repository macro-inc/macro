import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useOpenEventComposer } from '@app/features/calendar-view/components/use-open-event-composer';
import {
  setCreateMenuOpen,
  useCreateMenuBlocks,
} from '@app/features/command/Launcher';
import { openCreateCompanyModal } from '@app/features/crm/creation-adapter';
import { type TranslationKey, t } from '@app/lib/i18n';
import { hapticImpact } from '@core/mobile/haptics';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import MessageIcon from '@phosphor/chat-circle.svg';
import MoreIcon from '@phosphor/dots-three.svg';
import EmailIcon from '@phosphor/envelope-simple.svg';
import DocumentIcon from '@phosphor/file-text.svg';
import TaskIcon from '@phosphor/list-checks.svg';
import PhoneIcon from '@phosphor/phone.svg';
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

/**
 * Accessible names for each view's New button, keyed by view rather than built
 * from the visible label, so translations control their own word order.
 */
const NEW_ITEM_LABELS: Partial<Record<MobileNavViewId, TranslationKey>> = {
  home: 'mobile.newMessage',
  mail: 'mobile.newEmail',
  channels: 'mobile.newMessage',
  documents: 'mobile.newDocument',
  tasks: 'mobile.newTask',
  companies: 'mobile.newCompany',
};

type PageCreateAction = Pick<MobileCreateMenuItem, 'label' | 'onSelect'>;

/** The current non-AI view's New action above the navigation dock. */
export function MobilePageCreateButton() {
  const foregroundView = useForegroundMobileView();
  const createBlocks = useCreateMenuBlocks();
  const calendarEnabled = useCalendarUiFlag();
  const openEventComposer = useOpenEventComposer();
  const openCreateMenu = () => setCreateMenuOpen(true);

  const actionForView = (
    view: MobileNavViewId | undefined
  ): PageCreateAction | undefined => {
    if (view === 'companies') {
      return { label: t('mobile.company'), onSelect: openCreateCompanyModal };
    }
    if (view === 'calendar') {
      return calendarEnabled()
        ? { label: t('mobile.event'), onSelect: () => openEventComposer() }
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
    { label: t('mobile.more'), icon: MoreIcon, onSelect: openCreateMenu },
  ];
  const calendarActions = (): MobileCreateMenuItem[] => {
    const blocks = createBlocks();
    const call = blocks.find((block) => block.blockName === 'call');
    return [
      {
        label: t('mobile.event'),
        icon: CalendarIcon,
        onSelect: () => openEventComposer(),
      },
      ...(call
        ? [
            {
              label: t('mobile.call'),
              icon: PhoneIcon,
              onSelect: () => {
                call.keyDownHandler();
              },
            },
          ]
        : []),
    ];
  };
  const viewAction = () => actionForView(foregroundView());
  const action = (): PageCreateAction =>
    viewAction() ?? { label: t('mobile.new'), onSelect: openCreateMenu };
  const actionAriaLabel = () => {
    const view = foregroundView();
    const key = view ? NEW_ITEM_LABELS[view] : undefined;
    return viewAction() && key ? t(key) : t('mobile.new');
  };

  return (
    <Show when={foregroundView() !== 'agents' && !virtualKeyboardVisible()}>
      <Show
        when={foregroundView() === 'home'}
        fallback={
          <Show
            when={foregroundView() === 'calendar' && calendarEnabled()}
            fallback={
              <MobileDockIsland class="shrink-0">
                <button
                  type="button"
                  aria-label={actionAriaLabel()}
                  onPointerDown={() => hapticImpact('light')}
                  onClick={() => action().onSelect()}
                  class="relative flex h-(--mobile-chrome-button-size) shrink-0 items-center justify-center gap-1.5 rounded-full pl-3 pr-4 text-base font-medium whitespace-nowrap"
                >
                  <CreateIcon class="size-5.5 shrink-0" />
                  <span>{action().label}</span>
                </button>
              </MobileDockIsland>
            }
          >
            <MobileCreateMenu items={calendarActions()} />
          </Show>
        }
      >
        <MobileCreateMenu items={quickActions()} />
      </Show>
    </Show>
  );
}
