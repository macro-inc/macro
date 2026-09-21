import { describe, expect, it, vi } from 'vitest';
import { disclosureExporter } from './disclosure-exporter';

describe('disclosure exporter', () => {
  it('discards a queued batch when permission is revoked before export', () => {
    let allowed = true;
    const inner = { export: vi.fn(), shutdown: vi.fn(async () => {}) };
    const exporter = disclosureExporter(inner, () => allowed);
    exporter.export(['first'], vi.fn());
    expect(inner.export).toHaveBeenCalledTimes(1);
    allowed = false;
    const done = vi.fn();
    exporter.export(['patient data'], done);
    expect(inner.export).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith({ code: 0 });
  });
});
