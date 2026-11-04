import { defineDoc } from '@app/features/ui-gallery/types';
import { parseDomain } from '@core/util/domain';
import { createSignal } from 'solid-js';
import { ChipCombobox, type ChipComboboxOption } from './ChipCombobox';

const DOMAIN_OPTIONS: ChipComboboxOption[] = [
  { value: 'globex.example', label: 'Globex', detail: 'globex.example' },
  { value: 'initech.example', label: 'Initech', detail: 'initech.example' },
  { value: 'acme.com', label: 'acme.com', detail: '12 contacts' },
  { value: 'example.org', label: 'example.org', detail: '3 contacts' },
];

// #region demo:domains
function DomainsDemo() {
  const [domains, setDomains] = createSignal(['acme.com']);
  return (
    <div class="w-full max-w-md">
      <ChipCombobox
        aria-label="Domains"
        placeholder="Add companies or domains"
        values={domains()}
        onChange={setDomains}
        options={DOMAIN_OPTIONS}
        parseValue={parseDomain}
        addLabel={(value) => `Add “${value}”`}
        removeLabel={(value) => `Remove ${value}`}
      />
    </div>
  );
}
// #endregion

// #region demo:suggestions-only
function SuggestionsOnlyDemo() {
  const [values, setValues] = createSignal<string[]>([]);
  return (
    <div class="w-full max-w-md">
      <ChipCombobox
        aria-label="Companies"
        placeholder="Pick companies"
        values={values()}
        onChange={setValues}
        options={DOMAIN_OPTIONS.slice(0, 2)}
        addLabel={(value) => `Add “${value}”`}
        removeLabel={(value) => `Remove ${value}`}
      />
    </div>
  );
}
// #endregion

export default defineDoc({
  name: 'ChipCombobox',
  category: 'Inputs',
  description:
    'A multi-value field of removable chips with suggestions (optionally with icons) and, given a parser, typed entries. It uses the outline Input frame. Use RecipientSelector for message recipients.',
  status: 'beta',
  exports: ['ChipCombobox', 'ChipComboboxOption'],
  import: "import { ChipCombobox } from '@ui';",
  demos: [
    {
      id: 'domains',
      title: 'Suggestions and typed values',
      description:
        'Suggestions show a label with muted detail; chips show the value. With `parseValue`, a comma, Enter, or leaving the field adds typed text, and the list offers an Add row for a value no suggestion matches.',
      render: DomainsDemo,
    },
    {
      id: 'suggestions-only',
      title: 'Suggestions only',
      description: 'Without `parseValue`, only suggestions can be added.',
      render: SuggestionsOnlyDemo,
    },
  ],
});
