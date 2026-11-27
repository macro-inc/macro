import { defineDoc } from '@app/features/ui-gallery/types';
import KeyIcon from '@icon/system/regular/key.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import { createSignal } from 'solid-js';
import { Button } from './Button';
import { SecretInput } from './SecretInput';

// #region demo:password
function PasswordDemo() {
  const [password, setPassword] = createSignal('');

  return (
    <div class="flex w-full max-w-sm flex-col gap-1.5">
      <label for="secret-input-demo-password" class="text-xs font-medium">
        Password
      </label>
      <SecretInput
        id="secret-input-demo-password"
        autocomplete="current-password"
        icon={<LockIcon />}
        value={password()}
        onValueChange={setPassword}
      />
    </div>
  );
}
// #endregion

// #region demo:saved
function SavedDemo() {
  const [token, setToken] = createSignal('');

  return (
    <div class="flex w-full max-w-sm items-center gap-2">
      <SecretInput
        aria-label="Access token"
        autocomplete="off"
        icon={<KeyIcon />}
        saved
        value={token()}
        onValueChange={setToken}
      />
      <Button variant="secondary" size="sm" disabled={token().trim() === ''}>
        Replace
      </Button>
    </div>
  );
}
// #endregion

// #region demo:states
function StatesDemo() {
  return (
    <div class="flex w-full max-w-sm flex-col gap-2">
      <SecretInput
        aria-label="Disabled secret"
        autocomplete="off"
        disabled
        value=""
        onValueChange={() => {}}
      />
      <SecretInput
        aria-label="Invalid secret"
        autocomplete="off"
        aria-invalid
        value="not-a-key"
        onValueChange={() => {}}
      />
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'SecretInput',
  category: 'Inputs',
  description:
    'A masked field for entering a secret (API key, password, token). The eye toggle reveals only what is being typed; a stored secret is never shown, and the field stays out of spellcheck and session replay.',
  status: 'stable',
  exports: ['SecretInput', 'SECRET_MASK'],
  import: "import { SecretInput } from '@ui';",
  demos: [
    {
      id: 'password',
      title: 'Typing a secret',
      description:
        'Type to see the eye toggle; it shows and hides what you typed. `autocomplete` is required: `current-password` when signing in, `new-password` when setting a secret, `off` otherwise.',
      render: PasswordDemo,
    },
    {
      id: 'saved',
      title: 'Secret saved',
      description:
        'A stored secret is write-only: `saved` shows a mask placeholder and there is nothing to reveal until something new is typed.',
      render: SavedDemo,
    },
    {
      id: 'states',
      title: 'Disabled and invalid',
      description:
        '`disabled` dims the field and its toggle; `aria-invalid` draws the error ring.',
      render: StatesDemo,
    },
  ],
});
