import type { FigEngine } from '@core/fig-engine/client';
import { LoroDoc } from 'loro-crdt';
import { describe, expect, it, vi } from 'vitest';
import { seedDesign } from '../core/collab-entries';
import { shareFigEngine } from './fig-sharing';

describe('joining a shared design', () => {
  it('does not force a scene or full decode for metadata alone', async () => {
    const doc = new LoroDoc();
    seedDesign(doc);
    const engine = {
      enableCollab: vi.fn().mockResolvedValue([]),
      applyRemote: vi.fn().mockResolvedValue({}),
    };
    const sharing = await shareFigEngine(engine as unknown as FigEngine, doc, {
      fingerprint: 'file',
    });
    expect(engine.enableCollab).toHaveBeenCalledTimes(1);
    expect(engine.applyRemote).not.toHaveBeenCalled();
    sharing.close();
  });

  it('still replays existing edits before the design becomes editable', async () => {
    const doc = new LoroDoc();
    seedDesign(doc);
    const engine = {
      enableCollab: vi.fn().mockResolvedValue([]),
      applyRemote: vi.fn().mockResolvedValue({}),
    };
    const first = await shareFigEngine(engine as unknown as FigEngine, doc, {
      fingerprint: 'file',
    });
    first.close();
    doc.getMap('figNodes').set('1:2', 'encoded-node');
    doc.commit();
    const sharing = await shareFigEngine(engine as unknown as FigEngine, doc, {
      fingerprint: 'file',
    });
    expect(engine.applyRemote).toHaveBeenCalledWith(0, [
      { container: 'figNodes', key: '1:2', value: 'encoded-node' },
    ]);
    sharing.close();
  });
});
