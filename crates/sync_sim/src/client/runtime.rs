//! Real client ownership: either the lending GenericSurface host or a document session.
use super::application::EditorRuntime;
use super::*;
use document_session::{SessionInput, ViewEffect};
use std::ops::Deref;

pub(crate) enum Runtime {
    Generic { core: Box<SyncCore>, doc: SimDoc },
    Editor(Box<EditorRuntime>),
}
impl Deref for Runtime {
    type Target = SyncCore;
    fn deref(&self) -> &Self::Target {
        match self {
            Self::Generic { core, .. } => core,
            Self::Editor(session) => session.conformance_sync(),
        }
    }
}
pub(crate) struct Handled {
    pub out: SyncOutput,
    pub imports: Vec<(String, bool, Option<String>)>,
    pub errors: Vec<String>,
    pub undo_applied: Vec<document_session::UndoObservation>,
}
impl Runtime {
    pub fn new(
        config: SyncConfig,
        peer: u64,
        supply: Vec<u64>,
        now: Now,
        editor: bool,
        ai: bool,
    ) -> Result<Self, Failure> {
        let range = if ai { PeerRange::Ai } else { PeerRange::User };
        if editor {
            let mut peers = vec![peer];
            peers.extend(supply);
            let mode = if ai {
                lexical_model::EditorMode::Headless
            } else {
                lexical_model::EditorMode::ViewAttached
            };
            EditorRuntime::new(config, peers, range, now, mode)
                .map(|session| Self::Editor(Box::new(session)))
        } else {
            let mut peers = PeerSupply::new(range);
            peers
                .extend(supply)
                .map_err(|error| Failure::new("peer_supply", error))?;
            Ok(Self::Generic {
                core: Box::new(
                    SyncCore::with_peer_supply(config, now, peers)
                        .map_err(|error| Failure::new("client_configuration", error))?,
                ),
                doc: SimDoc::new(peer)?,
            })
        }
    }
    pub fn is_editor(&self) -> bool {
        matches!(self, Self::Editor(_))
    }
    pub fn peer_id(&self) -> u64 {
        match self {
            Self::Generic { doc, .. } => doc.peer_id(),
            Self::Editor(session) => session.peer_id(),
        }
    }
    pub fn version(&self) -> loro::VersionVector {
        match self {
            Self::Generic { doc, .. } => doc.oplog_vv(),
            Self::Editor(session) => session.version(),
        }
    }
    pub fn pending(&self) -> bool {
        match self {
            Self::Generic { doc, .. } => doc.pending,
            Self::Editor(session) => session.conformance_sync().status().pending_import,
        }
    }
    pub fn value(&self) -> Result<serde_json::Value, Failure> {
        use loro::ToJson;
        match self {
            Self::Generic { doc, .. } => doc.value(),
            Self::Editor(session) => serde_json::from_str(&session.conformance_value().to_json())
                .map_err(|error| Failure::new("editor_deep_value", error)),
        }
    }
    pub fn handle(&mut self, input: SyncInput, now: Now) -> Handled {
        match self {
            Self::Generic { core, doc } => {
                let mut out = SyncOutput::default();
                core.handle(now, doc, input, &mut out);
                Handled {
                    out,
                    imports: std::mem::take(&mut doc.imports),
                    errors: vec![],
                    undo_applied: vec![],
                }
            }
            Self::Editor(session) => Self::editor_handle(session, SessionInput::Sync(input), now),
        }
    }
    pub fn editor_handle(session: &mut EditorRuntime, input: SessionInput, now: Now) -> Handled {
        if let Err(error) = session.set_clock(now) {
            return Handled {
                out: SyncOutput::default(),
                imports: vec![],
                errors: vec![error.to_string()],
                undo_applied: vec![],
            };
        }
        session.handle(now, input);
        let output = session.conformance_drain_output();
        Handled {
            out: SyncOutput {
                io: output.io,
                events: output.sync_events,
                wake_at: output.wake_at,
            },
            imports: output.imports,
            undo_applied: output.undo_applied,
            errors: output
                .view
                .into_iter()
                .filter_map(|view| match view {
                    ViewEffect::Error(error) => Some(error.to_string()),
                    _ => None,
                })
                .collect(),
        }
    }
    pub fn add_peers(&mut self, ids: Vec<u64>, now: Now) -> Result<(), Failure> {
        match self {
            Self::Generic { core, .. } => core
                .add_peer_ids(ids)
                .map_err(|error| Failure::new("peer_supply", error)),
            Self::Editor(session) => {
                let output = Self::editor_handle(session, SessionInput::AddPeerIds(ids), now);
                if !output.out.io.is_empty() || !output.out.events.is_empty() {
                    return Err(Failure::new(
                        "peer_supply",
                        "peer supply unexpectedly emitted core work",
                    ));
                }
                if let Some(error) = output.errors.first() {
                    return Err(Failure::new("peer_supply", error));
                }
                Ok(())
            }
        }
    }
}

impl Runtime {
    pub fn edit_generic(&mut self, op: &AbstractOp, fields: u16, wall: i64) -> Result<(), Failure> {
        match self {
            Self::Generic { doc, .. } => doc.edit(op, fields, wall),
            Self::Editor(_) => Err(Failure::new(
                "editor_surface",
                "generic input on an editor document",
            )),
        }
    }
    pub fn presence_selection(&self, generic: Option<u16>) -> Option<loro::LoroValue> {
        match self {
            Self::Generic { .. } => generic.map(loro::LoroValue::from),
            Self::Editor(session) => session
                .surface()
                .selection_cursors()
                .as_ref()
                .map(lexical_loro::encode_selection),
        }
    }
    pub fn editor_final(&self) -> Result<Option<EditorFinal>, Failure> {
        use loro::ToJson;
        let Self::Editor(session) = self else {
            return Ok(None);
        };
        if !session.conformance_ready() {
            return Ok(None);
        }
        let state = session
            .conformance_synced_state()
            .map_err(|error| Failure::new("editor_state", error))?;
        let reconstructed = session
            .conformance_reconstructed_state()
            .map_err(|error| Failure::new("projection_consistent", error))?;
        let selection = self
            .presence_selection(None)
            .map(|value| serde_json::from_str(&value.to_json()))
            .transpose()
            .map_err(|error| Failure::new("editor_selection", error))?;
        Ok(Some(EditorFinal {
            synced_json: serde_json::to_value(state)
                .map_err(|error| Failure::new("editor_state", error))?,
            reconstructed: serde_json::to_value(reconstructed)
                .map_err(|error| Failure::new("projection_consistent", error))?,
            selection,
            can_undo: session.surface().history().can_undo,
            can_redo: session.surface().history().can_redo,
        }))
    }
}
