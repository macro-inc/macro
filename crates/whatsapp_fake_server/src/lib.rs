//! A fake WhatsApp server for tests, and fake phones that use it.
//!
//! [`FakeWhatsApp::start`] listens on local ports: a websocket that speaks
//! WhatsApp's multidevice protocol (noise handshake, binary XML, pairing,
//! prekeys, usync, groups, message routing, receipts, offline queues) and a
//! plain-HTTP media host. Real whatsmeow clients connect to
//! [`FakeWhatsApp::websocket_url`] with [`test_signal`] as their Signal
//! implementation.
//!
//! The other people in a conversation are [`FakePhone`]s: in-process
//! primary devices with real libsignal sessions, so what a client sends is
//! really encrypted and really decrypted. Nothing here talks to WhatsApp.

#![deny(missing_docs)]

mod connection;
mod media;
mod phone;
mod signal;
mod stanza;
mod state;
#[cfg(test)]
mod test;

use std::net::SocketAddr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use whatsmeow::WebSocketDialer;
use whatsmeow::signal::SignalError;
use whatsmeow::store::{MemoryStore, StoreError};
use whatsmeow::types::Jid;
use whatsmeow_signal::LibsignalCurveSignatures;

pub use phone::{FakePhone, ReceivedMessage, ReceivedReceipt};
pub use signal::{TestSignal, test_root_key, test_signal};

use crate::phone::PhoneCore;
use crate::signal::ServerIdentity;
use crate::stanza::{children, jid, node, now, random_id, text};
use crate::state::{
    DeviceAddress, DeviceKeys, DeviceKind, DeviceRecord, Group, State, User, device_jid, group_jid,
};

/// How many one-time prekeys a fake phone publishes.
const PHONE_PRE_KEYS: u32 = 200;

/// Why a phone couldn't approve a pairing QR code.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PairError {
    /// The string isn't a WhatsApp pairing link.
    #[error("not a pairing QR code")]
    MalformedQr,
    /// No connection is showing this QR code (expired, or already used).
    #[error("no client is showing this QR code")]
    UnknownQr,
    /// The client answered the pair-success with an error.
    #[error("the client rejected the pairing: {0}")]
    Rejected(String),
    /// The client's device signature didn't verify.
    #[error("the client's device signature is invalid")]
    BadDeviceSignature,
    /// The client didn't answer the pair-success.
    #[error("the client didn't confirm the pairing")]
    NoConfirmation,
}

/// Why a phone couldn't send a message.
#[derive(Debug, thiserror::Error)]
pub enum SendError {
    /// The chat isn't a known user or group.
    #[error("unknown chat")]
    UnknownChat,
    /// The phone's user isn't a member of the group.
    #[error("not a member of the group")]
    NotInGroup,
    /// The server rejected the message with an error code.
    #[error("the server rejected the message: {0}")]
    Rejected(String),
    /// Signal encryption failed.
    #[error("signal: {0}")]
    Signal(#[source] SignalError),
    /// The phone's key store failed.
    #[error("store: {0}")]
    Store(#[source] StoreError),
    /// Uploading an attachment to the media host failed.
    #[error("media upload: {0}")]
    Upload(#[source] whatsmeow::upload::UploadError),
}

impl SendError {
    fn signal(error: SignalError) -> SendError {
        SendError::Signal(error)
    }

    fn store(error: StoreError) -> SendError {
        SendError::Store(error)
    }
}

/// State shared by the listeners, connections and phones.
pub(crate) struct Shared {
    state: Mutex<State>,
    identity: ServerIdentity,
    /// Bumped on every change, so tests can wait for conditions.
    generation: watch::Sender<u64>,
    tasks: TaskTracker,
    cancel: CancellationToken,
}

impl Shared {
    pub(crate) fn lock(&self) -> MutexGuard<'_, State> {
        // Every mutation is a few map operations under the lock; a panic in
        // one leaves the maps usable.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn changed(&self) {
        self.generation.send_modify(|generation| *generation += 1);
    }

    pub(crate) fn media_host(&self) -> String {
        self.lock().media_host.clone()
    }

    /// Waits until `check` returns `Some`, re-checking after every change.
    pub(crate) async fn wait_for<Found>(
        &self,
        timeout: Duration,
        check: impl Fn() -> Option<Found>,
    ) -> Option<Found> {
        let mut changes = self.generation.subscribe();
        let wait = async {
            loop {
                if let Some(found) = check() {
                    return found;
                }
                if changes.changed().await.is_err() {
                    std::future::pending::<()>().await;
                }
            }
        };
        tokio::time::timeout(timeout, wait).await.ok()
    }
}

/// A running fake WhatsApp server. Dropping it stops the listeners and
/// every connection.
pub struct FakeWhatsApp {
    shared: Arc<Shared>,
    websocket_address: SocketAddr,
}

impl Drop for FakeWhatsApp {
    fn drop(&mut self) {
        self.shared.cancel.cancel();
    }
}

impl FakeWhatsApp {
    /// Starts the server on random local ports.
    pub async fn start() -> std::io::Result<FakeWhatsApp> {
        let websocket_listener = TcpListener::bind("127.0.0.1:0").await?;
        let media_listener = TcpListener::bind("127.0.0.1:0").await?;
        let websocket_address = websocket_listener.local_addr()?;
        let media_address = media_listener.local_addr()?;
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                media_host: media_address.to_string(),
                ..State::default()
            }),
            identity: ServerIdentity::generate(),
            generation: watch::Sender::new(0),
            tasks: TaskTracker::new(),
            cancel: CancellationToken::new(),
        });

        let accepting = Arc::clone(&shared);
        shared.tasks.spawn(async move {
            loop {
                let accepted = tokio::select! {
                    () = accepting.cancel.cancelled() => return,
                    accepted = websocket_listener.accept() => accepted,
                };
                let Ok((tcp, _)) = accepted else {
                    continue;
                };
                let connection = Arc::clone(&accepting);
                let cancel = accepting.cancel.clone();
                accepting.tasks.spawn(async move {
                    tokio::select! {
                        () = cancel.cancelled() => {}
                        () = connection::serve(connection.clone(), tcp) => {}
                    }
                });
            }
        });

        let media = media::router(Arc::clone(&shared));
        let cancel = shared.cancel.clone();
        shared.tasks.spawn(async move {
            let served = axum::serve(media_listener, media)
                .with_graceful_shutdown(async move { cancel.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::warn!(error = %error, "fake media server stopped");
            }
        });

        Ok(FakeWhatsApp {
            shared,
            websocket_address,
        })
    }

    /// The websocket URL to dial instead of `wss://web.whatsapp.com/ws/chat`.
    pub fn websocket_url(&self) -> String {
        format!("ws://{}/ws/chat", self.websocket_address)
    }

    /// A dialer for [`whatsmeow::ClientConfig::dialer`].
    pub fn dialer(&self) -> Arc<WebSocketDialer> {
        Arc::new(WebSocketDialer {
            url: self.websocket_url(),
        })
    }

    /// `host:port` of the plain-HTTP media host the server hands out in
    /// media connections.
    pub fn media_host(&self) -> String {
        self.shared.media_host()
    }

    /// The base URL of the media host, for [`whatsmeow::ClientConfig::media_base_url`].
    pub fn media_base_url(&self) -> String {
        format!("http://{}", self.media_host())
    }

    /// Adds a user with a phone (device 0) that publishes prekeys, and
    /// returns the phone.
    pub async fn add_user(&self, phone: &str, push_name: &str) -> FakePhone {
        let store = Arc::new(MemoryStore::default());
        let signatures = LibsignalCurveSignatures::new();
        let device = store.new_device(&signatures);
        let pre_keys = match device.pre_keys.get_or_gen_pre_keys(PHONE_PRE_KEYS).await {
            Ok(pre_keys) => pre_keys,
            Err(error) => {
                tracing::error!(error = %error, "memory store failed to generate prekeys");
                Vec::new()
            }
        };
        if let Some(last) = pre_keys.last()
            && let Err(error) = device.pre_keys.mark_pre_keys_as_uploaded(last.key_id).await
        {
            tracing::error!(error = %error, "memory store failed to mark prekeys");
        }
        let keys = DeviceKeys {
            registration_id: device.registration_id,
            identity: device.identity_key.public,
            signed_pre_key: (
                device.signed_pre_key.key_id,
                device.signed_pre_key.key_pair.public,
                device.signed_pre_key.signature.unwrap_or([0; 64]),
            ),
            pre_keys: pre_keys
                .iter()
                .map(|key| (key.key_id, key.key_pair.public))
                .collect(),
        };
        let account = device.identity_key.clone();
        let (inbox, mut deliveries) = mpsc::unbounded_channel();
        let lid = {
            let mut state = self.shared.lock();
            let lid = format!("{}", 100_000_000_000_000 + state.number());
            state.lids.insert(lid.clone(), phone.to_owned());
            let mut devices = std::collections::BTreeMap::new();
            devices.insert(
                0,
                DeviceRecord {
                    kind: DeviceKind::Phone(inbox),
                    keys: Some(keys),
                    connection: None,
                    offline: Default::default(),
                    unacked: Vec::new(),
                },
            );
            state.users.insert(
                phone.to_owned(),
                User {
                    phone: phone.to_owned(),
                    lid: lid.clone(),
                    push_name: push_name.to_owned(),
                    account,
                    devices,
                    next_device: 0,
                },
            );
            lid
        };
        let fake_phone = FakePhone {
            shared: Arc::clone(&self.shared),
            core: Arc::new(PhoneCore::new(phone.to_owned(), lid, device)),
        };
        let worker = fake_phone.clone();
        let cancel = self.shared.cancel.clone();
        self.shared.tasks.spawn(async move {
            loop {
                let delivered = tokio::select! {
                    () = cancel.cancelled() => return,
                    delivered = deliveries.recv() => delivered,
                };
                let Some(delivered) = delivered else {
                    return;
                };
                worker.handle(delivered).await;
            }
        });
        self.shared.changed();
        fake_phone
    }

    /// Creates a group of the given phones' users (the first is the
    /// creator) and notifies their linked devices; returns the group JID.
    pub fn create_group(&self, subject: &str, members: &[&FakePhone]) -> Jid {
        let mut state = self.shared.lock();
        let id = format!("120363{:012}", state.number());
        let created = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default();
        let group = Group {
            id: id.clone(),
            subject: subject.to_owned(),
            creator: members
                .first()
                .map(|phone| phone.phone().to_owned())
                .unwrap_or_default(),
            created,
            members: members
                .iter()
                .map(|phone| phone.phone().to_owned())
                .collect(),
        };
        let group_node = state.group_node(&group);
        let creator = state
            .users
            .get(&group.creator)
            .map(|user| device_jid(&user.lid, 0, true))
            .unwrap_or_default();
        let targets: Vec<DeviceAddress> = group
            .members
            .iter()
            .filter_map(|member| state.users.get(member))
            .flat_map(|user| {
                user.devices.keys().map(|device| DeviceAddress {
                    phone: user.phone.clone(),
                    device: *device,
                })
            })
            .collect();
        state.groups.insert(id.clone(), group);
        let group = group_jid(&id);
        for target in targets {
            let notification = node(
                "notification",
                vec![
                    ("from", jid(&group)),
                    ("id", text(random_id())),
                    ("t", now()),
                    ("type", text("w:gp2")),
                    ("participant", jid(&creator)),
                ],
                children(vec![node(
                    "create",
                    vec![],
                    children(vec![group_node.clone()]),
                )]),
            );
            state.deliver(&target, notification);
        }
        drop(state);
        self.shared.changed();
        group
    }

    /// The linked devices of a user, as phone-number device JIDs.
    pub fn linked_devices(&self, phone: &FakePhone) -> Vec<Jid> {
        let state = self.shared.lock();
        state
            .users
            .get(phone.phone())
            .map(|user| {
                user.devices
                    .keys()
                    .filter(|device| **device != 0)
                    .map(|device| device_jid(&user.phone, *device, false))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Whether a linked device is logged in right now.
    pub fn is_online(&self, device: &Jid) -> bool {
        let state = self.shared.lock();
        state
            .resolve(device)
            .and_then(|address| state.device(&address))
            .is_some_and(|record| record.connection.is_some())
    }

    /// Waits until a linked device is logged in.
    pub async fn wait_until_online(&self, device: &Jid, timeout: Duration) -> bool {
        self.shared
            .wait_for(timeout, || self.is_online(device).then_some(()))
            .await
            .is_some()
    }

    /// Waits until a linked device is no longer logged in.
    pub async fn wait_until_offline(&self, device: &Jid, timeout: Duration) -> bool {
        self.shared
            .wait_for(timeout, || (!self.is_online(device)).then_some(()))
            .await
            .is_some()
    }

    /// Waits until a linked device has uploaded prekeys, which a client does
    /// right after its first login.
    pub async fn wait_until_keys_uploaded(&self, device: &Jid, timeout: Duration) -> bool {
        self.shared
            .wait_for(timeout, || {
                let state = self.shared.lock();
                let address = state.resolve(device)?;
                state.device(&address)?.keys.as_ref().map(|_| ())
            })
            .await
            .is_some()
    }

    /// How many times a message was handed to a linked device's connection
    /// (redeliveries after a dropped connection count again).
    pub fn delivery_count(&self, device: &Jid, message_id: &str) -> usize {
        let state = self.shared.lock();
        let Some(address) = state.resolve(device) else {
            return 0;
        };
        state
            .delivered
            .iter()
            .filter(|(target, id)| *target == address && id == message_id)
            .count()
    }

    /// How many times a linked device submitted a message with this ID.
    pub fn submission_count(&self, device: &Jid, message_id: &str) -> usize {
        let state = self.shared.lock();
        let Some(address) = state.resolve(device) else {
            return 0;
        };
        state
            .submitted
            .iter()
            .filter(|(sender, id)| *sender == address && id == message_id)
            .count()
    }

    /// IDs of the messages a linked device submitted, in order.
    pub fn submissions(&self, device: &Jid) -> Vec<String> {
        let state = self.shared.lock();
        let Some(address) = state.resolve(device) else {
            return Vec::new();
        };
        state
            .submitted
            .iter()
            .filter(|(sender, _)| *sender == address)
            .map(|(_, id)| id.clone())
            .collect()
    }

    /// Waits until a linked device has submitted at least `count` messages.
    pub async fn wait_for_submissions(
        &self,
        device: &Jid,
        count: usize,
        timeout: Duration,
    ) -> bool {
        self.shared
            .wait_for(timeout, || {
                (self.submissions(device).len() >= count).then_some(())
            })
            .await
            .is_some()
    }

    /// While set, messages a linked device submits are still routed but the
    /// server never acks them, as when the connection dies right after the
    /// submission reached WhatsApp.
    pub fn withhold_acks(&self, device: &Jid, withhold: bool) {
        let mut state = self.shared.lock();
        let Some(address) = state.resolve(device) else {
            return;
        };
        if withhold {
            state.withheld_acks.insert(address);
        } else {
            state.withheld_acks.remove(&address);
        }
    }

    /// Messages queued for a linked device while it is offline or unacked.
    pub fn pending_count(&self, device: &Jid) -> usize {
        let state = self.shared.lock();
        state
            .resolve(device)
            .and_then(|address| state.device(&address))
            .map_or(0, |record| record.offline.len() + record.unacked.len())
    }

    /// Waits until a linked device has acked everything delivered to it and
    /// nothing is queued for it.
    pub async fn wait_until_acked(&self, device: &Jid, timeout: Duration) -> bool {
        self.shared
            .wait_for(timeout, || (self.pending_count(device) == 0).then_some(()))
            .await
            .is_some()
    }

    /// Closes a linked device's connection, as a network failure would. The
    /// client reconnects on its own.
    pub fn drop_connection(&self, device: &Jid) {
        let state = self.shared.lock();
        if let Some(connection) = state
            .resolve(device)
            .and_then(|address| state.device(&address))
            .and_then(|record| record.connection)
        {
            state.close(connection);
        }
    }

    /// Removes a linked device, as "Log out" on the phone does: the device
    /// gets a `device_removed` stream error and can't log in again.
    pub fn kick(&self, device: &Jid) {
        let mut state = self.shared.lock();
        let Some(address) = state.resolve(device).filter(|address| address.device != 0) else {
            return;
        };
        let connection = state.device(&address).and_then(|record| record.connection);
        if let Some(connection) = connection {
            state.send(
                connection,
                node(
                    "stream:error",
                    vec![("code", text("401"))],
                    children(vec![node(
                        "conflict",
                        vec![("type", text("device_removed"))],
                        None,
                    )]),
                ),
            );
            state.close(connection);
        }
        if let Some(user) = state.users.get_mut(&address.phone) {
            user.devices.remove(&address.device);
        }
        drop(state);
        self.shared.changed();
    }

    /// Stops the listeners and closes every connection.
    pub async fn shutdown(self) {
        self.shared.cancel.cancel();
        self.shared.tasks.close();
        self.shared.tasks.wait().await;
    }
}
