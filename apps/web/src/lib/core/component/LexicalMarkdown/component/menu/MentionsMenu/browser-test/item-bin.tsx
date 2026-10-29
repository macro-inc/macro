import '@app/index.css';
import { Surface } from '@ui';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { ItemBin } from '../components/ItemBin';

const people = [
  'Ada Lovelace',
  'Alan Turing',
  'Grace Hopper',
  'Linus Torvalds',
  'Margaret Hamilton',
];
const shownPerBin = 3;

function Fixture() {
  const [search, setSearch] = createSignal('');
  const matches = () =>
    people.filter((name) =>
      name.toLowerCase().includes(search().toLowerCase())
    );
  return (
    <main class="p-4 text-ink bg-page space-y-4">
      <input
        aria-label="Search people"
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <Surface depth={2} class="menu-surface w-96 pt-2 pb-1.5">
        <ItemBin
          label="People"
          binType="users"
          totalCount={matches().length}
          showingCount={Math.min(matches().length, shownPerBin)}
          onViewAll={() => {}}
        >
          <For each={matches().slice(0, shownPerBin)}>
            {(name) => <div class="flex h-9 items-center px-2">{name}</div>}
          </For>
        </ItemBin>
      </Surface>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
