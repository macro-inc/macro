import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { ApiKeyInput } from './ApiKeyInput';
import { Button } from './Button';

// #region demo:new
function NewKeyDemo() {
  const [key, setKey] = createSignal('');

  return (
    <div class="flex w-full max-w-sm items-center gap-2">
      <ApiKeyInput
        prefix="sk-ant-"
        value={key()}
        onValueChange={setKey}
        aria-label="Anthropic API key"
      />
      <Button variant="outline" size="sm" disabled={key().trim() === ''}>
        Save
      </Button>
    </div>
  );
}
// #endregion

// #region demo:saved
function SavedKeyDemo() {
  const [key, setKey] = createSignal('');

  return (
    <div class="flex w-full max-w-sm items-center gap-2">
      <ApiKeyInput
        prefix="sk-ant-"
        saved
        value={key()}
        onValueChange={setKey}
        aria-label="Anthropic API key"
      />
      <Button variant="outline" size="sm" disabled={key().trim() === ''}>
        Replace
      </Button>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'ApiKeyInput',
  category: 'Inputs',
  description:
    'A field for pasting a secret API key: masked, never prefilled with a stored key, and kept out of autofill, spellcheck and session replay.',
  status: 'stable',
  exports: ['ApiKeyInput'],
  import: "import { ApiKeyInput } from '@ui';",
  demos: [
    {
      id: 'new',
      title: 'No key yet',
      description:
        'The placeholder shows the provider prefix so people paste the right kind of key.',
      render: NewKeyDemo,
    },
    {
      id: 'saved',
      title: 'Key saved',
      description:
        'A stored key is write-only, so `saved` shows it masked as `sk-ant-••••`; typing replaces it.',
      render: SavedKeyDemo,
    },
  ],
});
