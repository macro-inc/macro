import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { Match, Show, Switch } from 'solid-js';
import type { CrmRecordTarget } from '../core/record';
import { useCompanyQuery, useContactQuery } from './use-crm';

type ButtonProps = { id: string; grouped?: boolean };

function CompanyAskMacro(props: ButtonProps) {
  const { company } = useCompanyQuery(() => props.id);
  return (
    <Show when={company()}>
      {(current) => (
        <AskMacroButton
          grouped={props.grouped}
          entity={{ type: 'company', id: current().id, name: current().name }}
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
        <AskMacroButton
          grouped={props.grouped}
          entity={{
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
