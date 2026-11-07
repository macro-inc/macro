/** Schema 2 is shared with the native and wasm fixture interpreters. */
export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
export type Fields = { [key: string]: Value };
export type Call = {
  fn: string;
  this?: Value;
  args: Value[];
  ret?: Value;
  throws?: { name: string; message: string };
};
export type Op = Fields & { op: string };
export type Invocation = { args: Value[]; calls: Op[]; ret?: Value; throws?: Fields };
export type Tape = { invocations: Invocation[] };
export type Fixture = {
  schema: 2;
  source: { repo: string; version: string; file: string; test: string[]; recordedWith: string };
  tier: 'A-rec';
  partial: boolean;
  covers: string[];
  normalize: string[];
  outcomeDiffers: Value[];
  config: Fields;
  initial: { editorState: null; selection: null };
  trace: Op[];
  tapes: Tape[];
  final: Value;
};

export function fields(value: unknown): Record<string, unknown> {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new Error('Expected an object');
  }
  return value as Record<string, unknown>;
}

export function errorValue(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}
