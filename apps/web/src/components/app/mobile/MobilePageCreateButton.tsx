import { useOpenEventComposer } from '@app/features/calendar-view/components/use-open-event-composer';
import { openCalendarEventSplit } from '@app/features/calendar-view/open-calendar-event';
import {
  setCreateMenuOpen,
  useCreateMenuBlocks,
} from '@app/features/command/Launcher';
import { openCreateCompanyModal } from '@app/features/crm/creation-adapter';
import { NEW_TASK_TITLE_SELECTOR } from '@app/features/task-composer/new-task-title-focus';
import { type TranslationKey, t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { triggerFocusNewElement } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { fireAndForget } from '@core/util/fireAndForget';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import MessageIcon from '@icon/system/regular/chat-circle.svg';
import MoreIcon from '@icon/system/regular/dots-three.svg';
import EmailIcon from '@icon/system/regular/envelope-simple.svg';
import DocumentIcon from '@icon/system/regular/file-text.svg';
import TaskIcon from '@icon/system/regular/list-checks.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { Match, Show, Switch } from 'solid-js';
import { projectLocation } from '../split-layout/project-back-navigation';
import { MobileCreateButton } from './MobileCreateButton';
import {
  MobileCreateMenu,
  type MobileCreateMenuItem,
} from './MobileCreateMenu';
import type { MobileNavViewId } from './mobile-nav-views';
import { mobilePageCreateBlock } from './mobile-page-create-action';
import {
  useForegroundMobileView,
  useForegroundProject,
} from './use-mobile-nav';

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
  projects: 'viewMenus.newProject',
  companies: 'mobile.newCompany',
};

type PageCreateAction = Pick<
  MobileCreateMenuItem,
  'label' | 'onSelect' | 'raiseKeyboard'
>;

/** The current non-AI view's New action above the navigation dock. */
export function MobilePageCreateButton() {
  const foregroundView = useForegroundMobileView();
  const foregroundProject = useForegroundProject();
  const createBlocks = useCreateMenuBlocks();
  const openEventComposer = useOpenEventComposer();
  const openCreateMenu = () => setCreateMenuOpen(true);

  const actionForView = (
    view: MobileNavViewId | undefined
  ): PageCreateAction | undefined => {
    if (view === 'companies') {
      return { label: t('mobile.company'), onSelect: openCreateCompanyModal };
    }
    if (view === 'calendar') {
      return {
        label: t('mobile.event'),
        // Created away from the calendar, the event shows there next.
        onSelect: () =>
          openEventComposer({
            onCreated: (created) =>
              fireAndForget(openCalendarEventSplit(created), 'mobile-create'),
          }),
      };
    }
    const block = mobilePageCreateBlock(view, createBlocks());
    return (
      block && {
        label: block.label,
        onSelect: block.keyDownHandler,
        ...(block.blockName === 'task'
          ? {
              raiseKeyboard: () =>
                triggerFocusNewElement(NEW_TASK_TITLE_SELECTOR, {
                  touchOnly: true,
                }),
            }
          : {}),
      }
    );
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

  const isProjectDetail = () => {
    if (!isMobile()) return false;
    // The project page owns its always-visible Task action.
    const content = globalSplitManager()?.activeSplit()?.content() ?? null;
    const location = projectLocation(content);
    return location?.kind === 'detail';
  };

  return (
    <Show when={foregroundView() !== 'agents' && !virtualKeyboardVisible()}>
      <Switch
        fallback={
          <Show
            when={foregroundView() === 'calendar'}
            fallback={
              <MobileCreateButton
                ariaLabel={actionAriaLabel()}
                label={action().label}
                onClick={() => action().onSelect()}
              />
            }
          >
            <MobileCreateMenu items={calendarActions()} />
          </Show>
        }
      >
        <Match when={isProjectDetail() || (isMobile() && foregroundProject())}>
          {/* Reserve the same chrome clearance as the page-owned Task action. */}
          <div aria-hidden="true" class="h-(--mobile-chrome-button-size)" />
        </Match>
        <Match when={foregroundView() === 'home'}>
          <MobileCreateMenu items={quickActions()} />
        </Match>
      </Switch>
    </Show>
  );
}
