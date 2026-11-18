import { t } from '@app/lib/i18n';
import LockIcon from '@icon/system/regular/lock.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TrayArrowDownIcon from '@icon/system/regular/tray-arrow-down.svg';
import { EmptyStatePanel } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { PasswordKind } from '../core/types';

/** Why the list is empty: only an empty vault offers creating and importing. */
export type VaultEmptyReason = 'vault' | 'search' | 'folder' | 'filter';

export function VaultEmptyState(props: {
  reason: VaultEmptyReason;
  onCreate: (kind: PasswordKind) => void;
  onImport: () => void;
}) {
  const message = () =>
    match(props.reason)
      .with('vault', () => t('passwords.emptyVault'))
      .with('search', () => t('passwords.noResults'))
      .with('folder', () => t('passwords.emptyFolder'))
      .with('filter', () => t('passwords.empty'))
      .exhaustive();
  return (
    <Show
      when={props.reason === 'vault'}
      fallback={
        <div class="flex flex-col items-center gap-2 px-4 pt-16 text-center">
          <LockIcon class="size-5 text-ink-extra-muted" />
          <p class="text-sm text-ink-muted">{message()}</p>
        </div>
      }
    >
      <EmptyStatePanel
        centered
        graphic={LockIcon}
        graphicClass="size-6 text-ink-extra-muted"
        title={message()}
        description={t('passwords.emptyVaultHint')}
        primaryAction={{
          label: t('passwords.emptyVaultCreate'),
          icon: PlusIcon,
          onClick: () => props.onCreate('login'),
        }}
        secondaryAction={{
          label: t('passwords.emptyVaultImport'),
          icon: TrayArrowDownIcon,
          onClick: props.onImport,
        }}
      />
    </Show>
  );
}
