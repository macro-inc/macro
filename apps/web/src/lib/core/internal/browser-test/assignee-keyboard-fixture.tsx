import '@app/index.css';
import { PickerSheet } from '@components/app/mobile/PickerSheet';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type { QuickAccessContextValue } from '@core/context/quickAccess/types';
import { attachGlobalDOMScope, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EditorPopover } from '@property/editors/popover/EditorPopover';
import { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Button, Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

const USERS = [
  {
    id: 'macro|viewer@example.com',
    email: 'viewer@example.com',
    name: 'Viewer',
  },
  { id: 'macro|alpha@example.com', email: 'alpha@example.com', name: 'Alpha' },
  { id: 'macro|beta@example.com', email: 'beta@example.com', name: 'Beta' },
];

// Assignees and company owners use an explicit roster, not personal suggestions.
const ACCESS: QuickAccessContextValue = {
  useList: () => ({
    items: () => [],
    totalCount: () => 0,
    isLoading: () => false,
    isLoadingMore: () => false,
    error: () => undefined,
    hasMore: () => false,
    loadMore: async () => {},
  }),
  usesRecordSelection: () => false,
  usesSearchProjection: () => true,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
  interactionForUser: () => undefined,
};

function Fixture() {
  useHotKeyRoot();
  attachGlobalDOMScope(document.body);
  const [open, setOpen] = createSignal(false);
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const [selected, setSelected] = createSignal<string[]>([]);
  const single = new URLSearchParams(location.search).has('single');
  const selector = () => (
    <PropertyEntitySelector
      config={{
        isMultiSelect: !single,
        specificEntityType: 'USER',
        users: () => USERS,
        placeholder: 'Add assignees...',
      }}
      selectedOptions={() => new Set(selected())}
      setSelectedOptions={(value) => setSelected([...value])}
      onClose={() => {
        setOpen(false);
        setSheetOpen(false);
      }}
    />
  );
  return (
    <main class="flex flex-col items-start gap-4 p-8">
      <Dropdown open={open()} onOpenChange={setOpen}>
        <Dropdown.Trigger>Assignees</Dropdown.Trigger>
        <Show when={open()}>
          <EditorPopover onClose={() => setOpen(false)}>
            {selector()}
            <input aria-label="Another field" />
          </EditorPopover>
        </Show>
      </Dropdown>
      <Button onClick={() => setSheetOpen(true)}>Assignee sheet</Button>
      <PickerSheet.Root open={sheetOpen()} onCancel={() => setSheetOpen(false)}>
        <PickerSheet.Header
          title="Assignees"
          onDone={() => setSheetOpen(false)}
        />
        <PickerSheet.Body>{selector()}</PickerSheet.Body>
      </PickerSheet.Root>
      <Dropdown>
        <Dropdown.Trigger>Working menu</Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item>Alpha</Dropdown.Item>
          <Dropdown.Item>Beta</Dropdown.Item>
          <Dropdown.Item>Gamma</Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
      <output data-testid="selected">{JSON.stringify(selected())}</output>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <QueryClientProvider client={new QueryClient()}>
      <QuickAccessContextProvider value={ACCESS}>
        <Fixture />
      </QuickAccessContextProvider>
    </QueryClientProvider>
  ),
  root
);
