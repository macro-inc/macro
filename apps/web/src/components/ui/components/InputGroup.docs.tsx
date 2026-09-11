import { defineDoc } from '@app/features/ui-gallery/types';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CheckCircleIcon from '@phosphor/check-circle.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { createSignal } from 'solid-js';
import { Button } from './Button';
import { ButtonGroup } from './ButtonGroup';
import { InputGroup } from './InputGroup';

// #region demo:search
function SearchDemo() {
  const [query, setQuery] = createSignal('Quarterly plan');

  return (
    <InputGroup class="max-w-sm">
      <InputGroup.Input
        type="search"
        value={query()}
        onInput={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search documents"
        aria-label="Search documents"
      />
      <InputGroup.Addon align="inline-start">
        <MagnifyingGlassIcon aria-hidden="true" />
      </InputGroup.Addon>
      <InputGroup.Addon align="inline-end">
        <InputGroup.ClearButton />
      </InputGroup.Addon>
    </InputGroup>
  );
}
// #endregion

// #region demo:addons
function AddonsDemo() {
  return (
    <div class="flex w-full max-w-sm flex-col gap-3">
      <InputGroup>
        <InputGroup.Input
          type="email"
          value="team@macro.com"
          aria-label="Team email"
        />
        <InputGroup.Addon align="inline-start">
          <EnvelopeIcon aria-hidden="true" />
        </InputGroup.Addon>
        <InputGroup.Addon align="inline-end">
          <CheckCircleIcon class="text-success" aria-hidden="true" />
        </InputGroup.Addon>
      </InputGroup>

      <InputGroup>
        <InputGroup.Addon align="inline-start">https://</InputGroup.Addon>
        <InputGroup.Input placeholder="macro.com" aria-label="Website" />
        <InputGroup.Addon align="inline-end">
          <InputGroup.Button aria-label="Open website" square>
            <ArrowRightIcon />
          </InputGroup.Button>
        </InputGroup.Addon>
      </InputGroup>
    </div>
  );
}
// #endregion

// #region demo:button-group
function ButtonGroupDemo() {
  return (
    <ButtonGroup
      variant="outline"
      size="md"
      class="w-full max-w-sm"
      aria-label="Search documents"
    >
      <InputGroup>
        <InputGroup.Input
          placeholder="Search documents"
          aria-label="Search query"
        />
        <InputGroup.Addon align="inline-start">
          <MagnifyingGlassIcon aria-hidden="true" />
        </InputGroup.Addon>
      </InputGroup>
      <ButtonGroup.Divider />
      <Button aria-label="Submit search" square>
        <ArrowRightIcon />
      </Button>
    </ButtonGroup>
  );
}
// #endregion

export default defineDoc({
  name: 'InputGroup',
  category: 'Inputs',
  description:
    'Composes an Input with decorative addons, standard Buttons, and a reactive clear action inside one shared frame.',
  status: 'stable',
  exports: ['InputGroup'],
  import: "import { InputGroup } from '@ui';",
  demos: [
    {
      id: 'search',
      title: 'Search and clear',
      description:
        'The clear slot follows the input value, dispatches the normal input event, and restores focus without a tooltip.',
      render: SearchDemo,
    },
    {
      id: 'addons',
      title: 'Addons and actions',
      description:
        'Addon alignment controls visual placement independently of DOM order. Use InputGroup.Button for an interactive action.',
      render: AddonsDemo,
    },
    {
      id: 'button-group',
      title: 'Button group composition',
      description:
        'When nested in ButtonGroup, InputGroup inherits its size and lets the outer group own the shared frame.',
      render: ButtonGroupDemo,
    },
  ],
});
