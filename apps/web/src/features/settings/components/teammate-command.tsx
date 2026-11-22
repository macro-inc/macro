import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import CopyIcon from '@icon/system/regular/copy.svg';
import { CopyButton } from '@ui';
import { ResultAsync } from 'neverthrow';

async function copyCommand(command: string): Promise<boolean> {
  const copied = await ResultAsync.fromPromise(
    navigator.clipboard.writeText(command),
    () => undefined
  );
  if (copied.isErr()) {
    toast.failure(t('teammateHosts.copyCommandFailed'));
    return false;
  }
  return true;
}

/** A macrod command the owner runs on their machine, with a copy button. */
export function TeammateCommand(props: { command: string }) {
  return (
    <span class="inline-flex max-w-full items-center gap-1">
      <code class="min-w-0 break-all rounded bg-ink/6 px-1.5 py-0.5 font-mono text-xs text-ink">
        {props.command}
      </code>
      <CopyButton
        variant="ghost"
        size="icon-sm"
        aria-label={t('teammateHosts.copyCommand')}
        tooltip={t('teammateHosts.copyCommand')}
        onClick={() => copyCommand(props.command)}
        icon={<CopyIcon class="size-4" />}
      />
    </span>
  );
}
