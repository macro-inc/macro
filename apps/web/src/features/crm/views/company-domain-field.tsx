import { t } from '@app/lib/i18n';
import { ThrownResultError, thrownResultErrorHasCode } from '@core/util/result';
import { match } from 'ts-pattern';
import { CompanyDomainProperty } from '../components/company-domain-property';
import { useCrmContext } from '../context/crm-context';
import type { CompanyDomainChange } from '../core/company';

/** The name of the company that already has the domain, when the caller sees it. */
function holderName(error: unknown): string | undefined {
  if (!(error instanceof ThrownResultError)) return undefined;
  return error.errors.find((e) => e.code === 'CONFLICT')?.message || undefined;
}

function domainEditError(error: unknown, change: CompanyDomainChange): string {
  if (thrownResultErrorHasCode(error, 'CONFLICT')) {
    const company = holderName(error);
    return company
      ? t('crm.companyDomainTaken', { company })
      : t('crm.companyDomainTakenArchived');
  }
  if (thrownResultErrorHasCode(error, 'BAD_REQUEST'))
    return match(change)
      .with('add', () => t('crm.companyDomainInvalid'))
      .with('remove', () => t('crm.companyDomainNamesCompany'))
      .exhaustive();
  if (change === 'remove' && thrownResultErrorHasCode(error, 'FORBIDDEN'))
    return t('crm.companyDomainAdminRequired');
  if (
    ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'].some((code) =>
      thrownResultErrorHasCode(error, code)
    )
  )
    return t('crm.companyDomainUnavailable');
  return t('crm.contactEditFailed');
}

/**
 * The company's domains, each removable, with a control to add another.
 * Key it by the company's id so navigation cannot reuse an old draft.
 */
export function CompanyDomainField(props: {
  company: { id: string; domains: { domain: string }[] };
}) {
  const mutation = useCrmContext().editCompanyDomain();
  return (
    <CompanyDomainProperty
      domains={props.company.domains.map((domain) => domain.domain)}
      errorMessage={domainEditError}
      change={async (domain, change) => {
        await mutation.mutateAsync({
          companyId: props.company.id,
          domain,
          change,
        });
      }}
    />
  );
}
