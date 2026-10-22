import CaretDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';
import Database from '@phosphor/database.svg';
import Funnel from '@phosphor/funnel.svg';
import Plus from '@phosphor/plus.svg';
import Table from '@phosphor/table.svg';
import { Button } from '@ui';
import { For } from 'solid-js';
import { Badge } from '../../../../ui/components/Badge';
import { homepagePeople } from '../../core/homepage-demo-people';

const records = [
  { name: 'Customer announcement', owner: 'julia', status: 'In progress' },
  { name: 'Pricing page', owner: 'teo', status: 'Done' },
  { name: 'Setup guide', owner: 'jacob', status: 'In progress' },
  { name: 'Launch checklist', owner: 'julia', status: 'Planned' },
] as const;
const statuses = ['Planned', 'In progress', 'Done'] as const;

/** Frozen DatabaseTable / OptionPill presentation; no authenticated data or writes. */
export function HomepageDatabaseWorkflow(props: { phase: number }) {
  return (
    <div class="macro-preview-back macro-database">
      <header class="macro-database-heading">
        <Database />
        Launch projects
      </header>
      <div class="macro-database-toolbar">
        <span>
          <Table />
          All records
          <CaretDown />
        </span>
        <Button variant="plain" size="sm">
          <Funnel />
          Filter
        </Button>
      </div>
      <div class="macro-database-table">
        <div class="macro-database-row macro-database-columns">
          <span>#</span>
          <span>Name</span>
          <span>Status</span>
          <span class="macro-database-owner">Owner</span>
        </div>
        <For each={records}>
          {(record, index) => (
            <div class="macro-database-row">
              <span class="macro-database-number">{index() + 1}</span>
              <span>{record.name}</span>
              <div class="macro-database-status-cell">
                <Badge
                  variant="outline"
                  size="sm"
                  class="macro-database-status"
                  data-status={
                    index() === 0 && props.phase >= 5 ? 'Done' : record.status
                  }
                  data-demo-status={index() === 0 ? '' : undefined}
                >
                  <i />
                  {index() === 0 && props.phase >= 5 ? 'Done' : record.status}
                </Badge>
              </div>
              <span class="macro-database-owner">
                <img src={homepagePeople[record.owner].photo} alt="" />
                {homepagePeople[record.owner].name.split(' ')[0]}
              </span>
            </div>
          )}
        </For>
        <div class="macro-database-add">
          <Plus />
          New record
        </div>
        <div
          class="macro-database-options"
          data-visible={props.phase >= 2 && props.phase < 5}
        >
          <For each={statuses}>
            {(status) => (
              <div
                class="macro-database-option"
                data-demo-done={status === 'Done' ? '' : undefined}
                data-selected={status === 'Done' && props.phase >= 4}
              >
                <Badge
                  variant="outline"
                  size="sm"
                  class="macro-database-status"
                  data-status={status}
                >
                  <i />
                  {status}
                </Badge>
              </div>
            )}
          </For>
        </div>
      </div>
      <footer>
        <span>4 records</span>
        <span class="macro-database-saved" data-visible={props.phase >= 5}>
          <Check />
          Saved
        </span>
      </footer>
    </div>
  );
}
