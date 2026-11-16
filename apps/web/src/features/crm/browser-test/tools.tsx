import '@app/index.css';
import { render } from 'solid-js/web';
import {
  PipelineEntriesToolResponse,
  UpdatedEntriesToolResponse,
} from '../components/tool-pipelines';

const record = { id: 'synthetic-company', name: 'Acme' };

render(
  () => (
    <main class="m-8 max-w-xl space-y-8 bg-panel p-4 text-ink">
      <PipelineEntriesToolResponse
        empty="No entries"
        entries={[
          {
            record,
            fields: {
              'Contract value': 1234.567,
              Outcome: 'Won',
              Owner: 'Alex',
              'Revenue currency': 'EUR',
            },
            currencies: { 'Contract value': 'EUR' },
          },
        ]}
      />
      <UpdatedEntriesToolResponse
        updated={[
          {
            record,
            changes: [
              {
                field: 'Contract value',
                before: 1234.567,
                after: 250,
                beforeCurrency: 'EUR',
                afterCurrency: 'USD',
              },
            ],
          },
        ]}
      />
    </main>
  ),
  document.getElementById('root')!
);
