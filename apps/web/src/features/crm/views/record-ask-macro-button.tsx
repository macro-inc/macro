import { t } from '@app/lib/i18n';
import { HeaderActionButton } from '@components/app/HeaderActionButton';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Match, Show, Switch } from 'solid-js';
import { useCrmContext } from '../context/crm-context';
import type { CrmRecordRef, CrmRecordTarget } from '../core/record';
import { useCompanyQuery, useContactQuery } from './use-crm';

function AskMacroAction(props: { record: CrmRecordRef; grouped?: boolean }) {
  const { askMacro } = useCrmContext();
  return (
    <HeaderActionButton
      grouped={props.grouped}
      onClick={() => askMacro(props.record)}
      tooltip={t('entityActions.askMacro')}
      label={t('entityActions.askMacro')}
      icon={
        <SparkleIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
      }
    />
  );
}

type ButtonProps = { id: string; grouped?: boolean };

function CompanyAskMacro(props: ButtonProps) {
  const { company } = useCompanyQuery(() => props.id);
  return (
    <Show when={company()}>
      {(current) => (
        <AskMacroAction
          grouped={props.grouped}
          record={{ type: 'company', id: current().id, name: current().name }}
        />
      )}
    </Show>
  );
}

function ContactAskMacro(props: ButtonProps) {
  const query = useContactQuery(() => props.id);
  return (
    <Show when={query.isSuccess && query.data}>
      {(current) => (
        <AskMacroAction
          grouped={props.grouped}
          record={{
            type: 'contact',
            id: current().id,
            name: current().name || (current().email ?? ''),
          }}
        />
      )}
    </Show>
  );
}

/** Ask Macro about a company or contact, once its name has loaded. */
export function RecordAskMacroButton(props: {
  record: CrmRecordTarget;
  grouped?: boolean;
}) {
  return (
    <Switch>
      <Match when={props.record.type === 'company' && props.record.id} keyed>
        {(id) => <CompanyAskMacro id={id} grouped={props.grouped} />}
      </Match>
      <Match when={props.record.type === 'contact' && props.record.id} keyed>
        {(id) => <ContactAskMacro id={id} grouped={props.grouped} />}
      </Match>
    </Switch>
  );
}
