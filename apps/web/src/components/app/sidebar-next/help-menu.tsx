import { createSupportLink } from '@app/features/video-tutorials/primitives/create-support-link';
import { t } from '@app/lib/i18n';
import { openExternalUrl } from '@core/util/url';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import EmailIcon from '@icon/system/regular/envelope-simple.svg';
import QuestionIcon from '@icon/system/regular/question.svg';
import { Dropdown } from '@ui';
import { Show } from 'solid-js';

const DEMO_URL =
  'https://macro.com/app/book/6de4003c-15e4-549f-b5a9-0e930bbf56e4/macro-demo';
const SUPPORT_EMAIL = 'support@macro.com';

/** The rail's question-mark button: ways to reach the Macro team. */
export function HelpMenu() {
  const support = createSupportLink();

  return (
    <Dropdown placement="right-end" gutter={6}>
      <Dropdown.Trigger
        aria-label={t('nav.help')}
        variant="ghost"
        size="icon-md"
        class="size-10 shrink-0 cursor-default rounded-xl"
        tooltip={{ content: t('nav.help'), placement: 'right' }}
        draggable={false}
        data-sidebar-next-item="help"
      >
        <QuestionIcon class="size-6" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-56">
        <Dropdown.Group>
          <Show when={support.channelId()}>
            {(channelId) => (
              <Dropdown.Item
                class="gap-2"
                onSelect={() => support.open(channelId())}
              >
                <ChatIcon class="size-4 shrink-0 text-ink-muted" />
                {t('nav.helpMessage')}
              </Dropdown.Item>
            )}
          </Show>
          <Dropdown.Item
            class="gap-2"
            onSelect={() => openExternalUrl(DEMO_URL)}
          >
            <CalendarIcon class="size-4 shrink-0 text-ink-muted" />
            {t('nav.helpDemo')}
          </Dropdown.Item>
          <Dropdown.Item
            class="gap-2"
            onSelect={() => openExternalUrl(`mailto:${SUPPORT_EMAIL}`)}
          >
            <EmailIcon class="size-4 shrink-0 text-ink-muted" />
            {t('nav.helpEmail', { email: SUPPORT_EMAIL })}
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
