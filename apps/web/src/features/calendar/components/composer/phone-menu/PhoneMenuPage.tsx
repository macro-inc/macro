import { t } from '@app/lib/i18n';
import BackIcon from '@icon/system/regular/caret-left.svg';
import { Button } from '@ui';
import { type ParentProps, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';

export function PhoneMenuPage(
  props: ParentProps<{
    title: string;
    back?: () => void;
    done?: () => void;
    doneDisabled?: boolean;
  }>
) {
  const menus = usePhoneComposerMenu();
  const back = () => (props.back ? props.back() : menus.close());
  return (
    <Show when={menus.mount()}>
      {(mount) => (
        <Portal mount={mount()}>
          <section
            aria-label={props.title}
            class="flex min-h-0 flex-col gap-3 px-5 pb-5"
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                event.target instanceof HTMLInputElement
              )
                event.preventDefault();
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              back();
            }}
          >
            <div class="sticky top-0 z-10 flex min-h-11 items-center gap-2 bg-(--composer-title-surface,var(--color-menu))">
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={t('common.back')}
                onClick={back}
              >
                <BackIcon class="size-5" />
              </Button>
              <h2 class="min-w-0 flex-1 text-lg font-semibold">
                {props.title}
              </h2>
              <Show when={props.done}>
                <Button
                  variant="ghost"
                  size="lg"
                  disabled={props.doneDisabled}
                  onClick={props.done}
                >
                  {t('calendar.done')}
                </Button>
              </Show>
            </div>
            {props.children}
          </section>
        </Portal>
      )}
    </Show>
  );
}
