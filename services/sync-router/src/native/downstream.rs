//! [`DownstreamFactory`] that feeds an in-process [`MachineHost`] instead of
//! dialing a Durable Object. On the DO path the DO validates the permission
//! token; here the router is the remote end, so validation happens in `open`.

#[cfg(test)]
mod test;

use crate::domain::envelope;
use crate::domain::models::{ConnectionId, DocId, Event};
use crate::domain::ports::{DownstreamFactory, EdgeSink};
use crate::native::{Capabilities, MachineHost, Route, machine_conn, wire};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use std::sync::Arc;
use sync_machine::manager::ManagerInput;
use sync_machine::model::DocId as MachineDocId;
use tokio::sync::mpsc;
use tracing::{debug, warn};

/// Mirrors the DO buffer: frames sent while attach is in flight queue here.
const DOWNSTREAM_BUFFER: usize = 256;

/// The document-permission claims minted by document-storage-service. Field
/// names and the lowercase level encoding must match the wasm sync-service's
/// `AuthToken` / `AccessLevel`, which consume the same tokens.
#[derive(Debug, Deserialize)]
struct Claims {
    user_id: Option<String>,
    document_id: String,
    access_level: AccessLevel,
}

/// Ordered access levels, lowercase on the wire (see sync-service
/// `domain/permissions.rs`).
#[derive(Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum AccessLevel {
    View,
    Comment,
    Edit,
    Owner,
    Admin,
}

impl Claims {
    /// The wasm service's rule: `Comment` and above may submit updates.
    fn can_edit(&self) -> bool {
        self.access_level >= AccessLevel::Comment
    }

    /// Token must be scoped to this document (or be an admin token).
    fn authorizes(&self, doc: &DocId) -> bool {
        self.document_id == doc.as_str() || self.access_level == AccessLevel::Admin
    }
}

/// See the module docs.
pub struct NativeDownstreamFactory<Sink: EdgeSink> {
    host: Arc<MachineHost>,
    /// HS256 secret the permission tokens were signed with.
    permissions_secret: String,
    sink: Arc<Sink>,
    events: mpsc::Sender<Event>,
}

impl<Sink: EdgeSink> NativeDownstreamFactory<Sink> {
    /// Bundle the host handle with what `open` needs to answer clients.
    pub fn new(
        host: Arc<MachineHost>,
        permissions_secret: String,
        sink: Arc<Sink>,
        events: mpsc::Sender<Event>,
    ) -> Self {
        Self {
            host,
            permissions_secret,
            sink,
            events,
        }
    }
}

impl<Sink: EdgeSink> DownstreamFactory for NativeDownstreamFactory<Sink> {
    #[tracing::instrument(skip(self, token), fields(document.id = doc.as_str()))]
    fn open(
        &self,
        conn: ConnectionId,
        doc: DocId,
        token: String,
        epoch: u64,
    ) -> mpsc::Sender<Vec<u8>> {
        let (sender, receiver) = mpsc::channel(DOWNSTREAM_BUFFER);
        tokio::spawn(attach_and_pump(
            Arc::clone(&self.host),
            self.permissions_secret.clone(),
            Arc::clone(&self.sink),
            self.events.clone(),
            conn,
            doc,
            token,
            epoch,
            receiver,
        ));
        sender
    }
}

/// Validate, attach, then pump client frames into the machine until the router
/// drops the sender.
#[allow(clippy::too_many_arguments, reason = "one spawn, all route state")]
#[tracing::instrument(skip_all, fields(document.id = doc.as_str(), conn = %conn.conn))]
async fn attach_and_pump<Sink: EdgeSink>(
    host: Arc<MachineHost>,
    permissions_secret: String,
    sink: Arc<Sink>,
    events: mpsc::Sender<Event>,
    conn: ConnectionId,
    doc: DocId,
    token: String,
    epoch: u64,
    mut from_client: mpsc::Receiver<Vec<u8>>,
) {
    let deliver = |frame: Vec<u8>| {
        let sink = Arc::clone(&sink);
        let conn = conn.clone();
        async move {
            sink.deliver(&conn, frame)
                .await
                .map_err(Into::into)
                .inspect_err(|error: &anyhow::Error| {
                    warn!(error = ?error, "failed to deliver to client");
                })
                .ok();
        }
    };

    let refuse = |reason: &'static str| {
        let doc = doc.clone();
        let conn = conn.clone();
        let events = events.clone();
        async move {
            deliver(envelope::subscribe_failed(doc.as_str(), reason)).await;
            events
                .send(Event::DownstreamClosed { conn, doc, epoch })
                .await
                .ok();
        }
    };

    let claims: Claims = match macro_sync_service_jwt::decode(&token, &permissions_secret) {
        Ok(claims) => claims,
        Err(error) => {
            warn!(error = ?error, "permission token rejected");
            refuse("invalid token").await;
            return;
        }
    };
    if !claims.authorizes(&doc) {
        warn!(token_doc = claims.document_id, "token for wrong document");
        refuse("token not valid for document").await;
        return;
    }
    let user_id = claims.user_id.as_deref().and_then(|raw| {
        MacroUserIdStr::try_from(raw.to_string())
            .inspect_err(|error| warn!(error = ?error, "unparseable user id in token"))
            .ok()
    });
    let capabilities = Capabilities {
        can_edit: claims.can_edit(),
        user_id,
    };

    // Route first so the machine's InitialSync (emitted during Attach
    // handling) finds its way back.
    host.routes.insert(
        machine_conn(epoch),
        Route {
            router_conn: conn.clone(),
            doc: doc.clone(),
            epoch,
        },
    );
    deliver(envelope::subscribed(doc.as_str())).await;

    let machine_doc = MachineDocId(doc.as_str().to_string());
    if host
        .inputs
        .send(ManagerInput::Attach {
            conn: machine_conn(epoch),
            doc: machine_doc.clone(),
            capabilities,
        })
        .await
        .is_err()
    {
        warn!("machine host is gone; refusing subscription");
        host.routes.remove(&machine_conn(epoch));
        refuse("sync backend unavailable").await;
        return;
    }
    debug!("native downstream attached");

    while let Some(bytes) = from_client.recv().await {
        // Unparseable frames are dropped, matching the wasm service.
        let Some(frame) = wire::decode_from_peer(&bytes) else {
            debug!("dropping undecodable client frame");
            continue;
        };
        let input = ManagerInput::Frame {
            conn: machine_conn(epoch),
            doc: machine_doc.clone(),
            frame,
        };
        if host.inputs.send(input).await.is_err() {
            warn!("machine host is gone; closing route");
            break;
        }
    }

    // Router dropped the sender (unsubscribe / client disconnect) or the host
    // died: tear down quietly, mirroring the DO pump's `None` branch.
    host.routes.remove(&machine_conn(epoch));
    host.inputs
        .send(ManagerInput::Detach {
            conn: machine_conn(epoch),
            doc: machine_doc,
        })
        .await
        .ok();
    debug!("native downstream detached");
}
