import { createPillCompaction } from '@app/features/entity/composed/list-entity/pill-compaction';
import {
  activeElement,
  mountGlobalFocusListener,
} from '@app/lib/signals/focus';
import { createEffect, createRoot } from 'solid-js';

createRoot(() => {
  mountGlobalFocusListener();
  createEffect(() => {
    document.body.dataset.active = activeElement()?.tagName ?? 'none';
  });
  const rows = document.getElementById('rows')!;
  for (let i = 0; i < 100; i++) {
    const row = document.createElement('div');
    const pills = document.createElement('span');
    pills.textContent = 'Example property with a very long label';
    row.append(pills);
    rows.append(row);
    const compaction = createPillCompaction(
      () => pills,
      () => row
    );
    createEffect(() => {
      pills.dataset.compact = String(compaction.compact());
      pills.style.maxWidth = compaction.compact() ? '40px' : '100px';
    });
  }
  document.getElementById('grow')!.onclick = () => {
    for (const row of rows.children) {
      if (row instanceof HTMLElement) row.style.width = '800px';
    }
  };
  document.getElementById('change')!.onclick = () => {
    for (const row of rows.children)
      row.firstElementChild!.textContent = 'Short';
  };
});
