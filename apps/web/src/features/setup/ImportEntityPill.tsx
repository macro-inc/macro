import { buildSimpleEntityUrl } from '@core/util/url';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { entityLabel, type ImportEntity } from '@queries/import';
import { type JSX, Match, Switch } from 'solid-js';
import { ItemPill } from './primitives';

/** One ledger row as a pill, styled by its status. */
export function ImportEntityPill(props: {
  entity: ImportEntity;
  icon?: JSX.Element;
}) {
  const code = () => {
    const identifier = props.entity.metadata.identifier;
    return typeof identifier === 'string' ? identifier : undefined;
  };
  const hoverDetail = () => {
    const meta = props.entity.metadata;
    const detail = meta.description ?? meta.summary ?? meta.purpose;
    return typeof detail === 'string' ? detail : undefined;
  };

  return (
    <Switch>
      <Match when={props.entity.status === 'imported'}>
        <ItemPill
          icon={props.icon}
          code={code()}
          label={entityLabel(props.entity)}
          importedHref={
            props.entity.entity_id && props.entity.entity_type
              ? buildSimpleEntityUrl({
                  type: props.entity.entity_type,
                  id: props.entity.entity_id,
                })
              : undefined
          }
        />
      </Match>
      <Match when={props.entity.status === 'importing'}>
        <ItemPill
          icon={props.icon}
          code={code()}
          label={entityLabel(props.entity)}
          title="Importing…"
          status={
            <SpinnerIcon class="size-3 shrink-0 animate-spin text-ink-extra-muted" />
          }
        />
      </Match>
      <Match when={true}>
        <ItemPill
          icon={props.icon}
          code={code()}
          label={entityLabel(props.entity)}
          title={hoverDetail()}
        />
      </Match>
    </Switch>
  );
}
