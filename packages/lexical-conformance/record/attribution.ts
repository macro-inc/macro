/** The nearest JavaScript caller, skipping recorder and native bridge frames. */
export function callerFrame(stack: string = new Error().stack ?? ''): string {
  return (
    stack
      .split('\n')
      .slice(1)
      .find(
        (line) =>
          !/\/lexical-conformance\/record\/(?!__tests__)/.test(line) &&
          !/node:internal|Error$|^\s*at native$|\(native\)/.test(line)
      ) ?? ''
  );
}

/** Attribute by the caller, including after asynchronous re-entry. */
export function isTestFrame(stack?: string): boolean {
  const frame = callerFrame(stack);
  return (
    /\/__tests__\//.test(frame) ||
    /\/packages\/lexical-core\/tests\//.test(frame) ||
    /\/services\/lexical-service\/.*(?:\.test\.[tj]s|\/test\/)/.test(frame) ||
    /\/apps\/web\/.*LexicalMarkdown\/.*\.test\.[tj]sx?/.test(frame)
  );
}

export function isOracleFrame(): boolean {
  return /lexical-upstream\/packages\//.test(callerFrame());
}
