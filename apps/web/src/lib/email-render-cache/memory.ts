import type { PreparedEmailBody } from '@macro-inc/email-renderer';

interface Entry {
  body: PreparedEmailBody;
  bytes: number;
  leases: number;
}

/** Map insertion order is the LRU; active leases may exceed the byte budget. */
export class PreparedMemory {
  private entries = new Map<string, Entry>();
  bytes = 0;

  constructor(readonly budget: number) {}

  get(key: string): PreparedEmailBody | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.body;
  }

  publish(key: string, body: PreparedEmailBody): PreparedEmailBody {
    const existing = this.get(key);
    if (existing) return existing;
    const immutable = Object.freeze({
      html: body.html,
      kind: body.kind,
      hasTable: body.hasTable,
      hasHiddenContent: body.hasHiddenContent,
    });
    const bytes = 2 * (body.html.length + key.length) + 128;
    this.entries.set(key, { body: immutable, bytes, leases: 0 });
    this.bytes += bytes;
    return immutable;
  }

  retain(key: string): () => void {
    const entry = this.entries.get(key);
    if (!entry) return () => {};
    entry.leases++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.leases--;
      this.trim();
    };
  }

  trim(extraBytes = 0): void {
    for (const [key, entry] of this.entries) {
      if (this.bytes + extraBytes <= this.budget) break;
      if (entry.leases) continue;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
