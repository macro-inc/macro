import { RecipientSelector } from '@core/component/RecipientSelector';
import type {
  CombinedRecipientItem,
  WithCustomUserInput,
} from '@core/user/combinedRecipient';
import { createSignal } from 'solid-js';

const OPTIONS: CombinedRecipientItem<'user'>[] = [
  {
    kind: 'user',
    id: 'macro|notifications@example.com',
    data: {
      id: 'macro|notifications@example.com',
      email: 'notifications@example.com',
      name: 'Notifications mailbox',
      lastInteraction: new Date(),
    },
  },
  {
    kind: 'user',
    id: 'macro|recent@example.com',
    data: {
      id: 'macro|recent@example.com',
      email: 'recent@example.com',
      name: 'Person Example Com',
      lastInteraction: new Date(),
    },
  },
  {
    kind: 'user',
    id: 'macro|person@example.com',
    data: {
      id: 'macro|person@example.com',
      email: 'person@example.com',
      name: 'Older Person',
    },
  },
];

export function RecipientRankingFixture() {
  const [selected, setSelected] = createSignal<WithCustomUserInput<'user'>[]>(
    []
  );
  return (
    <main class="p-6 max-w-xl bg-page text-ink min-h-screen">
      <RecipientSelector
        options={() => OPTIONS}
        selectedOptions={selected()}
        setSelectedOptions={setSelected}
        placeholder="Recipients"
      />
      <pre data-testid="recipients">
        {JSON.stringify(selected().map((item) => item.id))}
      </pre>
    </main>
  );
}
