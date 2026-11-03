import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { CrmCompanyEntity } from '@entity';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import TableIcon from '@icon/system/regular/table.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { type CrmEmailAccount, useCrmContext } from '../context/crm-context';
import type { Pipeline } from '../core/pipeline';
import { pipelineRecordCell } from '../core/pipeline-csv';

function AccountMenu(props: {
  accounts: CrmEmailAccount[];
  onPick: (inboxId: string) => void;
}) {
  const personal = () => props.accounts.filter((account) => account.personal);
  const shared = () => props.accounts.filter((account) => !account.personal);
  const group = (label: string, accounts: CrmEmailAccount[]) => (
    <Show when={accounts.length > 0}>
      <Dropdown.Group>
        <Dropdown.GroupLabel>{label}</Dropdown.GroupLabel>
        <For each={accounts}>
          {(account) => (
            <Dropdown.Item onSelect={() => props.onPick(account.id)}>
              {account.address}
            </Dropdown.Item>
          )}
        </For>
      </Dropdown.Group>
    </Show>
  );
  return (
    <>
      {group(t('crmRecord.personal'), personal())}
      {group(t('crmRecord.company'), shared())}
    </>
  );
}

function EmailButton(props: {
  label: string;
  recipients: string[];
  primary?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const crm = useCrmContext();
  const accounts = crm.emailAccounts();
  const send = (inboxId?: string) =>
    crm.openEmailComposer(props.recipients, inboxId);
  return (
    <Show
      when={accounts().length > 1 && !props.disabled}
      fallback={
        <Button
          variant={props.primary ? 'primary' : 'secondary'}
          size="sm"
          disabled={props.disabled}
          tooltip={props.disabled ? props.disabledReason : undefined}
          onClick={() => send(accounts()[0]?.id)}
        >
          <EnvelopeIcon class="size-3.5" />
          {props.label}
        </Button>
      }
    >
      <Dropdown>
        <Dropdown.Trigger variant={props.primary ? 'primary' : 'secondary'}>
          <EnvelopeIcon class="size-3.5" />
          {props.label}
        </Dropdown.Trigger>
        <Dropdown.Content>
          <AccountMenu accounts={accounts()} onPick={send} />
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

/** Add a person, email the team, or add the company to a pipeline. */
export function CompanyRecordActions(props: {
  company?: CrmCompanyEntity;
  contacts?: { email: string }[];
  onAddedToPipeline?: () => void;
}) {
  const crm = useCrmContext();
  const pipelinesOn = crm.pipelinesEnabled();
  const pipelines = crm.createPipelines(() =>
    pipelinesOn() ? props.company?.teamId : undefined
  );
  const [adding, setAdding] = createSignal(false);
  let addRequest: AbortController | undefined;
  onCleanup(() => addRequest?.abort());
  const domain = () => props.company?.domains[0]?.domain;
  const recipients = () => [
    ...new Set(
      (props.contacts ?? [])
        .map((contact) => contact.email.trim())
        .filter((email) => email.length > 0)
    ),
  ];
  const editable = () =>
    pipelines
      .pipelines()
      .filter(
        (pipeline) =>
          pipeline.recordType === 'company' &&
          !pipeline.trashedAt &&
          (pipeline.grant === 'edit' || pipeline.grant === 'owner')
      )
      .sort((left, right) => left.name.localeCompare(right.name));

  async function addToPipeline(pipeline: Pipeline) {
    const company = props.company;
    if (!company || adding()) return;
    addRequest?.abort();
    const request = new AbortController();
    addRequest = request;
    setAdding(true);
    try {
      const transfer = crm.createPipelineTransfer(pipeline);
      const table = await transfer.readTable(request.signal);
      const present = table.rows.some(
        (row) => row.cells[pipeline.primaryColumnId] === company.id
      );
      if (present) {
        crm.feedback.failure(
          t('crmRecord.alreadyInPipeline', { name: pipeline.name })
        );
        return;
      }
      await transfer.insertRows(
        [[pipelineRecordCell(pipeline, company.id)]],
        table.columns
      );
      await transfer.refresh();
      if (request.signal.aborted) return;
      props.onAddedToPipeline?.();
      crm.feedback.success(
        t('crmRecord.addedToPipeline', { name: pipeline.name })
      );
    } catch (error) {
      if (request.signal.aborted) return;
      console.error('Failed to add company to pipeline', error);
      crm.feedback.failure(t('crmRecord.couldNotAddToPipeline'));
    } finally {
      if (addRequest === request) setAdding(false);
    }
  }

  return (
    <div class="flex flex-wrap items-center justify-end gap-2">
      <Button
        variant="primary"
        size="sm"
        disabled={!props.company || !domain()}
        tooltip={
          props.company && !domain() ? t('crmRecord.domainRequired') : undefined
        }
        onClick={() => {
          const company = props.company;
          const companyDomain = domain();
          if (!company || !companyDomain) return;
          crm.openCreateContact({
            companyId: company.id,
            domain: companyDomain,
          });
        }}
      >
        <PlusIcon class="size-3.5" />
        {t('crmRecord.addPerson')}
      </Button>
      <EmailButton
        label={t('crmRecord.emailTeam')}
        recipients={recipients()}
        disabled={!props.company || recipients().length === 0}
        disabledReason={
          props.company && recipients().length === 0
            ? t('crmRecord.noContactsToEmail')
            : undefined
        }
      />
      <Show when={pipelinesOn()}>
        <Dropdown>
          <Dropdown.Trigger disabled={!props.company || adding()}>
            <TableIcon class="size-3.5" />
            {t('crmRecord.addToPipeline')}
          </Dropdown.Trigger>
          <Dropdown.Content>
            <Show
              when={!pipelines.loading() && editable().length > 0}
              fallback={
                <Dropdown.Item
                  disabled
                  disabledReason={
                    pipelines.loading()
                      ? t('crmRecord.loadingPipelines')
                      : t('crmRecord.noEditablePipelines')
                  }
                >
                  {pipelines.loading()
                    ? t('crmRecord.loadingPipelines')
                    : t('crmRecord.noEditablePipelines')}
                </Dropdown.Item>
              }
            >
              <For each={editable()}>
                {(pipeline) => (
                  <Dropdown.Item
                    onSelect={() =>
                      fireAndForget(addToPipeline(pipeline), 'crm')
                    }
                  >
                    {pipeline.name}
                  </Dropdown.Item>
                )}
              </For>
            </Show>
          </Dropdown.Content>
        </Dropdown>
      </Show>
    </div>
  );
}

/** Message, task, email, or ask about this person or their company. */
export function ContactRecordActions(props: {
  contact?: {
    id: string;
    companyId: string;
    email: string;
    name?: string | null;
  };
}) {
  const crm = useCrmContext();
  const contact = () => props.contact;
  const ask = (record: {
    type: 'company' | 'contact';
    id: string;
    name: string;
  }) => crm.openRecordChat(record);

  return (
    <div class="flex flex-wrap items-center justify-end gap-2">
      <EmailButton
        label={t('crmRecord.email')}
        recipients={props.contact ? [props.contact.email] : []}
        primary
        disabled={!props.contact}
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={!contact()}
        onClick={() => {
          const email = contact()?.email;
          if (email) fireAndForget(crm.openDirectMessage(email), 'crm');
        }}
      >
        <ChatIcon class="size-3.5" />
        {t('crmRecord.message')}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!contact()}
        onClick={() => crm.openTaskComposer()}
      >
        <CheckSquareIcon class="size-3.5" />
        {t('crmRecord.addTask')}
      </Button>
      <Dropdown>
        <Dropdown.Trigger disabled={!contact()}>
          <SparkleIcon class="size-3.5" />
          {t('crmRecord.askAi')}
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item
            onSelect={() => {
              const current = contact();
              if (!current) return;
              ask({
                type: 'contact',
                id: current.id,
                name: current.name || current.email,
              });
            }}
          >
            {t('crmRecord.askAboutPerson')}
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => {
              const current = contact();
              if (!current) return;
              ask({ type: 'company', id: current.companyId, name: '' });
            }}
          >
            {t('crmRecord.askAboutCompany')}
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
