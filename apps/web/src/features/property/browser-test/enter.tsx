import '@app/index.css';
import { createEnterOwningControl } from '@block-md/util/createEnterOwningControl';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { Property, useProperty } from '@property';
import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { EditorPopover } from '../editors/popover/EditorPopover';
import type { Property as PropertyValue } from '../types';
import { useSearchInputFocus } from '../utils/focus';

const STATUS: PropertyValue = {
  propertyId: 'status-property',
  propertyDefinitionId: 'status-definition',
  displayName: 'Status',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'SELECT_STRING',
  value: ['in-progress'],
};

function SearchField() {
  let input: HTMLInputElement | undefined;
  useSearchInputFocus(() => input);
  return <input ref={input} aria-label="Search options" />;
}

function Picker() {
  const ctx = useProperty();
  return (
    <Show when={ctx.editorOpen()}>
      <EditorPopover>
        <SearchField />
      </EditorPopover>
    </Show>
  );
}

function Fixture() {
  useHotKeyRoot();
  attachGlobalDOMScope(document.body);
  const [attachScope, scopeId] = useHotkeyDOMScope('property-enter-fixture');
  const ownsEnter = createEnterOwningControl();
  let editor: HTMLDivElement | undefined;

  // The document's own Enter, as in Notebook.
  registerHotkey({
    hotkey: 'enter',
    scopeId,
    description: 'Focus document',
    keyDownHandler: (event) => {
      if (ownsEnter(event?.target)) return false;
      editor?.focus();
      return true;
    },
  });

  return (
    <main ref={attachScope} class="flex flex-col items-start gap-8 p-8">
      <Property.Root property={STATUS} canEdit onSave={async () => {}}>
        <Property.Tooltip property={STATUS}>
          <Property.Pill>In progress</Property.Pill>
        </Property.Tooltip>
        <Picker />
      </Property.Root>
      <button type="button">Copy</button>
      <p data-testid="outside">Outside</p>
      {/* A scrollbar: pressing it takes no focus. */}
      <div
        data-testid="scrollbar"
        class="p-2 border"
        onMouseDown={(event) => event.preventDefault()}
      >
        Scrollbar
      </div>
      <div
        ref={editor}
        role="textbox"
        aria-label="Document"
        contentEditable
        tabIndex={-1}
        class="w-80 h-20 border"
      />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
