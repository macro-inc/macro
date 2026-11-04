import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Currency from '@phosphor/currency-dollar.svg';
import Table from '@phosphor/table.svg';
import Users from '@phosphor/users.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../core/homepage-demo-people';
import { type DealStage, dealStages } from '../../core/workspace-fixtures';
import { StageIcon } from '../workspace/CompanyRecord';
import './company-pipeline-entry.css';

type PipelineValues = {
  stage: DealStage;
  owner: HomepagePersonId | '';
  revenue: string;
};
const owners = ['jacob', 'julia', 'teo', 'gabriel'] as const;

/** Frozen crm/components/pipeline-entry-cards: the deal stays separate from company properties. */
export function CompanyPipelineEntry(props: {
  name?: string;
  stages?: readonly DealStage[];
  value: PipelineValues;
  onChange: (patch: Partial<PipelineValues>) => void;
  onOpen?: () => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  return (
    <section class="sample-pipeline-entries" aria-label="Pipelines">
      <button
        class="sample-pipeline-toggle"
        aria-expanded={expanded()}
        onClick={() => setExpanded(!expanded())}
      >
        <CaretDown
          class="size-3"
          style={{ transform: expanded() ? undefined : 'rotate(-90deg)' }}
        />
        Pipelines
      </button>
      <Show when={expanded()}>
        <article
          class="sample-pipeline-entry"
          aria-label={`${props.name ?? 'Sales pipeline'} entry`}
        >
          <header>
            <Table class="size-4" />
            <span>{props.name ?? 'Sales pipeline'}</span>
            <Show when={props.onOpen}>
              <Button
                size="icon-sm"
                variant="ghost"
                label={`Open ${props.name ?? 'Sales pipeline'}`}
                onClick={() => props.onOpen?.()}
              >
                <ArrowUpRight />
              </Button>
            </Show>
          </header>
          <div class="sample-pipeline-entry-fields">
            <div>
              <span class="sample-pipeline-field-label">
                <StageIcon stage={props.value.stage} /> Stage
              </span>
              <Dropdown modal={false}>
                <Dropdown.Trigger
                  variant="plain"
                  size="sm"
                  aria-label="Change Stage"
                  data-company-property="stage"
                >
                  <StageIcon stage={props.value.stage} />
                  {props.value.stage}
                  <CaretDown class="size-3" />
                </Dropdown.Trigger>
                <Dropdown.Content portalScope="local">
                  <Dropdown.Group>
                    <For each={props.stages ?? dealStages}>
                      {(stage) => (
                        <Dropdown.Item
                          onSelect={() => props.onChange({ stage })}
                        >
                          <StageIcon stage={stage} />
                          {stage}
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </div>
            <div>
              <span class="sample-pipeline-field-label">
                <Users class="size-3" /> Owner
              </span>
              <Dropdown modal={false}>
                <Dropdown.Trigger
                  variant="plain"
                  size="sm"
                  aria-label="Change Owner"
                  data-company-property="owner"
                >
                  <Show
                    when={
                      props.value.owner
                        ? homepagePeople[props.value.owner]
                        : undefined
                    }
                    fallback="Empty"
                  >
                    {(person) => (
                      <>
                        <img src={person().photo} alt="" />
                        {person().shortName}
                      </>
                    )}
                  </Show>
                  <CaretDown class="size-3" />
                </Dropdown.Trigger>
                <Dropdown.Content portalScope="local">
                  <Dropdown.Group>
                    <For each={owners}>
                      {(owner) => (
                        <Dropdown.Item
                          onSelect={() => props.onChange({ owner })}
                        >
                          {homepagePeople[owner].name}
                        </Dropdown.Item>
                      )}
                    </For>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Dropdown>
            </div>
            <div>
              <span class="sample-pipeline-field-label">
                {' '}
                <Currency class="size-3" /> Revenue
              </span>
              <input
                aria-label="Pipeline revenue"
                inputMode="decimal"
                value={props.value.revenue}
                placeholder="Empty"
                onChange={(event) => {
                  const value = event.currentTarget.value.replace(
                    /[$,\s]/g,
                    ''
                  );
                  if (value === '' || /^\d+(\.\d{0,2})?$/.test(value))
                    props.onChange({ revenue: value });
                  else event.currentTarget.value = props.value.revenue;
                }}
              />
            </div>
          </div>
        </article>
      </Show>
    </section>
  );
}
