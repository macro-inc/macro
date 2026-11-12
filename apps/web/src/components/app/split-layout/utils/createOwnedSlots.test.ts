import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createRoot, createSignal, onCleanup } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createOwnedSlots, type OwnedSlots } from './createOwnedSlots';

setFlagsFromString('--expose-gc');
const collectGarbage: () => void = runInNewContext('gc');

// WeakRef targets stay alive until the job that read them ends, and effects
// run after the current task.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
async function settleAndCollect() {
  for (let pass = 0; pass < 3; pass += 1) {
    await settle();
    collectGarbage();
  }
}

/** A split panel showing `initialView`, with its slots. */
function createPanel(initialView?: string) {
  return createRoot((dispose) => {
    const [view, showView] = createSignal(initialView);
    const slots = createOwnedSlots(
      initialView === undefined ? undefined : view
    );
    return { slots, showView, dispose };
  });
}

/** A view that claims `name`; the slot records its own disposal as `label`. */
function mountView(
  slots: OwnedSlots,
  name: string,
  disposed: string[],
  label = name
) {
  return createRoot((unmount) => {
    slots.replace(name, () => onCleanup(() => disposed.push(label)));
    return unmount;
  });
}

describe('createOwnedSlots', () => {
  it('keeps a slot after its creator unmounts while the panel stays in that view', async () => {
    const panel = createPanel('mail');
    const disposed: string[] = [];
    const unmountList = mountView(
      panel.slots,
      'list:navigation-source',
      disposed
    );
    unmountList();
    await settle();
    expect(disposed).toEqual([]);
    panel.dispose();
  });

  it('drops the slots of a view the panel has moved on from', async () => {
    const panel = createPanel('mail');
    const disposed: string[] = [];
    mountView(panel.slots, 'list:data-source', disposed, 'mail data');
    mountView(panel.slots, 'list:activation', disposed, 'mail activation');
    panel.showView('home');
    mountView(panel.slots, 'list:data-source', disposed, 'home data');
    await settle();
    expect(disposed.toSorted()).toEqual(['mail activation', 'mail data']);
    panel.dispose();
    expect(disposed).toContain('home data');
  });

  it('hands a name to the next creator in the same view', () => {
    const panel = createPanel('mail');
    const disposed: string[] = [];
    mountView(panel.slots, 'list:controller', disposed, 'first');
    mountView(panel.slots, 'list:controller', disposed, 'second');
    expect(disposed).toEqual(['first']);
    panel.dispose();
    expect(disposed).toEqual(['first', 'second']);
  });

  it('keeps every slot until its name is reused when the panel has no view', async () => {
    const panel = createPanel();
    const disposed: string[] = [];
    mountView(panel.slots, 'tasks', disposed)();
    await settle();
    expect(disposed).toEqual([]);
    panel.dispose();
    expect(disposed).toEqual(['tasks']);
  });

  it('lets go of a view once the panel shows another', async () => {
    const panel = createPanel('tasks');
    let viewScope: { rows: number[] } | undefined = { rows: [1, 2, 3] };
    const released = new WeakRef(viewScope);
    createRoot((unmount) => {
      const scope = viewScope;
      panel.slots.replace('list:activation', () => ({
        read: () => scope?.rows.length,
      }));
      return unmount;
    })();
    viewScope = undefined;
    await settleAndCollect();
    expect(released.deref()).toBeDefined();

    panel.showView('home');
    await settleAndCollect();
    expect(released.deref()).toBeUndefined();
    panel.dispose();
  });
});
