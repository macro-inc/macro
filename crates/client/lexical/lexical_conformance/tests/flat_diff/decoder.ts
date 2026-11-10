/** Strict independent consumer of S1 §11.3's u32/UTF-8 ABI. */
export function decodeDiff(words: readonly number[], strings: Uint8Array) {
  let position = 0;
  const word = () => {
    const value = words[position++];
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error('invalid or missing u32');
    }
    return value;
  };
  const text = () => {
    const offset = word();
    const length = word();
    if (offset + length > strings.length) throw new Error('string range');
    return new TextDecoder('utf-8', { fatal: true }).decode(strings.subarray(offset, offset + length));
  };
  const json = (state = false) => {
    const encoded = text();
    if (encoded === '') return state ? null : {};
    const value: unknown = JSON.parse(encoded);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('props object');
    return value;
  };
  const enumeration = (maximum: number) => {
    const value = word();
    if (value > maximum) throw new Error('enum range');
    return value;
  };
  const boolean = () => enumeration(1) === 1;
  const textFields = () => ({ format: word(), mode: enumeration(2), detail: word() });
  const elementFields = () => ({
    format: enumeration(6), indent: word(), direction: enumeration(2), textFormat: word(),
    style: text(), textStyle: text(),
  });
  const formatVersion = word();
  if (formatVersion !== 1) throw new Error('version');
  const generation = word();
  const flags = word();
  if (flags > 1) throw new Error('reserved flags');
  const viewTextMatchesWord = word();
  const opCount = word();
  const ops = [];
  for (let i = 0; i < opCount; i++) {
    const opcode = word();
    switch (opcode) {
      case 1: ops.push({ opcode, key: word(), subtreeRoot: boolean() }); break;
      case 2: ops.push({ opcode, key: word(), type: word(), ...elementFields(), props: json() }); break;
      case 3: {
        const key = word();
        const type = word();
        const fields = textFields();
        ops.push({ opcode, key, type, ...fields, text: text(), style: text(), props: json() });
        break;
      }
      case 4: ops.push({ opcode, key: word(), type: word(), props: json() }); break;
      case 5: ops.push({ opcode, key: word(), type: word() }); break;
      case 6: {
        const parent = word();
        const count = word();
        if (count > words.length - position) throw new Error('children count');
        const children = [];
        for (let j = 0; j < count; j++) children.push(word());
        ops.push({ opcode, parent, children });
        break;
      }
      case 7: ops.push({ opcode, key: word(), text: text() }); break;
      case 8: ops.push({ opcode, key: word(), ...textFields(), style: text() }); break;
      case 9: ops.push({ opcode, key: word(), ...elementFields() }); break;
      case 10: ops.push({ opcode, key: word(), props: json() }); break;
      case 11: ops.push({ opcode, key: word(), state: json(true) }); break;
      case 12: ops.push({ opcode, key: word(), revisionLo: word(), revisionHi: word() }); break;
      default: throw new Error('unknown opcode');
    }
  }
  if (position !== words.length) throw new Error('trailing words');
  return { formatVersion, generation, fullReconcile: flags === 1,
    viewTextMatches: viewTextMatchesWord === 0xffffffff ? null : viewTextMatchesWord, ops };
}
if (import.meta.main) {
  const input: { words: number[]; strings: number[] } = JSON.parse(await Bun.stdin.text());
  try {
    process.stdout.write(JSON.stringify({ ok: true, value: decodeDiff(input.words, new Uint8Array(input.strings)) }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
}
