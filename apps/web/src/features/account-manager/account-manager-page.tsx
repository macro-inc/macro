import { t } from '@app/lib/i18n';
import { useParams } from '@app/lib/split-router';
import { AccountManagerCard } from './account-manager-card';

/** Where the one-time link in an approval message lands. */
export function AccountManagerPage() {
  const params = useParams<{ grantId: string }>();

  return (
    <main class="h-full min-h-0 flex-1 overflow-y-auto bg-page text-ink">
      <div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <h1 class="text-lg font-semibold">{t('accountManager.pageTitle')}</h1>
        <AccountManagerCard grantId={params.grantId} />
      </div>
    </main>
  );
}
