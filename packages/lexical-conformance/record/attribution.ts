/** Attribute by the nearest non-recorder frame, including after asynchronous re-entry. */
export function isTestFrame(stack: string = new Error().stack ?? ''): boolean {
  const frame = stack.split('\n').slice(1).find((line) =>
    !/\/lexical-conformance\/record\/(?!__tests__)/.test(line) &&
    !/node:internal|Error$/.test(line),
  );
  return frame !== undefined && (
    /\/__tests__\//.test(frame) ||
    /\/packages\/lexical-core\/tests\//.test(frame) ||
    /\/services\/lexical-service\/.*(?:\.test\.[tj]s|\/test\/)/.test(frame) ||
    /\/apps\/web\/.*LexicalMarkdown\/.*\.test\.[tj]sx?/.test(frame)
  );
}
