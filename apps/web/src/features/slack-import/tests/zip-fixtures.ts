import { strToU8, Zip, ZipDeflate, zipSync } from 'fflate';

/** Synthetic archives only; strings represent literal (possibly malformed) file bytes. */
export function zipFixture(
  entries: Record<string, unknown>,
  compressed = true
): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, value]) => [
        path,
        strToU8(typeof value === 'string' ? value : JSON.stringify(value)),
      ])
    ),
    { level: compressed ? 6 : 0 }
  );
}

/** Streaming ZIPs use data descriptors rather than sizes in local headers. */
export function streamingZipFixture(
  entries: Record<string, unknown>
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  for (const [path, value] of Object.entries(entries)) {
    const file = new ZipDeflate(path);
    zip.add(file);
    file.push(strToU8(JSON.stringify(value)), true);
  }
  zip.end();
  const bytes = new Uint8Array(
    chunks.reduce((size, chunk) => size + chunk.length, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function zipBlob(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes).buffer]);
}

export const USERS = [
  { id: 'U100', name: 'alice', profile: { email: 'Alice+Slack@Example.Test' } },
  { id: 'U200', name: 'bob', profile: null },
];
export const MESSAGE = {
  type: 'message',
  user: 'U100',
  ts: '1700000000.000001',
  text: 'Synthetic history',
};

export function standardEntries(): Record<string, unknown> {
  return {
    'users.json': USERS,
    'channels.json': [
      {
        id: 'C100',
        name: 'general',
        members: ['U100', 'U200'],
        created: 1700000000,
      },
    ],
    'general/2023-11-14.json': [MESSAGE],
  };
}

export function corporateEntries(): Record<string, unknown> {
  return {
    'users.json': USERS,
    'groups.json': [
      {
        id: 'C200',
        name: 'private',
        members: ['U100', 'U200'],
        is_archived: true,
      },
    ],
    'dms.json': [{ id: 'D100', members: ['U100', 'U200'] }],
    'mpims.json': [
      { id: 'G100', name: 'mpdm-example', members: ['U100', 'U200', 'U300'] },
    ],
    'private/2023-11-14.json': [MESSAGE],
    'D100/2023-11-14.json': [MESSAGE],
    'mpdm-example/2023-11-14.json': [MESSAGE],
  };
}

export function enterpriseEntries(): Record<string, unknown> {
  return {
    'org_users.json': [
      {
        id: 'W100',
        name: 'enterprise-alice',
        profile: { email: 'Enterprise@Example.Test' },
        enterprise_user: { teams: ['T100'] },
      },
    ],
    'channels.json': [
      { id: 'C300', name: 'enterprise', members: ['W100', 'U999'] },
    ],
    'enterprise/2023-11-14.json': [MESSAGE],
  };
}

/** Mutate paired headers without changing the payload, for adversarial ZIP fixtures. */
export function patchEntry(
  bytes: Uint8Array,
  path: string,
  patch: (header: DataView, central: boolean) => void
): Uint8Array {
  const result = bytes.slice();
  const data = new DataView(
    result.buffer,
    result.byteOffset,
    result.byteLength
  );
  const end = result.length - 22;
  let offset = data.getUint32(end + 16, true);
  const count = data.getUint16(end + 10, true);
  for (let index = 0; index < count; index++) {
    const nameSize = data.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(
      result.subarray(offset + 46, offset + 46 + nameSize)
    );
    if (name === path) {
      const local = data.getUint32(offset + 42, true);
      patch(new DataView(result.buffer, result.byteOffset + local), false);
      patch(new DataView(result.buffer, result.byteOffset + offset), true);
      return result;
    }
    offset +=
      46 +
      nameSize +
      data.getUint16(offset + 30, true) +
      data.getUint16(offset + 32, true);
  }
  throw new Error('Fixture entry not found');
}
