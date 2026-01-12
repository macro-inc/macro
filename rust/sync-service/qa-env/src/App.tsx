import {
  type Component,
  createMemo,
  createSignal,
  For,
  Match,
  Switch,
} from 'solid-js';
import './index.css';
import { Instance } from './Instance';

export const [allContentMap, setAllContentMap] = createSignal<
  Record<number, string>
>();



const App: Component = () => {

  const allInSyncStatus = createMemo(() => {
      const contentMap = allContentMap();
      const values = Object.values(contentMap ?? {}).filter(value => typeof value === 'string' && value.length > 0);

      if (values.length <= 1) {
          return true;
      }

      const firstValue = values[0];
      const allSame = values.slice(1).every(value => value === firstValue);

      return allSame;
  }, { defer: true });


  return (
    <div class="bg-neutral-900 min-w-screen min-h-screen text-white">
      <h1>qa-env</h1>
      <div class="flex flex-row flex-wrap gap-4 py-2">
        <Switch>
          <Match when={allInSyncStatus()}>
            <div class="bg-green-500 text-white px-2">All in sync</div>
          </Match>
          <Match when={!allInSyncStatus()}>
            <div class="bg-red-500 text-white px-2">Not all in sync</div>
          </Match>
        </Switch>
      </div>
      <div class="flex flex-row flex-wrap gap-4">
        <For each={Array.from({ length: 200 })}>
          {(_, index) => {
            return <Instance id={index()} />;
          }}
        </For>
      </div>
    </div>
  );
};

export default App;
