import '@app/index.css';
import { Property } from '@property';
import type { PropertyApiValues, Property as PropertyT } from '@property/types';
import { withApiValues } from '@property/utils/transforms';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

const BASE = {
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as const;

const PROPERTIES: PropertyT[] = [
  {
    ...BASE,
    propertyId: 'number',
    propertyDefinitionId: 'number',
    displayName: 'Points',
    valueType: 'NUMBER',
    value: 3,
  },
  {
    ...BASE,
    propertyId: 'text',
    propertyDefinitionId: 'text',
    displayName: 'Summary',
    valueType: 'STRING',
    value: 'Draft',
  },
  {
    ...BASE,
    propertyId: 'links',
    propertyDefinitionId: 'links',
    displayName: 'Links',
    valueType: 'LINK',
    isMultiSelect: true,
    value: ['https://example.com/one'],
  },
  {
    ...BASE,
    propertyId: 'link',
    propertyDefinitionId: 'link',
    displayName: 'Link',
    valueType: 'LINK',
    value: null,
  },
  {
    ...BASE,
    propertyId: 'flag',
    propertyDefinitionId: 'flag',
    displayName: 'Done',
    valueType: 'BOOLEAN',
    value: false,
  },
];

type HeldSave = PromiseWithResolvers<void>;
const HELD: HeldSave[] = [];

declare global {
  interface Window {
    finishSave: () => void;
    failSave: () => void;
    heldSaves: () => number;
  }
}
window.finishSave = () => HELD.shift()?.resolve();
window.failSave = () => HELD.shift()?.reject(new Error('Save failed'));
window.heldSaves = () => HELD.length;

function Row(props: { property: PropertyT }) {
  const [property, setProperty] = createSignal(props.property);
  const save = async (saved: PropertyT, value: PropertyApiValues) => {
    const hold = Promise.withResolvers<void>();
    HELD.push(hold);
    await hold.promise;
    setProperty(withApiValues(saved, value));
  };
  return (
    <div class="flex items-center gap-2">
      <div class="w-80" data-testid={props.property.propertyId}>
        <Property.Root property={property()} canEdit onSave={save}>
          <Property.InlineEditor />
        </Property.Root>
      </div>
      <button data-testid={`after-${props.property.propertyId}`}>After</button>
    </div>
  );
}

function Fixture() {
  return (
    <main class="flex flex-col gap-4 p-8">
      <For each={PROPERTIES}>{(property) => <Row property={property} />}</For>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
