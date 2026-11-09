# Detached editor-state parsing: required native authority

`EditorState.toJSON` uses the bound JS serializer under the state's real owner.
Detached `parseEditorState` is not bound or implemented. Existing readonly
`readState` and ordinary updates cannot provide its required write authority.

The proposed owner-only native port has the semantic operation
`withDetachedWrite(editor, body: () => void): number`. Its result must be a real
retained native version created by that operation, not a caller-authored receipt
object or a version inferred from the current editor. The runtime owner must
agree the generated transport and lifetime protocol before adding a source API.
No interface, binder or positive acknowledgement stand-in is provided here.

The port must:

- Enter a real writable detached state for the exact actual editor, including its
  root, prepared registry and authorized constructors. Keep arbitrary JS callbacks
  and node importJSON hooks in JS.
- Run the existing recursive JS import algorithm and optional parse update callback
  in source order, with real active-editor/read-only scope restoration.
- Return a retained native version only after successful completion. On failure,
  roll back staged node/state identities and ownership and preserve opaque errors.
- Keep the live editor's current/pending state, listeners and update tags unchanged.
  A normal update followed by restoration, or a second editor, does not satisfy this.
- Permit the owner to construct the actual EditorState from that retained version
  with the existing version pin and private owner association. Historical reads
  must resolve that detached graph independently of later live updates.

Before activation, tests must use the actual native capability to show detached
success, historical reads, constructor authorization, callback/error ordering,
rollback and retention. Missing-authority checks alone cannot establish this
contract; no fake positive receipt or guard-only test suite substitutes for it.

The production initial snapshot bootstrap is a separate backend responsibility.
Removing the obsolete EditorState opaque snapshot allocation does not authorize
native detached writes or initialize a production mirror.
