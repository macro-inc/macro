//! One host input, ordered view effects and I/O instructions.
use crate::*;
use doc_sync_core::*;
use loro::{ExportMode, Frontiers, LoroDoc, VersionVector};
use std::collections::BTreeMap;

/// Host configuration, including a supply of fresh CRDT identities.
pub struct SessionConfig {
    /// Synchronization policy and authorization.
    pub sync: SyncConfig,
    /// At least three fresh identities, initial peer first.
    pub peer_ids: Vec<u64>,
    /// Permitted identity range.
    pub peer_range: PeerRange,
    /// Surface-specific behavior.
    pub surface: SurfaceConfig,
}
/// Surface selection at construction.
pub enum SurfaceConfig {
    /// Rich-text editor.
    Editor(EditorConfig),
    /// Generic collaborative containers.
    Generic(GenericConfig),
}
/// One input; transport, storage and timer completions return through Sync.
pub enum SessionInput {
    /// Sync state-machine input.
    Sync(SyncInput),
    /// Editor event or command.
    Editor(lexical_model::Input),
    /// Host focus changes preserve the logical model selection.
    Focus(bool),
    /// Atomic generic operation batch.
    Doc(Vec<DocOp>),
    /// Publish an annotation through a fresh, isolated peer.
    Comment(CommentMarkRequest),
    /// Refill the host-owned identity supply.
    AddPeerIds(Vec<u64>),
}
/// Ordered effects from the last handle call.
#[derive(Default)]
pub struct SessionOutput {
    /// Development-only observations of actual sync events, including nested calls.
    #[cfg(feature = "conformance")]
    pub sync_events: Vec<SyncEvent>,
    /// Development-only actual import results, before model recovery.
    #[cfg(feature = "conformance")]
    pub imports: Vec<(String, bool, Option<String>)>,
    /// View and correlated host replies.
    pub view: Vec<ViewEffect>,
    /// I/O instructions executed by the host.
    pub io: Vec<IoEffect>,
    /// Host must schedule its single timer at this deadline.
    pub wake_at: Option<Millis>,
    /// Fewer than two unused identities remain.
    pub need_peer_ids: bool,
}
/// Initial paint after the winning seed or a reset.
pub enum InitialView {
    /// Full editor state and view patch from empty.
    Editor {
        /// Full view patch.
        diff: lexical_model::Diff,
        /// Serialized model snapshot for host initialization.
        state: lexical_model::SerializedEditorState,
    },
    /// Observed generic containers that currently exist.
    Generic(Vec<(ContainerPath, DocValue)>),
}
/// Non-I/O effect delivered in the same call as its triggering input.
pub enum ViewEffect {
    /// First paint or replacement.
    Initialize(InitialView),
    /// Incremental editor view patch.
    Diff(lexical_model::Diff),
    /// Host editor effect.
    Editor(lexical_model::Effect),
    /// Native changes in observed generic containers.
    DocChanged(Vec<DocEvent>),
    /// Remote peer presence.
    Presence(Vec<PeerPresence>),
    /// Connection and durability state.
    Status(SyncStatus),
    /// Correlated request completion.
    Reply {
        /// Request correlation key.
        request: RequestId,
        /// Completion payload.
        reply: Reply,
    },
    /// Input or initialization failure.
    Error(SessionError),
}

pub(crate) mod sealed {
    pub trait Sealed {}
}
/// Sealed surface contract; hosts use EditorSurface or GenericSurface.
#[allow(private_bounds)]
pub trait Surface: sealed::Sealed {
    #[doc(hidden)]
    fn construct(config: SurfaceConfig, peer: u64, now: Now) -> Result<Self, SessionError>
    where
        Self: Sized;
    #[doc(hidden)]
    fn init(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError>;
    #[doc(hidden)]
    fn remote(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError>;
    #[doc(hidden)]
    fn local(
        &mut self,
        doc: &LoroDoc,
        input: SessionInput,
        now: Now,
        access: Access,
        ready: bool,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError>;
    #[doc(hidden)]
    fn presence(&self, _doc: &LoroDoc) -> Option<loro::LoroValue> {
        None
    }
    #[doc(hidden)]
    fn set_focus(&mut self, _focused: bool) -> Result<(), SessionError> {
        Err(SessionError::WrongSurface)
    }
    #[doc(hidden)]
    fn supports_comments(&self) -> bool {
        false
    }
    #[doc(hidden)]
    fn comment_already_placed(&self, _request: &CommentMarkRequest) -> bool {
        false
    }
    #[doc(hidden)]
    fn stage_comment(
        &self,
        _doc: &LoroDoc,
        _request: &CommentMarkRequest,
        _peer: u64,
        _now: Now,
    ) -> Result<Vec<u8>, CommentRefusal> {
        Err(CommentRefusal::StagingFailed)
    }
    #[doc(hidden)]
    fn drop_binding(&mut self);
    #[doc(hidden)]
    fn take_resynced(&mut self) -> bool {
        false
    }
}

/// Sans-I/O document composition. All mutation enters through handle.
pub struct DocumentSession<S: Surface> {
    doc: LoroDoc,
    surface: S,
    sync: SyncCore,
    access: Access,
    ready: bool,
    out: SessionOutput,
    sync_out: SyncOutput,
    comments: BTreeMap<RequestId, CommentMarkRequest>,
}
impl<S: Surface> DocumentSession<S> {
    /// Construct an unstarted session. Deliver Sync(Start), then a seed or storage result.
    pub fn new(config: SessionConfig, now: Now) -> Result<Self, SessionError> {
        let _span = tracing::info_span!("session.create", document.id = %config.sync.doc).entered();
        if config.peer_ids.len() < 3 {
            return Err(SessionError::Configuration(
                "at least three peer ids required",
            ));
        }
        let peer = config.peer_ids[0];
        let mut validation = PeerSupply::new(config.peer_range);
        validation.register(peer)?;
        validation.extend(config.peer_ids.iter().skip(1).copied())?;
        let mut peers = PeerSupply::new(config.peer_range);
        peers.extend(config.peer_ids.into_iter().skip(1))?;
        let doc = lexical_loro::new_doc(peer)?;
        let surface = S::construct(config.surface, peer, now)?;
        let access = config.sync.access;
        let sync = SyncCore::with_peer_supply(config.sync, now, peers)?;
        Ok(Self {
            doc,
            surface,
            sync,
            access,
            ready: false,
            out: SessionOutput::default(),
            sync_out: SyncOutput::default(),
            comments: BTreeMap::new(),
        })
    }
    /// Immutable surface queries; never performs I/O.
    pub fn surface(&self) -> &S {
        &self.surface
    }
    /// Current peer, including a fresh peer after replacement.
    pub fn peer_id(&self) -> u64 {
        self.doc.peer_id()
    }
    /// Current version for diagnostics and deterministic host tests.
    pub fn version(&self) -> VersionVector {
        self.doc.oplog_vv()
    }
    /// Process exactly one host input and return effects borrowing reused buffers.
    pub fn handle(&mut self, now: Now, input: SessionInput) -> &SessionOutput {
        self.out.view.clear();
        #[cfg(feature = "conformance")]
        {
            self.out.sync_events.clear();
            self.out.imports.clear();
        }
        self.out.io.clear();
        let result = match input {
            SessionInput::Sync(input) => {
                self.sync_input(now, input);
                Ok(())
            }
            SessionInput::AddPeerIds(peers) => {
                if peers.contains(&self.doc.peer_id()) {
                    Err(SyncError::PeerReused.into())
                } else {
                    self.sync.add_peer_ids(peers).map_err(SessionError::from)
                }
            }
            SessionInput::Comment(_) if !self.surface.supports_comments() => {
                Err(SessionError::WrongSurface)
            }
            SessionInput::Focus(focused) => self.surface.set_focus(focused),
            SessionInput::Comment(request) if self.sync.phase() == Phase::Stopped => {
                self.out.view.push(ViewEffect::Reply {
                    request: request.request,
                    reply: Reply::Comment(CommentReply::Refused(CommentRefusal::StagingFailed)),
                });
                Err(SessionError::NotReady)
            }
            SessionInput::Comment(request) => {
                let id = request.request;
                if let std::collections::btree_map::Entry::Vacant(e) = self.comments.entry(id) {
                    e.insert(request);
                    self.sync_input(now, SyncInput::PrepareComment(id));
                    Ok(())
                } else {
                    Err(SessionError::Configuration(
                        "comment request already pending",
                    ))
                }
            }
            _ if self.sync.phase() == Phase::Stopped => Err(SessionError::NotReady),
            input => {
                let before = self.doc.oplog_vv();
                match self.surface.local(
                    &self.doc,
                    input,
                    now,
                    self.access,
                    self.ready && self.sync.phase() == Phase::Running,
                    &mut self.out.view,
                ) {
                    Ok(changed) => {
                        if changed || self.doc.oplog_vv() != before {
                            self.sync_input(now, SyncInput::LocalChanged);
                        }
                        self.sync_input(
                            now,
                            SyncInput::SetPresence(self.surface.presence(&self.doc)),
                        );
                        Ok(())
                    }
                    Err(error) => Err(error),
                }
            }
        };
        if let Err(error) = result {
            self.out.view.push(ViewEffect::Error(error));
        }
        if self.surface.take_resynced() {
            self.sync_input(now, SyncInput::ProjectionResynced);
        }
        self.out.need_peer_ids = self.sync.needs_peer_ids();
        &self.out
    }
    fn sync_input(&mut self, now: Now, input: SyncInput) {
        let peer = self.doc.peer_id();
        let before = self.doc.oplog_vv().get(&peer).copied().unwrap_or(0);
        let local_signal = matches!(input, SyncInput::LocalChanged | SyncInput::SetPresence(_));
        let mut doc = Adapter {
            doc: &mut self.doc,
            surface: &mut self.surface,
            now,
            access: self.access,
            ready: self.ready,
            view: &mut self.out.view,
            #[cfg(feature = "conformance")]
            imports: &mut self.out.imports,
        };
        self.sync.handle(now, &mut doc, input, &mut self.sync_out);
        self.out.io.append(&mut self.sync_out.io);
        self.out.wake_at = self.sync_out.wake_at;
        let events = std::mem::take(&mut self.sync_out.events);
        #[cfg(feature = "conformance")]
        self.out.sync_events.extend(events.iter().cloned());
        for event in events {
            match event {
                SyncEvent::Status(status) => self.out.view.push(ViewEffect::Status(status)),
                SyncEvent::Presence(peers) => self.out.view.push(ViewEffect::Presence(peers)),
                SyncEvent::AccessChanged(access) => self.access = access,
                SyncEvent::Reply { request, reply } => {
                    self.comments.remove(&request);
                    self.out.view.push(ViewEffect::Reply { request, reply });
                }
                SyncEvent::Seeded { .. } | SyncEvent::Replaced => {
                    match self
                        .surface
                        .init(&self.doc, now, self.access, &mut self.out.view)
                    {
                        Ok(()) => {
                            self.ready = true;
                            self.sync_input(now, SyncInput::Ready);
                        }
                        Err(error) => {
                            self.ready = false;
                            self.out.view.push(ViewEffect::Error(error));
                        }
                    }
                }
                SyncEvent::CommentReady { request } => {
                    let Some(comment) = self.comments.remove(&request) else {
                        continue;
                    };
                    if self.surface.comment_already_placed(&comment) {
                        self.out.view.push(ViewEffect::Reply {
                            request,
                            reply: Reply::Comment(CommentReply::Accepted),
                        });
                        continue;
                    }
                    match self.sync.allocate_comment_peer(&mut self.sync_out) {
                        Ok(peer) => {
                            self.out.io.append(&mut self.sync_out.io);
                            match self.surface.stage_comment(&self.doc, &comment, peer, now) {
                                Ok(update) => self
                                    .sync_input(now, SyncInput::PublishComment { request, update }),
                                Err(reason) => self.out.view.push(ViewEffect::Reply {
                                    request,
                                    reply: Reply::Comment(CommentReply::Refused(reason)),
                                }),
                            }
                        }
                        Err(error) => {
                            self.out.view.push(ViewEffect::Error(error.into()));
                            self.out.view.push(ViewEffect::Reply {
                                request,
                                reply: Reply::Comment(CommentReply::Refused(
                                    CommentRefusal::StagingFailed,
                                )),
                            });
                        }
                    }
                }
            }
        }
        let after = self.doc.oplog_vv().get(&peer).copied().unwrap_or(0);
        if !local_signal
            && self.ready
            && self.access == Access::Edit
            && self.doc.peer_id() == peer
            && after > before
        {
            self.sync_input(now, SyncInput::LocalChanged);
        }
    }
}

struct Adapter<'a, S> {
    doc: &'a mut LoroDoc,
    surface: &'a mut S,
    now: Now,
    access: Access,
    ready: bool,
    view: &'a mut Vec<ViewEffect>,
    #[cfg(feature = "conformance")]
    imports: &'a mut Vec<(String, bool, Option<String>)>,
}
fn import(doc: &LoroDoc, bytes: &[u8]) -> Result<Imported, ImportFailure> {
    if bytes.is_empty() {
        return Ok(Imported {
            changed: false,
            pending: false,
            new_ops: false,
        });
    }
    let before = doc.oplog_vv();
    let frontiers = doc.state_frontiers();
    let status = doc
        .import_with(bytes, "from-loro")
        .map_err(|error| match error {
            loro::LoroError::ImportUpdatesThatDependsOnOutdatedVersion => ImportFailure::Outdated,
            error => ImportFailure::Loro(error),
        })?;
    Ok(Imported {
        changed: frontiers != doc.state_frontiers(),
        new_ops: before != doc.oplog_vv(),
        pending: status.pending.is_some(),
    })
}
fn export_error(error: loro::LoroEncodeError) -> ExportFailure {
    ExportFailure::Loro(loro::LoroError::DecodeError(error.to_string().into()))
}
impl<S: Surface> SyncDoc for Adapter<'_, S> {
    fn peer_id(&self) -> u64 {
        self.doc.peer_id()
    }
    fn oplog_vv(&self) -> VersionVector {
        self.doc.oplog_vv()
    }
    fn import_remote(
        &mut self,
        bytes: &[u8],
        origin: ImportOrigin,
    ) -> Result<Imported, ImportFailure> {
        let result = import(self.doc, bytes).and_then(|result| {
            if self.ready && result.changed {
                self.surface
                    .remote(self.doc, self.now, self.access, self.view)
                    .map_err(|error| ImportFailure::Projection(rootcause::report!(error).into()))?;
            }
            Ok(result)
        });
        #[cfg(feature = "conformance")]
        self.imports.push((
            format!("{origin:?}"),
            result.as_ref().is_ok_and(|imported| imported.pending),
            result.as_ref().err().map(ToString::to_string),
        ));
        #[cfg(not(feature = "conformance"))]
        let _ = origin;
        result
    }
    fn export_local(&self, since: &VersionVector) -> Result<Option<Vec<u8>>, ExportFailure> {
        let peer = self.doc.peer_id();
        let end = self.doc.oplog_vv().get(&peer).copied().unwrap_or(0);
        let start = since.get(&peer).copied().unwrap_or(0);
        if start >= end {
            return Ok(None);
        }
        self.doc
            .export(ExportMode::updates_in_range(vec![loro::IdSpan::new(
                peer, start, end,
            )]))
            .map(Some)
            .map_err(export_error)
    }
    fn export_shallow_snapshot(&self, at: &Frontiers) -> Result<Vec<u8>, ExportFailure> {
        self.doc
            .export(ExportMode::shallow_snapshot(at))
            .map_err(export_error)
    }
    fn probe_import(
        &mut self,
        snapshot: &[u8],
        bytes: &[u8],
        new_peer: u64,
    ) -> Result<Imported, ImportFailure> {
        let doc = lexical_loro::new_doc(new_peer)
            .map_err(|error| ImportFailure::Projection(rootcause::report!(error).into()))?;
        let seeded = import(&doc, snapshot)?;
        if seeded.pending {
            return Err(ImportFailure::Projection(rootcause::report!(
                "pending snapshot"
            )));
        }
        import(&doc, bytes)
    }
    fn seed(&mut self, snapshot: &[u8], _: SeedKind) -> Result<(), ImportFailure> {
        if import(self.doc, snapshot)?.pending {
            return Err(ImportFailure::Projection(rootcause::report!(
                "pending seed"
            )));
        }
        Ok(())
    }
    fn replace(&mut self, snapshot: &[u8], new_peer: u64) -> Result<(), ImportFailure> {
        let replacement = lexical_loro::new_doc(new_peer)
            .map_err(|error| ImportFailure::Projection(rootcause::report!(error).into()))?;
        if import(&replacement, snapshot)?.pending {
            return Err(ImportFailure::Projection(rootcause::report!(
                "pending replacement"
            )));
        }
        self.surface.drop_binding();
        *self.doc = replacement;
        self.ready = false;
        Ok(())
    }
}

impl DocumentSession<GenericSurface> {
    /// Synchronously read a generic container's deep value without I/O.
    pub fn read(&self, path: &ContainerPath) -> Result<DocValue, SessionError> {
        self.surface.read(&self.doc, path)
    }
}

#[cfg(feature = "conformance")]
impl<S: Surface> DocumentSession<S> {
    /// Development-only immutable core diagnostics; no mutable document handle escapes.
    #[doc(hidden)]
    pub fn conformance_sync(&self) -> &SyncCore {
        &self.sync
    }
    /// Move actual effects to a deterministic host while retaining the pending timer.
    #[doc(hidden)]
    pub fn conformance_drain_output(&mut self) -> SessionOutput {
        SessionOutput {
            view: std::mem::take(&mut self.out.view),
            io: std::mem::take(&mut self.out.io),
            wake_at: self.out.wake_at,
            need_peer_ids: self.out.need_peer_ids,
            sync_events: std::mem::take(&mut self.out.sync_events),
            imports: std::mem::take(&mut self.out.imports),
        }
    }
    /// Development-only native snapshot for the Tier C relay; never exposes a mutable handle.
    #[doc(hidden)]
    pub fn conformance_snapshot(&self) -> Result<Vec<u8>, loro::LoroEncodeError> {
        self.doc.export(ExportMode::Snapshot)
    }
    /// Development-only incremental update export for the Tier C relay.
    #[doc(hidden)]
    pub fn conformance_updates(
        &self,
        since: &VersionVector,
    ) -> Result<Vec<u8>, loro::LoroEncodeError> {
        self.doc.export(ExportMode::updates(since))
    }
    /// Development-only deep value for strict native/TypeScript comparison.
    #[doc(hidden)]
    pub fn conformance_value(&self) -> loro::LoroValue {
        self.doc.get_deep_value()
    }
}

#[cfg(test)]
impl DocumentSession<EditorSurface> {
    pub(crate) fn fail_next_projection(&mut self) {
        self.surface.fail_next_remote = true;
    }
    pub(crate) fn assert_projection_consistent(&self) {
        self.surface
            .projection
            .as_ref()
            .expect("projection")
            .check(&self.doc, self.surface.state())
            .expect("projection matches native doc");
    }
}

#[cfg(feature = "conformance")]
impl DocumentSession<EditorSurface> {
    /// Reconstruct the persisted editor tree independently of the live projection.
    #[doc(hidden)]
    pub fn conformance_reconstructed_state(
        &self,
    ) -> Result<lexical_model::SerializedEditorState, SessionError> {
        Ok(lexical_loro::reconstruct_state(
            &self.doc,
            self.surface.config.policy,
        )?)
    }
}
