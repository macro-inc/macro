import { isTouchDevice } from '@core/mobile/isTouchDevice';
import '@app/index.css';
import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { Button } from '@ui';
import { For } from 'solid-js';
import { render } from 'solid-js/web';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

// A page about as heavy as a long channel: message rows of a few nested boxes
// of themed text (`?messages=`, 400 by default, about 5,000 elements), so a
// style pass over the whole document costs what it does in the app.
const MESSAGE_COUNT = Number(
  new URLSearchParams(location.search).get('messages') ?? 400
);
const MESSAGES = Array.from({ length: MESSAGE_COUNT }, (_, index) => index);

function Message(props: { index: number }) {
  return (
    <article class="flex gap-3 rounded-lg px-4 py-2 not-touch:hover:bg-hover">
      <div class="size-8 shrink-0 rounded-full bg-accent/20" />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <span class="text-sm font-medium text-ink">
            Person {props.index % 17}
          </span>
          <span class="text-xs text-ink-muted">10:{props.index % 60}</span>
        </div>
        <p class="text-sm leading-normal text-ink wrap-anywhere">
          Message {props.index}: the quarterly plan moved to the shared folder,
          and the <strong>review</strong> starts after lunch.
        </p>
        <p class="mt-1 text-sm text-ink-muted">
          <a class="text-link underline" href="#message">
            Open the plan
          </a>{' '}
          or reply in the thread.
        </p>
        <div class="mt-1 flex gap-1">
          <span class="rounded-full border border-edge-muted px-2 text-xs">
            👍 {props.index % 5}
          </span>
          <span class="rounded-full border border-edge-muted px-2 text-xs">
            🎉 {props.index % 3}
          </span>
        </div>
      </div>
    </article>
  );
}

const shown: number[] = [];

function show(message: string) {
  const id = toast.success(message, { stack: true, duration: 30000 });
  if (id !== undefined) shown.push(id);
}

function Fixture() {
  return (
    <div class="flex h-screen flex-col bg-page text-ink">
      <div class="flex gap-3 p-4">
        <Button onClick={() => show('Link copied')}>Show toast</Button>
        <Button
          variant="secondary"
          onClick={() => {
            for (const id of shown.splice(0)) toast.dismiss(id);
          }}
        >
          Dismiss toasts
        </Button>
      </div>
      <main class="min-h-0 flex-1 overflow-y-auto">
        <For each={MESSAGES}>{(index) => <Message index={index} />}</For>
      </main>
      <ToastRegion />
    </div>
  );
}
render(() => <Fixture />, document.getElementById('root')!);
