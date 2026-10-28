import '../../../../index.css';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { AddPipelineRecordDialog } from '../../views/add-pipeline-record';
import { CreateCompanyModal } from '../../views/create-company';
import { CreateContactModal } from '../../views/create-contact';
import { created, setCreated } from './preview-adapters';

function Fixture() {
  const [open, setOpen] = createSignal<
    'company' | 'contact' | 'deal' | 'pipeline-contact'
  >();
  const close = () => setOpen(undefined);
  return (
    <main class="min-h-dvh bg-page p-6 text-ink">
      <Button
        onClick={() => {
          setCreated('');
          setOpen('company');
        }}
      >
        New company
      </Button>
      <Button
        onClick={() => {
          setCreated('');
          setOpen('contact');
        }}
      >
        New contact
      </Button>
      <Button
        onClick={() => {
          setCreated('');
          setOpen('deal');
        }}
      >
        New deal
      </Button>
      <Button
        onClick={() => {
          setCreated('');
          setOpen('pipeline-contact');
        }}
      >
        New pipeline contact
      </Button>
      <Show when={open() === 'deal' || open() === 'pipeline-contact'}>
        <AddPipelineRecordDialog
          pipeline={{
            name: 'Sales',
            recordType: open() === 'deal' ? 'company' : 'contact',
          }}
          columns={[
            {
              id: 'record',
              name: 'Record',
              dataType: 'ENTITY',
              specificEntityType: open() === 'deal' ? 'COMPANY' : 'CONTACT',
              isMultiSelect: false,
              options: [],
              writable: true,
            },
          ]}
          initialValues={{}}
          onCreate={async () => true}
          onClose={close}
        />
      </Show>
      <Show when={open() === 'company'}>
        <CreateCompanyModal open onClose={close} onCreated={close} />
      </Show>
      <Show when={open() === 'contact'}>
        <CreateContactModal target={{}} onClose={close} onCreated={close} />
      </Show>
      <pre data-testid="created">{created()}</pre>
    </main>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
