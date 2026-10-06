import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_UPGRADE_WINDOW_MS,
  legacyOfficeUpgradeTarget,
  pollForLegacyUpgrade,
  shouldAwaitLegacyUpgrade,
  upgradedOfficeLabel,
} from './legacy-office';

describe('legacyOfficeUpgradeTarget', () => {
  it('maps legacy Office types to OpenXML', () => {
    expect(legacyOfficeUpgradeTarget('doc')).toBe('docx');
    expect(legacyOfficeUpgradeTarget('ppt')).toBe('pptx');
    expect(legacyOfficeUpgradeTarget('xls')).toBe('xlsx');
    expect(legacyOfficeUpgradeTarget('PPT')).toBe('pptx');
  });

  it('ignores types that are not upgraded', () => {
    for (const fileType of ['docx', 'pptx', 'xlsx', 'xlsm', 'pdf', '', null]) {
      expect(legacyOfficeUpgradeTarget(fileType)).toBeUndefined();
    }
  });

  it('labels each target', () => {
    expect(upgradedOfficeLabel('docx')).toBe('Word document');
    expect(upgradedOfficeLabel('pptx')).toBe('PowerPoint presentation');
    expect(upgradedOfficeLabel('xlsx')).toBe('Excel workbook');
  });
});

describe('shouldAwaitLegacyUpgrade', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');

  it('waits for a recent legacy upload', () => {
    expect(
      shouldAwaitLegacyUpgrade(
        { fileType: 'ppt', createdAt: '2026-10-06T11:59:00Z' },
        now
      )
    ).toBe(true);
  });

  it('does not wait for old legacy documents', () => {
    expect(
      shouldAwaitLegacyUpgrade(
        {
          fileType: 'ppt',
          createdAt: new Date(now - LEGACY_UPGRADE_WINDOW_MS).toISOString(),
        },
        now
      )
    ).toBe(false);
  });

  it('does not wait without a usable creation time or legacy type', () => {
    expect(shouldAwaitLegacyUpgrade({ fileType: 'doc' }, now)).toBe(false);
    expect(
      shouldAwaitLegacyUpgrade(
        { fileType: 'doc', createdAt: 'not a date' },
        now
      )
    ).toBe(false);
    expect(
      shouldAwaitLegacyUpgrade(
        { fileType: 'pdf', createdAt: '2026-10-06T11:59:00Z' },
        now
      )
    ).toBe(false);
  });
});

describe('pollForLegacyUpgrade', () => {
  function clock() {
    let time = 0;
    return {
      now: () => time,
      sleep: vi.fn(async (ms: number) => {
        time += ms;
      }),
    };
  }

  it('resolves once the file type changes', async () => {
    const { now, sleep } = clock();
    const fetchMetadata = vi
      .fn<() => Promise<{ fileType: string }>>()
      .mockResolvedValueOnce({ fileType: 'ppt' })
      .mockResolvedValueOnce({ fileType: 'ppt' })
      .mockResolvedValueOnce({ fileType: 'pptx' });

    const result = await pollForLegacyUpgrade({
      target: 'pptx',
      fetchMetadata,
      fileTypeOf: (m) => m.fileType,
      sleep,
      now,
      intervalMs: 1_000,
    });

    expect(result).toEqual({ fileType: 'pptx' });
    expect(fetchMetadata).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('retries failed requests', async () => {
    const { now, sleep } = clock();
    const fetchMetadata = vi
      .fn<() => Promise<{ fileType: string }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ fileType: 'docx' });

    const result = await pollForLegacyUpgrade({
      target: 'docx',
      fetchMetadata,
      fileTypeOf: (m) => m.fileType,
      sleep,
      now,
    });

    expect(result).toEqual({ fileType: 'docx' });
  });

  it('gives up at the timeout', async () => {
    const { now, sleep } = clock();
    const fetchMetadata = vi.fn(async () => ({ fileType: 'xls' }));

    const result = await pollForLegacyUpgrade({
      target: 'xlsx',
      fetchMetadata,
      fileTypeOf: (m) => m.fileType,
      sleep,
      now,
      intervalMs: 1_000,
      timeoutMs: 5_000,
    });

    expect(result).toBeUndefined();
    expect(fetchMetadata).toHaveBeenCalledTimes(5);
  });

  it('stops when aborted', async () => {
    const { now, sleep } = clock();
    const controller = new AbortController();
    const fetchMetadata = vi.fn(async () => {
      controller.abort();
      return { fileType: 'doc' };
    });

    const result = await pollForLegacyUpgrade({
      target: 'docx',
      fetchMetadata,
      fileTypeOf: (m) => m.fileType,
      sleep,
      now,
      signal: controller.signal,
    });

    expect(result).toBeUndefined();
    expect(fetchMetadata).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not accept a different target', async () => {
    const { now, sleep } = clock();

    const result = await pollForLegacyUpgrade({
      target: 'pptx',
      fetchMetadata: async () => ({ fileType: 'docx' }),
      fileTypeOf: (m) => m.fileType,
      sleep,
      now,
      intervalMs: 1_000,
      timeoutMs: 2_000,
    });

    expect(result).toBeUndefined();
  });
});
