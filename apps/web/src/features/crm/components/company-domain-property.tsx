import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import GlobeIcon from '@icon/system/regular/globe.svg';
import type { CompanyDomainChange } from '../core/company';
import { RecordValueList, RecordValuePill } from './contact-email-property';
import { RecordValueEditor } from './record-value-editor';
import { RecordValueRow } from './record-value-row';
import type { ValueChange } from './value-change';

type CompanyDomainProps = {
  domains: string[];
  change(domain: string, change: CompanyDomainChange): Promise<void>;
  errorMessage(error: unknown, change: CompanyDomainChange): string;
};

/**
 * One domain, the first being the primary. Any domain offers Remove: the
 * server refuses the one the company is named after, and the refusal shows
 * beside the rows.
 */
function CompanyDomainRow(props: {
  domain: string;
  primary: boolean;
  busy: boolean;
  size: 'details' | 'editor';
  onOpen?: (anchor: HTMLButtonElement) => void;
  domainRef?: (element: HTMLButtonElement) => void;
  expanded?: boolean;
  onRemove(): void;
}) {
  return (
    <RecordValueRow
      value={props.domain}
      icon={GlobeIcon}
      primary={props.primary}
      primaryLabel={t('crm.primaryDomain')}
      manageable
      busy={props.busy}
      size={props.size}
      openLabel={t('crm.manageCompanyDomain', { domain: props.domain })}
      onOpen={props.onOpen}
      valueRef={props.domainRef}
      expanded={props.expanded}
      remove={{
        label: t('crm.removeCompanyDomainNamed', { domain: props.domain }),
        tooltip: t('crm.companyDomainRemoveHelp'),
        run: () => props.onRemove(),
      }}
    />
  );
}

/** Every domain with Remove, under a field that adds another. */
function CompanyDomainEditor(props: {
  domains: string[];
  /** Owned by the editor's host, which keeps it open while a change saves. */
  request: ValueChange<CompanyDomainChange>;
  onClose(): void;
}) {
  const remove = async (domain: string, refocus: () => void) => {
    if (await props.request.run(domain, 'remove')) refocus();
  };

  return (
    <RecordValueEditor
      values={props.domains}
      canAdd
      field={{
        label: t('crm.domain'),
        formLabel: t('crm.addDomain'),
        placeholder: t('crm.companyDomainPlaceholder'),
        type: 'text',
        inputMode: 'url',
        help: t('crm.companyDomainAddHelp'),
      }}
      listLabel={t('crm.domains')}
      saving={props.request.saving()}
      error={props.request.error()}
      clearError={props.request.clearError}
      add={(domain) => props.request.run(domain, 'add')}
      onClose={props.onClose}
      row={(domain, refocus) => (
        <CompanyDomainRow
          size="editor"
          domain={domain}
          primary={domain === props.domains[0]}
          busy={props.request.saving()}
          onRemove={() => fireAndForget(remove(domain, refocus), 'crm')}
        />
      )}
    />
  );
}

/** The company header's domains: the primary, +N and the domain editor. */
export function CompanyDomainPill(props: CompanyDomainProps) {
  return (
    <RecordValuePill
      values={props.domains}
      primary={undefined}
      editable
      icon={GlobeIcon}
      emptyLabel={t('crm.domain')}
      listTitle={t('crm.domains')}
      primaryLabel={t('crm.primaryDomain')}
      label={(primary, others) => {
        if (props.domains.length === 0) return t('crm.addDomain');
        if (others === 0)
          return t('crm.companyDomainLabel', { domain: primary });
        return t('crm.companyDomainSummary', {
          domain: primary,
          count: others,
        });
      }}
      editorTitle={t('crm.domains')}
      change={props.change}
      errorMessage={props.errorMessage}
      editor={(request, close) => (
        <CompanyDomainEditor
          domains={props.domains}
          request={request}
          onClose={close}
        />
      )}
    />
  );
}

/**
 * Record details' Website: one line per domain, then the side panel's add
 * pill. Remove moves focus to Add domain.
 */
export function CompanyDomainList(props: CompanyDomainProps) {
  return (
    <RecordValueList
      values={props.domains}
      canAdd
      label={t('crm.domains')}
      addLabel={t('crm.addDomain')}
      editorTitle={t('crm.domains')}
      change={props.change}
      errorMessage={props.errorMessage}
      editor={(request, close) => (
        <CompanyDomainEditor
          domains={props.domains}
          request={request}
          onClose={close}
        />
      )}
      row={(domain, row) => (
        <CompanyDomainRow
          size="details"
          domain={domain}
          primary={domain === props.domains[0]}
          busy={row.busy}
          onOpen={row.open}
          domainRef={row.ref}
          expanded={row.expanded}
          onRemove={() => row.run('remove')}
        />
      )}
    />
  );
}
