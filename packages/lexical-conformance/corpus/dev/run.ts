import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pull } from './pull';
import { sampleIds } from './sample';
import { nodes, object, scan } from './scan';
import { directory, openCache } from './store';

export function load() {
  const cache = openCache();
  return sampleIds()
    .map((id) => ({
      id,
      name:
        createHash('sha256').update(`document:${id}`).digest('hex') + '.enc',
    }))
    .filter(({ name }) => existsSync(join(directory, name)))
    .flatMap(({ id, name }) => {
      const value = cache.read(name);
      if (
        !object(value) ||
        value.id !== id ||
        value.source !== 'document' ||
        typeof value.raw !== 'string' ||
        !Array.isArray(value.documents) ||
        value.documents.length !== 1
      )
        throw new Error('Invalid corpus record');
      const raw = value.raw;
      return value.documents.map((state: unknown) => ({
        id: name.slice(0, -4),
        state,
        raw,
      }));
    });
}

export function scans() {
  const records = load();
  // Only schema names from the committed synthetic inventory can enter reports.
  // Unknown names from real documents are combined, never emitted verbatim.
  const histogram: Record<
    string,
    { nodes: number; fields: Record<string, number>; otherFields: number }
  > = {};
  const inventory = readFileSync(
    new URL(
      '../../../../crates/client/lexical/macro_document_model/tests/corpus/nodes.jsonl',
      import.meta.url
    ),
    'utf8'
  );
  for (const line of inventory.trim().split('\n')) {
    const row: unknown = JSON.parse(line);
    if (!object(row)) continue;
    for (const node of nodes(row.input)) {
      if (typeof node.type !== 'string') continue;
      histogram[node.type] ??= {
        nodes: 0,
        fields: {},
        otherFields: 0,
      };
      const counts = histogram[node.type];
      for (const field of Object.keys(node)) counts.fields[field] = 0;
    }
  }
  const result = {
    selectedDocuments: sampleIds().length,
    unavailableDocuments: sampleIds().length - records.length,
    documents: records.length,
    documentsWithLoneSurrogates: 0,
    loneSurrogates: 0,
    magicChip: { nodes: 0, missing: 0, null: 0, known: 0, other: 0 },
    replyTarget: {
      nodes: 0,
      missing: 0,
      invalid: 0,
      type: 0,
      id: 0,
      extraKeys: 0,
      parentsWithExtraKeys: 0,
    },
    histogram,
    unknownNodeTypes: 0,
  };
  for (const record of records) {
    for (const node of nodes(record.state)) {
      const counts =
        typeof node.type === 'string' && Object.hasOwn(histogram, node.type)
          ? histogram[node.type]
          : undefined;
      if (!counts) {
        result.unknownNodeTypes++;
        continue;
      }
      counts.nodes++;
      for (const field of Object.keys(node)) {
        if (Object.hasOwn(counts.fields, field)) counts.fields[field]++;
        else counts.otherFields++;
      }
    }
    const counts = scan(record.raw);
    result.loneSurrogates += counts.loneSurrogates;
    if (counts.loneSurrogates) result.documentsWithLoneSurrogates++;
    for (const key of Object.keys(
      result.magicChip
    ) as (keyof typeof result.magicChip)[])
      result.magicChip[key] += counts.magicChip[key];
    for (const key of Object.keys(
      result.replyTarget
    ) as (keyof typeof result.replyTarget)[])
      result.replyTarget[key] += counts.replyTarget[key];
  }
  return result;
}

if (import.meta.main) {
  try {
    if (process.argv[2] === 'pull') console.log(JSON.stringify(await pull()));
    else if (process.argv[2] === 'scan') console.log(JSON.stringify(scans()));
    else throw new Error('Expected pull or scan');
  } catch {
    console.error(
      'Corpus command failed; details suppressed to protect dev data. Check dev Doppler credentials, connectivity and cache permissions.'
    );
    process.exitCode = 1;
  }
}
