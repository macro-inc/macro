import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import { TextField } from './TextField';

// #region demo:basic
function BasicDemo() {
  const [value, setValue] = createSignal('');

  return (
    <TextField
      class="w-full max-w-sm"
      value={value()}
      onChange={setValue}
      required
    >
      <TextField.Label>Project name</TextField.Label>
      <TextField.Input placeholder="Quarterly planning" />
      <TextField.Description>
        A short name teammates will recognize.
      </TextField.Description>
    </TextField>
  );
}
// #endregion

// #region demo:textarea
function TextAreaDemo() {
  return (
    <TextField class="w-full max-w-sm" defaultValue="">
      <TextField.Label>Notes</TextField.Label>
      <TextField.TextArea
        autoResize
        placeholder="Add context for your teammates…"
      />
      <TextField.Description>
        This field grows as you type.
      </TextField.Description>
    </TextField>
  );
}
// #endregion

// #region demo:title
function TitleDemo() {
  return (
    <TextField class="w-full max-w-sm" defaultValue="">
      <TextField.Label>Event title</TextField.Label>
      <TextField.TextArea
        variant="title"
        autoResize
        rows={1}
        placeholder="New event"
      />
      <TextField.Description>
        A borderless heading that grows to three lines, then scrolls.
      </TextField.Description>
    </TextField>
  );
}
// #endregion

// #region demo:embedded
function EmbeddedDemo() {
  return (
    <TextField class="w-full max-w-sm" defaultValue="">
      <TextField.Label>Location</TextField.Label>
      <TextField.Surface>
        <TextField.TextArea
          variant="embedded"
          rows={1}
          autoResize
          placeholder="Add location"
        />
      </TextField.Surface>
    </TextField>
  );
}
// #endregion

// #region demo:states
function StatesDemo() {
  return (
    <div class="flex w-full max-w-sm flex-col gap-5">
      <TextField disabled defaultValue="workspace@macro.com">
        <TextField.Label>Account email</TextField.Label>
        <TextField.Input type="email" />
        <TextField.Description>
          Managed by your workspace administrator.
        </TextField.Description>
      </TextField>

      <TextField validationState="invalid" defaultValue="macro">
        <TextField.Label>Workspace URL</TextField.Label>
        <TextField.Input />
        <TextField.ErrorMessage>
          Enter the full workspace URL.
        </TextField.ErrorMessage>
      </TextField>
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'Text Field',
  category: 'Inputs',
  description:
    'An accessible, slot-based text input and textarea. Kobalte connects labels, descriptions, and errors while the controls use the app’s layer-aware tokens.',
  status: 'stable',
  exports: ['TextField'],
  import: "import { TextField } from '@ui';",
  propTypes: ['TextFieldProps'],
  demos: [
    {
      id: 'basic',
      title: 'Basic',
      description:
        'The root owns value state and automatically connects the label and description to the input.',
      render: BasicDemo,
    },
    {
      id: 'textarea',
      title: 'Textarea',
      description:
        '`TextField.TextArea` shares the same root API. `autoResize` lets Kobalte grow it with its content.',
      render: TextAreaDemo,
    },
    {
      id: 'title',
      title: 'Composer title',
      description:
        'Use `variant="title"` with `autoResize` for a three-line heading on desktop and touch.',
      render: TitleDemo,
    },
    {
      id: 'embedded',
      title: 'Quiet field surface',
      description:
        'Share TextField.Surface between rich text and an auto-growing embedded textarea.',
      render: EmbeddedDemo,
    },
    {
      id: 'states',
      title: 'Disabled and invalid',
      description:
        'Root state flows to every slot. Invalid controls receive `aria-invalid`, and the error message is included in `aria-describedby`.',
      render: StatesDemo,
    },
  ],
});
