import { EditorInputMsg, type ISessionInputMsg } from './abi.generated';
/** Fixed envelope fields; the editor payload itself is a generated discriminated union. */
export function emptyInput(kind: number): ISessionInputMsg {
  return {
    kind,
    request: 0,
    code: 0,
    flag: false,
    bytes: new Uint8Array(),
    peers: [],
    editor: EditorInputMsg.fromEditorSetState({ json: '' }),
    operations: [],
    markId: '',
    anchor: new Uint8Array(),
    focus: new Uint8Array(),
    expectedText: '',
  };
}
