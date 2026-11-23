import '@app/index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ModelCatalogPicker } from '../ModelCatalogPicker';
import type { CatalogModelOption } from '../modelCatalog';

// A runtime that names its models "Provider · slug", as OpenCode does.
const OPTIONS: CatalogModelOption[] = [
  'gpt-6-astra',
  'gpt-6-astra-fast',
  'gpt-6-astra-flex',
  'gpt-6-astra-pro',
  'gpt-6-astra-pro-fast',
  'gpt-6-astra-pro-flex',
  'gpt-6.1-sol',
  'gpt-6.1-sol-pro',
  'gpt-6.1-sol-pro-fast',
].map((slug) => ({
  id: `router/openai/${slug}`,
  label: `Model Router · openai/${slug}`,
}));

function Fixture() {
  const [value, setValue] = createSignal<string | null>(OPTIONS[0].id);
  return (
    <main class="flex min-h-screen items-end bg-page p-6 text-ink">
      <ModelCatalogPicker
        value={value()}
        options={OPTIONS}
        onSelect={setValue}
        ariaLabel="Model"
      />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
