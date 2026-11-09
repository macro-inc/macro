//! Explicit native inputs; policy remains inside DocumentSession.
use crate::*;
/// Shared policy defaults for native host configuration, without copied constants.
#[derive(uniffi::Record)]
pub struct FfiSyncDefaults {
    /// Shared operation deadlines.
    pub timeouts: Timeouts,
    /// Shared connection heartbeat policy.
    pub heartbeat: HeartbeatPolicy,
    /// Shared reconnect policy.
    pub backoff: BackoffPolicy,
    /// Shared convergence policy.
    pub converge: ConvergePolicy,
    /// Shared WAL scheduling and retention policy.
    pub wal: WalPolicy,
    /// Shared recovery budget.
    pub reset_budget: ResetBudget,
}

/// Read policy defaults from the shared core before supplying surface-specific settings.
#[uniffi::export]
pub fn sync_defaults() -> FfiSyncDefaults {
    FfiSyncDefaults {
        timeouts: Timeouts::default(),
        heartbeat: HeartbeatPolicy::default(),
        backoff: BackoffPolicy::default(),
        converge: ConvergePolicy::default(),
        wal: WalPolicy::default(),
        reset_budget: ResetBudget::default(),
    }
}

/// Host configuration; all sync policy fields are inherited from SyncConfig.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiSessionConfig {
    /// Sync lifecycle, identity, capabilities and policy.
    pub sync: SyncConfig,
    /// Fresh CRDT identities, initial peer first.
    pub peers: Vec<u64>,
    /// Reserved peer namespace.
    pub peer_range: PeerRange,
    /// Native device operating system.
    pub os: ViewOs,
    /// Headless editor mode for non-view native integrations.
    pub headless: bool,
    /// Application surface registry; absent selects portable core and rich nodes.
    pub application: Option<FfiApplicationConfig>,
    /// Generic containers whose changes the host observes.
    pub observed: Vec<ContainerPath>,
}
/// Application policy selected by the actual editing surface.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiApplicationConfig {
    /// Registry and behavior preset; shared with browser surfaces.
    pub editor_type: FfiEditorType,
    /// Optional app hostname for external document-link exports.
    pub hostname: Option<String>,
}
/// Application editor presets from the shared model.
pub type FfiEditorType = macro_document_model::EditorType;
#[uniffi::remote(Enum)]
enum FfiEditorType {
    PlainText,
    Title,
    Markdown,
    MarkdownSync,
    Chat,
    Calendar,
}
/// Typed native editing commands; extension plugin payloads remain application-owned.
#[derive(Clone, Debug, uniffi::Enum)]
pub enum FfiCommand {
    /// Insert literal text.
    InsertText {
        /// Text to insert.
        text: String,
    },
    /// Remove the active selection.
    RemoveText,
    /// Insert a paragraph boundary.
    InsertParagraph,
    /// Insert a line break.
    InsertLineBreak {
        /// Select after insertion.
        select_start: bool,
    },
    /// Insert a tab.
    InsertTab,
    /// Increase indentation.
    Indent,
    /// Decrease indentation.
    Outdent,
    /// Toggle text formatting.
    FormatText {
        /// Format to toggle.
        format: TextFormatType,
    },
    /// Set block alignment.
    FormatElement {
        /// Alignment.
        format: ElementFormat,
    },
    /// Select all content.
    SelectAll,
    /// Clear document content.
    ClearEditor,
    /// Clear local undo history.
    ClearHistory,
    /// Collaborative undo.
    Undo,
    /// Collaborative redo.
    Redo,
    /// Delete a character using explicit native layout resolution.
    DeleteCharacter {
        /// Edit direction.
        direction: EditDirection,
        /// Native layout answer.
        target: ModifyTarget,
    },
    /// Delete a word using explicit native layout resolution.
    DeleteWord {
        /// Edit direction.
        direction: EditDirection,
        /// Native layout answer.
        target: ModifyTarget,
        /// Character fallback answer.
        character_target: ModifyTarget,
    },
    /// Delete a visual line using explicit native layout resolution.
    DeleteLine {
        /// Edit direction.
        direction: EditDirection,
        /// Native layout answer.
        target: ModifyTarget,
        /// Character fallback answer.
        character_target: ModifyTarget,
    },
}
impl From<FfiCommand> for Command {
    fn from(v: FfiCommand) -> Self {
        match v {
            FfiCommand::InsertText { text } => Self::InsertText(text),
            FfiCommand::RemoveText => Self::RemoveText,
            FfiCommand::InsertParagraph => Self::InsertParagraph,
            FfiCommand::InsertLineBreak { select_start } => Self::InsertLineBreak { select_start },
            FfiCommand::InsertTab => Self::InsertTab,
            FfiCommand::Indent => Self::IndentContent,
            FfiCommand::Outdent => Self::OutdentContent,
            FfiCommand::FormatText { format } => Self::FormatText(format),
            FfiCommand::FormatElement { format } => Self::FormatElement(format),
            FfiCommand::SelectAll => Self::SelectAll(None),
            FfiCommand::ClearEditor => Self::ClearEditor,
            FfiCommand::ClearHistory => Self::ClearHistory,
            FfiCommand::Undo => Self::Undo,
            FfiCommand::Redo => Self::Redo,
            FfiCommand::DeleteCharacter { direction, target } => {
                Self::DeleteCharacter { direction, target }
            }
            FfiCommand::DeleteWord {
                direction,
                target,
                character_target,
            } => Self::DeleteWord {
                direction,
                target,
                character_target,
            },
            FfiCommand::DeleteLine {
                direction,
                target,
                character_target,
            } => Self::DeleteLine {
                direction,
                target,
                character_target,
            },
        }
    }
}
/// Shared application clipboard facts, generated for native hosts.
pub type FfiPasteFacts = macro_document_model::plugins_group_b::PasteFacts;
#[uniffi::remote(Record)]
struct FfiPasteFacts {
    request: u32,
    plain_only: bool,
    has_file_entries: bool,
    mobile_image_recovery: bool,
}

/// Encode the shared paste facts without native mirrors of its wire format.
#[uniffi::export]
pub fn clipboard_paste_facts(facts: FfiPasteFacts) -> Result<FfiClipboardEntry, FfiSessionError> {
    Ok(FfiClipboardEntry {
        mime: macro_document_model::plugins_group_b::PASTE_FACTS_MIME.to_owned(),
        text: serde_json::to_string(&facts).map_err(invalid)?,
    })
}

/// Clipboard entries retain source MIME order.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiClipboardEntry {
    /// MIME type.
    pub mime: String,
    /// MIME text data.
    pub text: String,
}
/// Native clipboard data read by the host before admitting paste.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiClipboardPayload {
    /// Ordered MIME entries.
    pub data: Vec<FfiClipboardEntry>,
    /// Whether the clipboard includes files.
    pub has_files: bool,
    /// Optional host-imported HTML nodes.
    pub html_nodes: Option<Vec<SerializedNode>>,
}
/// A correlated storage completion; no I/O runs while the session lock is held.
#[derive(Debug, uniffi::Enum)]
pub enum FfiStorageResult {
    /// Load completed successfully.
    Loaded {
        /// Local snapshot, orphan and assist rows.
        state: LocalState,
    },
    /// Write completed durably.
    Done,
    /// Atomic adoption completed.
    Adopted {
        /// Number of adopted rows.
        count: u32,
    },
    /// Load failed.
    LoadFailed {
        /// Stable failure classification.
        error: StorageFailure,
    },
    /// Write failed.
    WriteFailed {
        /// Stable failure classification.
        error: StorageFailure,
    },
    /// Adoption failed.
    AdoptFailed {
        /// Stable failure classification.
        error: StorageFailure,
    },
}
/// One admitted view, document or host input.
#[derive(uniffi::Enum)]
pub enum FfiInput {
    /// Start loading and connecting.
    Start,
    /// Offer an initial snapshot.
    Seed {
        /// Snapshot origin.
        kind: SeedKind,
        /// Native Loro bytes.
        snapshot: Vec<u8>,
    },
    /// Install a serialized native model tree.
    SetState {
        /// Root node with children and properties.
        root: SerializedNode,
    },
    /// Native view already applied one UTF-16 text splice.
    TextDeltaFromView {
        /// Validated by the shared model before any selection write.
        delta: ViewTextDelta,
    },
    /// Native view already displays this text.
    TextFromView {
        /// Changed node identity, including generation.
        key: NodeKey,
        /// Displayed text.
        text: String,
        /// Optional UTF-16 anchor in the text node.
        anchor: Option<Utf16Offset>,
        /// Optional UTF-16 focus in the text node.
        focus: Option<Utf16Offset>,
        /// Composition ended.
        composition_end: bool,
        /// Final composition data.
        composition_data: Option<String>,
        /// Host-resolved selection.
        selection: ViewSelection,
    },
    /// Install resolved selection.
    SelectionFromView {
        /// Host selection.
        selection: ViewSelection,
        /// Host facts used to preserve typing format and native delete restoration.
        change: Option<SelectionChangeContext>,
    },
    /// Execute a model command with explicit native selection.
    Command {
        /// Requested command.
        command: FfiCommand,
        /// Resolved selection.
        selection: ViewSelection,
    },
    /// Composition start/end.
    Composition {
        /// Native composition facts.
        event: CompositionEvent,
        /// Resolved selection.
        selection: ViewSelection,
    },
    /// Keyboard event and optional default command.
    KeyDown {
        /// Native key facts.
        event: KeyEvent,
        /// View-computed command.
        routed: Option<FfiCommand>,
        /// Prevent platform default action.
        prevent_default: bool,
        /// Resolved selection.
        selection: ViewSelection,
    },
    /// Paste data already read by the host.
    Paste {
        /// Clipboard data.
        payload: FfiClipboardPayload,
        /// Resolved selection.
        selection: ViewSelection,
    },
    /// Undo collaborative edits.
    Undo,
    /// Redo collaborative edits.
    Redo,
    /// Apply one atomic generic operation batch.
    Doc {
        /// Validated native operations.
        operations: Vec<DocOp>,
    },
    /// Physical socket event.
    Socket {
        /// Connection generation.
        conn: ConnId,
        /// Open, frame, text or close event.
        event: SocketEvent,
    },
    /// Token fetch completion.
    Token {
        /// Attempt correlation.
        attempt: u32,
        /// Permission token or fetch failure.
        token: Option<String>,
        /// Unverified write capability for local gating.
        access: WriteAccess,
    },
    /// Durable storage completion.
    Storage {
        /// Operation correlation.
        op: StorageOpId,
        /// Durable result.
        result: FfiStorageResult,
    },
    /// Network or lifecycle signal.
    Host {
        /// Native lifecycle event.
        signal: HostSignal,
    },
    /// Current account and capabilities.
    Authorization {
        /// Verified host capabilities.
        state: AuthorizationState,
    },
    /// Publish or remove a comment mark through the native fresh-peer path.
    Comment {
        /// Mark and request correlation.
        mark: CommentMarkRequest,
    },
    /// Flush with request correlation.
    Flush {
        /// Request correlation.
        request: RequestId,
    },
    /// Graceful terminal stop.
    Stop {
        /// Request correlation.
        request: RequestId,
    },
    /// Reset through the shared recovery policy.
    Reset,
    /// Request server-current snapshot.
    RequestSnapshot {
        /// Request correlation.
        request: RequestId,
    },
    /// Native view focus changed.
    Focus {
        /// Whether focused.
        focused: bool,
    },
    /// Refill the host-owned identity supply.
    AddPeerIds {
        /// Fresh never-reused ids.
        ids: Vec<u64>,
    },
    /// The host's single deadline fired.
    Tick,
}
impl FfiInput {
    pub(crate) fn native(self) -> SessionInput {
        let sync = match self {
            Self::Start => SyncInput::Start,
            Self::Seed { kind, snapshot } => SyncInput::Seed { kind, snapshot },
            Self::SetState { root } => {
                return SessionInput::Editor(Input::SetState {
                    state: SerializedEditorState { root },
                    tags: TagSet::default(),
                });
            }
            Self::TextDeltaFromView { delta } => {
                return SessionInput::Editor(Input::TextDeltaFromView(delta));
            }
            Self::TextFromView {
                key,
                text,
                anchor,
                focus,
                composition_end,
                composition_data,
                selection,
            } => {
                return SessionInput::Editor(Input::TextFromView {
                    key,
                    text,
                    anchor,
                    focus,
                    composition_end,
                    composition_data,
                    selection,
                });
            }
            Self::SelectionFromView { selection, change } => {
                return SessionInput::Editor(Input::SelectionFromView { selection, change });
            }
            Self::Command { command, selection } => {
                return SessionInput::Editor(Input::Command {
                    command: command.into(),
                    selection,
                });
            }
            Self::Composition { event, selection } => {
                return SessionInput::Editor(Input::Composition { event, selection });
            }
            Self::KeyDown {
                event,
                routed,
                prevent_default,
                selection,
            } => {
                return SessionInput::Editor(Input::KeyDown {
                    event,
                    routed: routed.map(Into::into),
                    routed_prevent_default: prevent_default,
                    selection,
                });
            }
            Self::Paste { payload, selection } => {
                return SessionInput::Editor(Input::Command {
                    command: Command::Paste(ClipboardPayload {
                        data: payload.data.into_iter().map(|e| (e.mime, e.text)).collect(),
                        has_files: payload.has_files,
                        html_nodes: payload.html_nodes,
                    }),
                    selection,
                });
            }
            Self::Undo => return SessionInput::Editor(Input::Undo),
            Self::Redo => return SessionInput::Editor(Input::Redo),
            Self::Doc { operations } => return SessionInput::Doc(operations),
            Self::Socket { conn, event } => SyncInput::Socket { conn, event },
            Self::Token {
                attempt,
                token,
                access,
            } => SyncInput::Token(match token {
                Some(token) => TokenEvent::Fetched {
                    attempt,
                    token: SyncToken::new(token),
                    access,
                },
                None => TokenEvent::Failed { attempt },
            }),
            Self::Storage { op, result } => SyncInput::Storage(match result {
                FfiStorageResult::Loaded { state } => StorageEvent::Loaded {
                    id: op,
                    result: Ok(state),
                },
                FfiStorageResult::Done => StorageEvent::Done {
                    id: op,
                    result: Ok(()),
                },
                FfiStorageResult::Adopted { count } => StorageEvent::Adopted {
                    id: op,
                    result: Ok(count),
                },
                FfiStorageResult::LoadFailed { error } => StorageEvent::Loaded {
                    id: op,
                    result: Err(error),
                },
                FfiStorageResult::WriteFailed { error } => StorageEvent::Done {
                    id: op,
                    result: Err(error),
                },
                FfiStorageResult::AdoptFailed { error } => StorageEvent::Adopted {
                    id: op,
                    result: Err(error),
                },
            }),
            Self::Host { signal } => SyncInput::Host(signal),
            Self::Authorization { state } => SyncInput::Authorization(state),
            Self::Comment { mark } => return SessionInput::Comment(mark),
            Self::Flush { request } => SyncInput::Flush(request),
            Self::Stop { request } => SyncInput::Stop(request),
            Self::Reset => SyncInput::Reset,
            Self::RequestSnapshot { request } => SyncInput::RequestSnapshot(request),
            Self::Focus { focused } => return SessionInput::Focus(focused),
            Self::AddPeerIds { ids } => return SessionInput::AddPeerIds(ids),
            Self::Tick => SyncInput::Tick,
        };
        SessionInput::Sync(sync)
    }
}
