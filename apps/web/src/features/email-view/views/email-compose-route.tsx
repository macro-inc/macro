import { ViewShell } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import { Button } from '@ui';
import type { ParentProps } from 'solid-js';

/** A new email in desktop Mail, in the list's place: Back above the composer. */
export function EmailComposeRoute(props: ParentProps<{ onBack: () => void }>) {
  return (
    // The composer keeps this bar, so it never draws into an enclosing host's.
    <SplitHeaderScope.Root when={false}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <ViewShell.TopBar>
          <Button
            variant="ghost"
            size="icon-md"
            tooltip={t('commands.goBack')}
            aria-label={t('commands.goBack')}
            onClick={() => props.onBack()}
          >
            <ArrowLeftIcon class="size-4" />
          </Button>
        </ViewShell.TopBar>
        <div class="relative min-h-0 min-w-0 flex-1">{props.children}</div>
      </div>
    </SplitHeaderScope.Root>
  );
}
