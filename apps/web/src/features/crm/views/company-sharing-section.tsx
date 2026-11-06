import { t } from '@app/lib/i18n';
import type { CrmCompanyEntity } from '@entity';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { CrmEmailPrivacyDialog } from './email-privacy';

export function CompanySharingSection(props: { company?: CrmCompanyEntity }) {
  const [privacyOpen, setPrivacyOpen] = createSignal(false);
  return (
    <Show when={props.company}>
      <div class="flex flex-col gap-2 text-xs">
        <Button
          variant="outline"
          size="sm"
          class="w-fit"
          onClick={() => setPrivacyOpen(true)}
        >
          {t('crm.privacyCompanySettings')}
        </Button>
        <p class="text-ink-muted leading-5">
          {t('crm.privacyCompanyDescription')}
        </p>
        <CrmEmailPrivacyDialog
          open={privacyOpen()}
          onOpenChange={setPrivacyOpen}
        />
      </div>
    </Show>
  );
}
