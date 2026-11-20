import { createHash } from 'node:crypto';
import { crc32 as referenceCrc32 } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildStoredZip, crc32 } from './stored-zip';

function file(contents: string | Uint8Array<ArrayBuffer>, name = 'file') {
  return new File([contents], name, { lastModified: Date.UTC(2025, 2, 14) });
}

async function bytesOf(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

/** CRC-32 of each file entry, read from the central directory. */
function centralDirectoryCrcs(bytes: Uint8Array): Map<string, number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const crcs = new Map<string, number>();
  for (let i = 0; i < entries; i++) {
    const nameLength = view.getUint16(offset + 28, true);
    const name = strFromU8(
      bytes.subarray(offset + 46, offset + 46 + nameLength)
    );
    crcs.set(name, view.getUint32(offset + 16, true));
    offset += 46 + nameLength;
  }
  return crcs;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(0, new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('continues across chunks', () => {
    const bytes = new TextEncoder().encode('quarterly summary for the board');
    const whole = crc32(0, bytes);
    expect(crc32(crc32(0, bytes.subarray(0, 7)), bytes.subarray(7))).toBe(
      whole
    );
  });
});

describe('buildStoredZip', () => {
  it('writes files and folders a zip reader can open', async () => {
    const zip = await buildStoredZip(
      [
        { path: 'Pack/Summary.docx', file: file('docx bytes') },
        { path: 'Pack/Finance/Forecasts/Q4.xlsx', file: file('xlsx bytes') },
        { path: 'Pack/Café Menü.pdf', file: file('unicode name') },
      ],
      ['Pack', 'Pack/Empty']
    );

    const entries = unzipSync(await bytesOf(zip.blob));
    expect(Object.keys(entries).sort()).toEqual([
      'Pack/',
      'Pack/Café Menü.pdf',
      'Pack/Empty/',
      'Pack/Finance/',
      'Pack/Finance/Forecasts/',
      'Pack/Finance/Forecasts/Q4.xlsx',
      'Pack/Summary.docx',
    ]);
    expect(strFromU8(entries['Pack/Finance/Forecasts/Q4.xlsx'])).toBe(
      'xlsx bytes'
    );
  });

  it('records each file’s CRC-32 and hashes the exact archive bytes', async () => {
    const large = new Uint8Array(9 * 1024 * 1024).map((_, i) => (i * 31) % 251);
    const zip = await buildStoredZip(
      [
        { path: 'Scans/large.pdf', file: file(large) },
        { path: 'Scans/empty.txt', file: file('') },
      ],
      []
    );

    const bytes = await bytesOf(zip.blob);
    const crcs = centralDirectoryCrcs(bytes);
    expect(crcs.get('Scans/large.pdf')).toBe(referenceCrc32(large));
    expect(crcs.get('Scans/empty.txt')).toBe(0);
    expect(zip.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('zips a folder that has no files', async () => {
    const zip = await buildStoredZip([], ['Shell', 'Shell/A']);

    expect(Object.keys(unzipSync(await bytesOf(zip.blob))).sort()).toEqual([
      'Shell/',
      'Shell/A/',
    ]);
  });

  it('reports bytes read until every file is read', async () => {
    const reports: [number, number][] = [];
    await buildStoredZip(
      [
        { path: 'A/one.txt', file: file('12345') },
        { path: 'A/two.txt', file: file('678') },
      ],
      [],
      (processed, total) => reports.push([processed, total])
    );

    expect(reports.at(-1)).toEqual([8, 8]);
  });
});
