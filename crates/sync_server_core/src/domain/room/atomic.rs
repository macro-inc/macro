//! Atomic document use cases; request parsing and size limits remain in the adapter.
use super::{PortName, Room, RoomError};
use crate::domain::{
    document::{
        self, DocumentAccess, DocumentAttribution, DocumentError, DocumentUpdateEffects,
        DocumentUpdatePort, PreparedUpdate,
    },
    permissions::AuthToken,
    ports::*,
    types::*,
};
use bebop::SliceWrapper;
use sync_protocol::FromRemote;

impl<P: RoomPorts> Room<P> {
    /// Read one coherent full or shallow snapshot and its revision.
    pub async fn read_document(
        &mut self,
        key: &SessionKey,
        access: &DocumentAccess,
        shallow: bool,
    ) -> Result<Option<(Vec<u8>, Vec<u8>)>, RoomError> {
        if !self.exists(key).await? {
            return Ok(None);
        }
        self.load_document().await?;
        let doc = &self.memory.document.as_ref().expect("loaded").loro_doc;
        Ok(Some(if shallow {
            document::shallow_snapshot(access, doc)?
        } else {
            document::snapshot(access, doc)?
        }))
    }
    /// Check authorization and durable existence before reading an HTTP update body.
    pub async fn prepare_document_update(
        &mut self,
        key: &SessionKey,
        access: &DocumentAccess,
    ) -> Result<bool, RoomError> {
        access.require_edit()?;
        self.exists(key).await
    }
    /// Apply a parsed update after its adapter has checked method and body limits.
    pub async fn update_document(
        &mut self,
        key: &SessionKey,
        access: &DocumentAccess,
        claims: AuthToken,
        revision: &[u8],
        update: &[u8],
    ) -> Result<PreparedUpdate, RoomError> {
        self.load_document().await?;
        let is_agent = claims.actor.is_some();
        let author = claims
            .user_id
            .clone()
            .unwrap_or_else(|| SYSTEM_AUTHOR_ID.to_owned());
        let attribution = DocumentAttribution::from_session_claims(
            claims.actor,
            claims.user_id,
            claims.agent_correlation_id,
        )?;
        let document = self
            .memory
            .document
            .as_ref()
            .expect("loaded")
            .loro_doc
            .clone();
        let mut released_pending = false;
        let mut prepared = document::update(
            access,
            &mut AtomicEffects {
                room: self,
                document,
                attribution: attribution.as_ref(),
                store_attribution: is_agent,
                resolved_pending: None,
                fanout_sent: false,
                released_pending: &mut released_pending,
            },
            revision,
            update,
        )
        .await?;
        if released_pending {
            // The validation fork need not retain the live document's pending
            // imports. Report the actual revision after their durable resolution.
            prepared.revision = self
                .memory
                .document
                .as_ref()
                .expect("loaded")
                .loro_doc
                .oplog_vv()
                .encode();
        }
        let writers = document::writing_peers(update)?
            .into_iter()
            .map(PeerId)
            .collect::<Vec<_>>();
        self.ports
            .peers()
            .map_unowned_peers(
                key,
                &author,
                attribution
                    .as_ref()
                    .filter(|_| is_agent)
                    .map(|a| a.actor.as_str()),
                &writers,
            )
            .await
            .map_err(|e| RoomError::port(PortName::Peers, e))?;
        Ok(prepared)
    }
}
struct AtomicEffects<'a, P: RoomPorts> {
    room: &'a mut Room<P>,
    document: loro::LoroDoc,
    attribution: Option<&'a DocumentAttribution>,
    store_attribution: bool,
    resolved_pending: Option<Vec<u8>>,
    fanout_sent: bool,
    released_pending: &'a mut bool,
}
fn notification_error(error: impl std::fmt::Debug) -> DocumentError {
    tracing::error!(error = ?error, "failed to notify document update");
    DocumentError::Notification
}
impl<P: RoomPorts> DocumentUpdateEffects for AtomicEffects<'_, P> {
    fn broadcast(&mut self, update: &[u8]) -> Result<(), DocumentError> {
        let resolved_pending = self.resolved_pending.take();
        self.fanout_sent = resolved_pending.is_some();
        for update in std::iter::once(update).chain(resolved_pending.as_deref()) {
            for socket in self.room.active_sockets() {
                if let Err(error) = self.room.send(
                    &socket,
                    FromRemote::RemoteUpdate {
                        update: SliceWrapper::Raw(update),
                    },
                ) {
                    self.fanout_sent = false;
                    tracing::warn!(error = ?error, "failed to broadcast document update; continuing");
                }
            }
        }
        Ok(())
    }
    fn publish_changed_document(&mut self) -> Result<(), DocumentError> {
        if let Some(editor) = self.attribution {
            self.room.memory.pending_editors.insert(editor.clone());
        }
        let snapshot = self
            .room
            .memory
            .document
            .as_ref()
            .expect("loaded")
            .export_shallow_snapshot()
            .map_err(notification_error)?;
        let editors = std::mem::take(&mut self.room.memory.pending_editors)
            .into_iter()
            .collect();
        let key = self.room.memory.session_key.as_ref().expect("loaded");
        self.room.ports.background().publish(match key.document() {
            Some(document) => DocumentPublication::Snapshot {
                document,
                snapshot,
                editors,
                interaction: Some(InteractionReason::Edited),
            },
            None => DocumentPublication::Noop,
        });
        Ok(())
    }
    async fn keep_alive(&mut self) -> Result<(), DocumentError> {
        if self.fanout_sent {
            self.room
                .complete_fanout()
                .await
                .map_err(notification_error)?;
        }
        self.room.bump_alarm().await.map_err(notification_error)
    }
}
impl<P: RoomPorts> DocumentUpdatePort for AtomicEffects<'_, P> {
    fn document(&self) -> &loro::LoroDoc {
        &self.document
    }
    async fn apply_and_persist(&mut self, update: &[u8]) -> Result<(), DocumentError> {
        self.room
            .apply_update(update, self.attribution.filter(|_| self.store_attribution))
            .await
            .map(|imported| {
                *self.released_pending = imported.resolved_pending.is_some();
                self.resolved_pending = imported.resolved_pending;
            })
            .map_err(|error| {
                tracing::error!(error = ?error, "failed to persist document update");
                DocumentError::Persistence
            })
    }
}
