// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow client.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Deliberate deviations:
// - Go's public mutable fields (`EnableAutoReconnect`, `SynchronousAck`,
//   `PrePairCallback`, …) are a [`ClientConfig`] passed to [`Client::new`].
// - The HTTP clients and proxy setters are replaced by [`Dialer`], which opens
//   the websocket (tests dial an in-memory fake server).
// - Event handlers are async ([`EventHandler`]) so a handler can persist an
//   event before the client acks it (`synchronous_ack`). [`Client::subscribe`]
//   gives a channel of events instead.
// - `context.Context` parameters are dropped. The per-connection context is a
//   `CancellationToken`; background tasks run on the client's `TaskTracker`.
// - Logs carry opaque IDs only: no node XML, JIDs or phone numbers.
// - `handler_queue_loop` handles a `stream:error` it dequeued after the
//   connection ended instead of dropping it (Go drops it, losing the
//   post-pairing 515 reconnect when the socket closes in the same write).
// - Not ported: Messenger (`MessengerConfig`, `RefreshCAT`), proxies.

//! The WhatsApp web multidevice client.

use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use futures::FutureExt;
use futures::future::BoxFuture;
use tokio::sync::{RwLock, mpsc, oneshot, watch};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument;

use crate::binary::{Attrs, Node, NodeContent, marshal, unmarshal, unpack};
use crate::errors::ClientError;
use crate::handshake::do_handshake;
use crate::pair_code::PairClientType;
use crate::signal::{CurveSignatures, SignalProtocol};
use crate::socket::{FrameEvent, FrameSocket, NoiseEvent, NoiseSocket, SocketError, URL};
use crate::store::{Device, StoreError};
use crate::types::events::{Disconnected, Event};
use crate::types::{AddressingMode, DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, Jid};
use crate::util::keys::new_key_pair;

/// Everything the client needs from a Signal implementation: the protocol
/// and XEdDSA signatures. Implemented for every type that has both.
pub trait Signal: SignalProtocol + CurveSignatures {}

impl<Implementation: SignalProtocol + CurveSignatures> Signal for Implementation {}

/// Opens the websocket to WhatsApp.
///
/// Object safe (`Arc<dyn Dialer>`), hence `async_trait`.
#[async_trait]
pub trait Dialer: Send + Sync {
    /// Connects and returns the frame socket with its events.
    async fn dial(&self) -> Result<(FrameSocket, mpsc::Receiver<FrameEvent>), SocketError>;
}

/// Dials WhatsApp's real websocket endpoint ([`URL`]).
pub struct WebSocketDialer {
    /// The URL to dial.
    pub url: String,
}

impl Default for WebSocketDialer {
    fn default() -> Self {
        WebSocketDialer {
            url: URL.to_owned(),
        }
    }
}

#[async_trait]
impl Dialer for WebSocketDialer {
    async fn dial(&self) -> Result<(FrameSocket, mpsc::Receiver<FrameEvent>), SocketError> {
        FrameSocket::connect(&self.url).await
    }
}

/// Handles events emitted by the client. Returning `false` marks the event
/// as failed: with `synchronous_ack`, the node isn't acked so the server
/// redelivers it.
///
/// Object safe (`Arc<dyn EventHandler>`), hence `async_trait`.
#[async_trait]
pub trait EventHandler: Send + Sync {
    /// Handles one event.
    async fn handle(&self, event: &Event) -> bool;
}

struct FnHandler<Function>(Function);

#[async_trait]
impl<Function: Fn(&Event) + Send + Sync> EventHandler for FnHandler<Function> {
    async fn handle(&self, event: &Event) -> bool {
        (self.0)(event);
        true
    }
}

/// `PrePairCallback`: called with the JID, platform and business name before
/// pairing completes; returning `false` cancels the pairing.
pub type PrePairCallback = Arc<dyn Fn(&Jid, &str, &str) -> bool + Send + Sync>;

/// `AutoReconnectHook`: called when an automatic reconnect fails; returning
/// `false` stops reconnecting.
pub type AutoReconnectHook = Arc<dyn Fn(&ClientError) -> bool + Send + Sync>;

/// `GetMessageForRetry`: the requester, the chat and the message ID.
pub type GetMessageForRetry =
    Arc<dyn Fn(&Jid, &Jid, &str) -> Option<crate::proto::wa_e2e::Message> + Send + Sync>;

/// `PreRetryCallback`: the receipt, message ID, retry count and message.
pub type PreRetryCallback = Arc<
    dyn Fn(&crate::types::events::Receipt, &str, i64, &crate::proto::wa_e2e::Message) -> bool
        + Send
        + Sync,
>;

/// The settings Go keeps as public fields on `Client`.
#[derive(Clone)]
pub struct ClientConfig {
    /// Opens the websocket.
    pub dialer: Arc<dyn Dialer>,
    /// Reconnect automatically after unexpected disconnects (default true).
    pub enable_auto_reconnect: bool,
    /// Retry in the background when the first connection attempt fails.
    pub initial_auto_reconnect: bool,
    /// See [`AutoReconnectHook`].
    pub auto_reconnect_hook: Option<AutoReconnectHook>,
    /// Only ack nodes after every event handler returned successfully.
    pub synchronous_ack: bool,
    /// Don't reconnect after the server's post-login 515 stream error; emit
    /// [`Event::ManualLoginReconnect`] instead.
    pub disable_login_auto_reconnect: bool,
    /// Emit app state events even when re-syncing the whole state.
    pub emit_app_state_events_on_full_sync: bool,
    /// Ask the phone for messages that fail to decrypt.
    pub automatic_message_rerequest_from_phone: bool,
    /// Don't download history syncs automatically.
    pub manual_history_sync_download: bool,
    /// Don't send the history sync receipt when downloading manually.
    pub disable_manual_history_sync_receipt: bool,
    /// Delete the stored identity and sessions on untrusted identity errors
    /// (default true).
    pub auto_trust_identity: bool,
    /// Keep sent messages in the store so retry receipts work across restarts.
    pub use_retry_message_store: bool,
    /// See [`PrePairCallback`].
    pub pre_pair_callback: Option<PrePairCallback>,
    /// Overrides the client type shown on the phone while pairing.
    pub qr_client_type: Option<PairClientType>,
    /// The HTTP client for media downloads and uploads (Go's `mediaHTTP`).
    pub media_http: reqwest::Client,
    /// Fail [`Client::subscribe_presence`] when there's no privacy token for
    /// the user instead of subscribing without one.
    pub error_on_subscribe_presence_without_token: bool,
    /// Finds a sent message for a retry receipt when it isn't in the recent
    /// message cache, given the requester, chat and message ID
    /// (`GetMessageForRetry`).
    pub get_message_for_retry: Option<GetMessageForRetry>,
    /// Called before accepting a retry receipt; returning `false` ignores it
    /// (`PreRetryCallback`).
    pub pre_retry_callback: Option<PreRetryCallback>,
    /// Sends media uploads, downloads and deletes to this base URL
    /// (`scheme://host[:port]`) instead of the hosts the media connection
    /// names, e.g. a local fake media server in tests. `None` (default) uses
    /// WhatsApp's hosts. Not in whatsmeow.
    pub media_base_url: Option<String>,
    /// Buffer decrypted events in the store so a redelivered ciphertext
    /// isn't decrypted twice (Go's `EnableDecryptedEventBuffer`).
    pub enable_decrypted_event_buffer: bool,
}

impl Default for ClientConfig {
    fn default() -> Self {
        ClientConfig {
            dialer: Arc::new(WebSocketDialer::default()),
            enable_auto_reconnect: true,
            initial_auto_reconnect: false,
            auto_reconnect_hook: None,
            synchronous_ack: false,
            disable_login_auto_reconnect: false,
            emit_app_state_events_on_full_sync: false,
            automatic_message_rerequest_from_phone: false,
            manual_history_sync_download: false,
            disable_manual_history_sync_receipt: false,
            auto_trust_identity: true,
            use_retry_message_store: false,
            pre_pair_callback: None,
            qr_client_type: None,
            media_http: reqwest::Client::new(),
            error_on_subscribe_presence_without_token: false,
            enable_decrypted_event_buffer: false,
            media_base_url: None,
            get_message_for_retry: None,
            pre_retry_callback: None,
        }
    }
}

/// exsync.Event: a flag tasks can wait on.
pub(crate) struct EventFlag(watch::Sender<bool>);

impl EventFlag {
    pub(crate) fn new() -> Self {
        EventFlag(watch::Sender::new(false))
    }

    pub(crate) fn set(&self) {
        self.0.send_replace(true);
    }

    pub(crate) fn clear(&self) {
        self.0.send_replace(false);
    }

    pub(crate) fn is_set(&self) -> bool {
        *self.0.borrow()
    }

    /// Waits until the flag is set.
    pub(crate) async fn wait(&self) {
        let mut receiver = self.0.subscribe();
        // The sender lives as long as `self`, so this only returns once set.
        let _ = receiver.wait_for(|set| *set).await;
    }
}

/// The socket and its connection, guarded by Go's `socketLock`.
#[derive(Default)]
pub(crate) struct SocketState {
    pub(crate) socket: Option<Arc<NoiseSocket>>,
    /// Cancelled when the connection ends (Go's `fs.Context()`).
    connection: Option<CancellationToken>,
    /// Resolves when the handler queue loop exits.
    handler_queue_wait: Option<oneshot::Receiver<()>>,
}

/// Size of the queue that all incoming XML nodes go through.
const HANDLER_QUEUE_SIZE: usize = 2048;

/// The tags of the nodes the client handles (Go's `nodeHandlers` keys).
const NODE_HANDLER_TAGS: &[&str] = &[
    "message",
    "status",
    "appdata",
    "receipt",
    "call",
    "chatstate",
    "presence",
    "notification",
    "success",
    "failure",
    "stream:error",
    "iq",
    "ib",
];

/// A user's devices and the hash of the list.
#[derive(Clone, Debug, Default)]
pub(crate) struct DeviceCache {
    pub(crate) devices: Vec<Jid>,
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "Go keeps it but never reads it either")
    )]
    pub(crate) dhash: String,
}

/// What the send path needs to know about a group (Go's `groupMetaCache`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct GroupMetaCache {
    pub(crate) addressing_mode: AddressingMode,
    pub(crate) community_announcement_group: bool,
    pub(crate) read_only: bool,
    pub(crate) members: Vec<Jid>,
    pub(crate) admins: Vec<Jid>,
}

impl GroupMetaCache {
    /// Whether the sender may send the message: anyone may send in a group
    /// that isn't read only, and only admins may send anything but
    /// reactions, poll votes and the like in one that is (`CanSend`; a nil
    /// cache in Go is `None` at the call site).
    pub(crate) fn can_send(&self, sender: &Jid, message: &crate::proto::wa_e2e::Message) -> bool {
        !self.read_only
            || message.poll_update_message.is_some()
            || message.reaction_message.is_some()
            || message.enc_reaction_message.is_some()
            || message.enc_event_response_message.is_some()
            || message.question_response_message.is_some()
            || message.comment_message.is_some()
            || message.enc_comment_message.is_some()
            || self.admins.contains(&sender.to_non_ad())
    }
}

/// Everything necessary to connect to and interact with the WhatsApp web API.
pub struct Client {
    /// The device: keys, identity and stores (Go's `Store`).
    pub store: RwLock<Device>,
    pub(crate) signal: Arc<dyn Signal>,
    pub(crate) config: ClientConfig,

    pub(crate) socket: RwLock<SocketState>,
    socket_wait: watch::Sender<u64>,

    is_logged_in: AtomicBool,
    pub(crate) paired: AtomicBool,
    pub(crate) expected_disconnect: EventFlag,
    force_auto_reconnect: AtomicBool,
    last_successful_connect: Mutex<Option<DateTime<Utc>>>,
    auto_reconnect_errors: AtomicU32,

    pub(crate) send_active_receipts: AtomicU32,

    /// Prekey upload lock with the time of the last upload.
    pub(crate) upload_pre_keys_lock: tokio::sync::Mutex<Option<tokio::time::Instant>>,
    /// Set once prekeys were uploaded (Go's `PreKeysUploaded`).
    pub(crate) pre_keys_uploaded: EventFlag,

    response_waiters: Mutex<HashMap<String, oneshot::Sender<Node>>>,

    event_handlers: std::sync::RwLock<Vec<(u32, Arc<dyn EventHandler>)>>,
    next_handler_id: AtomicU32,

    /// Go's `groupCache`; held across the group info query when filling it.
    pub(crate) group_cache: tokio::sync::Mutex<HashMap<Jid, GroupMetaCache>>,
    pub(crate) user_devices_cache: tokio::sync::Mutex<HashMap<Jid, DeviceCache>>,

    pub(crate) tc_token_sender_ts: Mutex<crate::tctoken::TcTokenSenderTimestamps>,
    /// The prune lock with the time of the last prune.
    pub(crate) tc_token_db_prune: tokio::sync::Mutex<Option<tokio::time::Instant>>,

    pub(crate) media_conn_cache: tokio::sync::Mutex<Option<crate::mediaconn::MediaConn>>,
    pub(crate) phone_linking_cache: Mutex<Option<crate::pair_code::PhoneLinkingCache>>,
    pub(crate) passkey_state: Mutex<crate::pair_passkey::PasskeyState>,
    pub(crate) privacy_settings_cache: Mutex<Option<crate::types::PrivacySettings>>,

    /// Built from the device's stores in [`Client::new`] (Go's
    /// `appStateProc`).
    pub(crate) app_state_proc: Mutex<Arc<crate::appstate::Processor>>,
    /// Serializes app state fetches (Go's `appStateSyncLock`).
    pub(crate) app_state_sync_lock: tokio::sync::Mutex<()>,
    /// When each missing app state key was last requested, by hex key ID.
    pub(crate) app_state_key_requests: Mutex<HashMap<String, tokio::time::Instant>>,
    pub(crate) last_decrypted_buffer_clear: Mutex<Option<tokio::time::Instant>>,
    pub(crate) history_sync_notifications:
        mpsc::UnboundedSender<crate::proto::wa_e2e::HistorySyncNotification>,
    pub(crate) history_sync_notifications_receiver:
        tokio::sync::Mutex<mpsc::UnboundedReceiver<crate::proto::wa_e2e::HistorySyncNotification>>,
    pub(crate) history_sync_handler_started: AtomicBool,
    /// Retry receipts sent per incoming message ID.
    pub(crate) message_retries: Mutex<HashMap<String, i64>>,
    /// Pending delayed requests to the phone per message ID.
    pub(crate) pending_phone_rerequests: Mutex<HashMap<String, CancellationToken>>,
    pub(crate) recent_messages: Mutex<crate::retry::RecentMessages>,
    pub(crate) retry_state: Mutex<crate::retry::RetryState>,
    /// Serializes sends (Go's `messageSendLock`).
    pub(crate) message_send_lock: tokio::sync::Mutex<()>,

    unique_id: String,
    id_counter: AtomicU64,

    pub(crate) server_time_offset: AtomicI64,

    pub(crate) tasks: TaskTracker,
    /// Cancelled when the client is dropped or shut down (Go's
    /// `BackgroundEventCtx`).
    pub(crate) background: CancellationToken,
}

/// Locks a std mutex, ignoring poisoning: every guarded value is replaced
/// in one step, so a panic can't leave it half-written.
pub(crate) fn lock<Value>(mutex: &Mutex<Value>) -> MutexGuard<'_, Value> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Client {
    /// Creates a client for the device (`NewClient`).
    pub fn new(device: Device, signal: Arc<dyn Signal>, config: ClientConfig) -> Arc<Client> {
        let unique_id_prefix: [u8; 2] = rand::random();
        let paired = device.id.is_some();
        let app_state_proc = Mutex::new(Arc::new(crate::appstate::Processor::new(&device)));
        let (history_sync_notifications, history_sync_notifications_receiver) =
            mpsc::unbounded_channel();
        Arc::new(Client {
            store: RwLock::new(device),
            signal,
            config,
            socket: RwLock::new(SocketState::default()),
            socket_wait: watch::Sender::new(0),
            is_logged_in: AtomicBool::new(false),
            paired: AtomicBool::new(paired),
            expected_disconnect: EventFlag::new(),
            force_auto_reconnect: AtomicBool::new(false),
            last_successful_connect: Mutex::new(None),
            auto_reconnect_errors: AtomicU32::new(0),
            send_active_receipts: AtomicU32::new(0),
            upload_pre_keys_lock: tokio::sync::Mutex::new(None),
            pre_keys_uploaded: EventFlag::new(),
            response_waiters: Mutex::new(HashMap::new()),
            event_handlers: std::sync::RwLock::new(Vec::new()),
            next_handler_id: AtomicU32::new(0),
            group_cache: tokio::sync::Mutex::new(HashMap::new()),
            user_devices_cache: tokio::sync::Mutex::new(HashMap::new()),
            tc_token_sender_ts: Mutex::new(Default::default()),
            tc_token_db_prune: tokio::sync::Mutex::new(None),
            media_conn_cache: tokio::sync::Mutex::new(None),
            phone_linking_cache: Mutex::new(None),
            passkey_state: Mutex::new(Default::default()),
            privacy_settings_cache: Mutex::new(None),
            app_state_proc,
            app_state_sync_lock: tokio::sync::Mutex::new(()),
            app_state_key_requests: Mutex::new(HashMap::new()),
            last_decrypted_buffer_clear: Mutex::new(None),
            history_sync_notifications,
            history_sync_notifications_receiver: tokio::sync::Mutex::new(
                history_sync_notifications_receiver,
            ),
            history_sync_handler_started: AtomicBool::new(false),
            message_retries: Mutex::new(HashMap::new()),
            pending_phone_rerequests: Mutex::new(HashMap::new()),
            recent_messages: Mutex::new(Default::default()),
            retry_state: Mutex::new(Default::default()),
            message_send_lock: tokio::sync::Mutex::new(()),
            unique_id: format!("{}.{}-", unique_id_prefix[0], unique_id_prefix[1]),
            id_counter: AtomicU64::new(0),
            server_time_offset: AtomicI64::new(0),
            tasks: TaskTracker::new(),
            background: CancellationToken::new(),
        })
    }

    /// The XEdDSA implementation.
    pub(crate) fn signatures(&self) -> &dyn CurveSignatures {
        self.signal.as_ref()
    }

    /// Spawns a background task on the client's tracker.
    pub(crate) fn spawn<Task>(&self, task: Task)
    where
        Task: Future<Output = ()> + Send + 'static,
    {
        self.tasks.spawn(task);
    }

    /// Spawns `dispatch_event` in the background (Go's `go cli.dispatchEvent`).
    pub(crate) fn spawn_dispatch(self: &Arc<Self>, event: Event) {
        let client = Arc::clone(self);
        self.spawn(async move {
            client.dispatch_event(event).await;
        });
    }

    fn notify_socket_waiters(&self) {
        self.socket_wait.send_modify(|generation| *generation += 1);
    }

    /// The device's JID, or the empty JID before pairing.
    pub async fn get_own_id(&self) -> Jid {
        self.store.read().await.get_jid()
    }

    /// The device's LID, or the empty JID when unknown.
    pub async fn get_own_lid(&self) -> Jid {
        self.store.read().await.get_lid()
    }

    /// Waits until the client is connected and logged in, the timeout passes,
    /// or a disconnect is expected.
    pub async fn wait_for_connection(&self, timeout: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let mut waiter = self.socket_wait.subscribe();
            {
                let state = self.socket.read().await;
                if state
                    .socket
                    .as_ref()
                    .is_some_and(|socket| socket.is_connected())
                    && self.is_logged_in()
                {
                    return true;
                }
            }
            tokio::select! {
                _ = waiter.changed() => {}
                () = tokio::time::sleep_until(deadline) => return false,
                () = self.expected_disconnect.wait() => return false,
            }
        }
    }

    /// Connects to the WhatsApp web websocket. After connecting, the client
    /// either logs in with the stored device or emits [`Event::Qr`] to pair a
    /// new one.
    #[tracing::instrument(name = "whatsmeow.connect", skip_all, err)]
    pub async fn connect(self: &Arc<Self>) -> Result<(), ClientError> {
        let mut state = self.socket.write().await;
        let result = self.unlocked_connect(&mut state).await;
        drop(state);
        if let Err(error) = &result
            && is_retryable_connect_error(error)
            && self.config.initial_auto_reconnect
            && self.config.enable_auto_reconnect
        {
            tracing::error!(error = %error, "initial connection failed but reconnecting in background");
            self.spawn_dispatch(Event::Disconnected(Disconnected));
            let client = Arc::clone(self);
            self.spawn(async move { client.auto_reconnect().await });
            return Ok(());
        }
        result
    }

    async fn connect_inner(self: &Arc<Self>) -> Result<(), ClientError> {
        let mut state = self.socket.write().await;
        self.unlocked_connect(&mut state).await
    }

    /// Boxed with an explicit `Send` bound to break the inference cycle
    /// through handlers that reconnect (see [`Client::auto_reconnect`]).
    fn unlocked_connect<'call>(
        self: &'call Arc<Self>,
        state: &'call mut SocketState,
    ) -> BoxFuture<'call, Result<(), ClientError>> {
        Box::pin(self.unlocked_connect_inner(state))
    }

    async fn unlocked_connect_inner(
        self: &Arc<Self>,
        state: &mut SocketState,
    ) -> Result<(), ClientError> {
        if self.store.read().await.deleted {
            return Err(StoreError::DeviceDeleted.into());
        }
        if let Some(socket) = &state.socket {
            if !socket.is_connected() {
                self.unlocked_disconnect(state).await;
            } else {
                return Err(ClientError::AlreadyConnected);
            }
        }

        self.reset_expected_disconnect();
        let (frame_socket, frames) = self.config.dialer.dial().await?;
        let (noise_key, client_payload) = {
            let store = self.store.read().await;
            let payload = store.get_client_payload().map_err(|error| {
                ClientError::Other(format!("got invalid client payload: {error}"))
            });
            (store.noise_key.clone(), payload)
        };
        let client_payload = match client_payload {
            Ok(payload) => payload,
            Err(error) => {
                frame_socket.close(None).await;
                return Err(error);
            }
        };
        let (noise_socket, noise_events) = match do_handshake(
            frame_socket.clone(),
            frames,
            &new_key_pair(),
            &noise_key,
            &client_payload,
            self.signatures(),
        )
        .await
        {
            Ok(result) => result,
            Err(error) => {
                frame_socket.close(None).await;
                return Err(error.into());
            }
        };
        let noise_socket = Arc::new(noise_socket);
        let connection = CancellationToken::new();
        let (queue_sender, queue_receiver) = mpsc::channel(HANDLER_QUEUE_SIZE);
        let (close_wait_sender, close_wait_receiver) = oneshot::channel();
        state.socket = Some(Arc::clone(&noise_socket));
        state.connection = Some(connection.clone());
        state.handler_queue_wait = Some(close_wait_receiver);

        let client = Arc::clone(self);
        let reader_connection = connection.clone();
        self.spawn(async move {
            client
                .read_loop(noise_socket, noise_events, queue_sender, reader_connection)
                .await;
        });
        let client = Arc::clone(self);
        let keepalive_connection = connection.clone();
        self.spawn(async move { client.keep_alive_loop(keepalive_connection).await });
        let client = Arc::clone(self);
        self.spawn(async move {
            client
                .handler_queue_loop(connection, queue_receiver, close_wait_sender)
                .await;
        });
        Ok(())
    }

    /// Feeds decrypted frames into the node queue and reports the
    /// disconnect (Go wires these as noise socket callbacks).
    async fn read_loop(
        self: Arc<Self>,
        noise_socket: Arc<NoiseSocket>,
        mut events: mpsc::Receiver<NoiseEvent>,
        queue: mpsc::Sender<Node>,
        connection: CancellationToken,
    ) {
        while let Some(event) = events.recv().await {
            match event {
                NoiseEvent::Frame(data) => self.handle_frame(&data, &queue),
                NoiseEvent::Disconnected { remote } => {
                    connection.cancel();
                    self.on_disconnect(&noise_socket, remote).await;
                    return;
                }
            }
        }
        connection.cancel();
    }

    /// Whether the client is connected and authenticated.
    pub fn is_logged_in(&self) -> bool {
        self.is_logged_in.load(Ordering::SeqCst)
    }

    pub(crate) fn set_logged_in(&self, logged_in: bool) {
        self.is_logged_in.store(logged_in, Ordering::SeqCst);
    }

    async fn on_disconnect(self: &Arc<Self>, noise_socket: &Arc<NoiseSocket>, remote: bool) {
        noise_socket.stop(false, false).await;
        let mut state = self.socket.write().await;
        if state
            .socket
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, noise_socket))
        {
            state.socket = None;
            self.clear_response_waiters(&xml_stream_end_node());
            if !self.is_expected_disconnect()
                && (self.force_auto_reconnect.swap(false, Ordering::SeqCst) || remote)
            {
                tracing::debug!("emitting Disconnected event");
                self.spawn_dispatch(Event::Disconnected(Disconnected));
                let client = Arc::clone(self);
                self.spawn(async move { client.auto_reconnect().await });
            } else if remote {
                tracing::debug!("on_disconnect called, but it was expected, so not emitting event");
            } else {
                tracing::debug!("on_disconnect called after manual disconnection");
            }
        } else {
            tracing::debug!("ignoring on_disconnect on different socket");
        }
    }

    pub(crate) fn expect_disconnect(&self) {
        self.force_auto_reconnect.store(false, Ordering::SeqCst);
        self.expected_disconnect.set();
    }

    pub(crate) fn reset_expected_disconnect(&self) {
        self.force_auto_reconnect.store(false, Ordering::SeqCst);
        self.expected_disconnect.clear();
    }

    pub(crate) fn is_expected_disconnect(&self) -> bool {
        self.expected_disconnect.is_set()
    }

    /// Boxed with an explicit `Send` bound: reconnecting calls back into
    /// `connect`, whose tasks can start another reconnect, and the compiler
    /// can't infer `Send` through that cycle.
    pub(crate) fn auto_reconnect(self: Arc<Self>) -> BoxFuture<'static, ()> {
        Box::pin(self.auto_reconnect_inner())
    }

    async fn auto_reconnect_inner(self: Arc<Self>) {
        if !self.config.enable_auto_reconnect || self.store.read().await.id.is_none() {
            return;
        }
        loop {
            let errors = self.auto_reconnect_errors.fetch_add(1, Ordering::SeqCst);
            let delay = Duration::from_secs(u64::from(errors) * 2);
            tracing::debug!(delay = ?delay, "automatically reconnecting");
            tokio::select! {
                () = self.expected_disconnect.wait() => {
                    tracing::debug!("cancelling automatic reconnect due to expected disconnect");
                    return;
                }
                () = self.background.cancelled() => {
                    tracing::debug!("cancelling automatic reconnect due to client shutdown");
                    return;
                }
                () = tokio::time::sleep(delay) => {}
            }
            match self.connect_inner().await {
                Err(ClientError::AlreadyConnected) => {
                    tracing::debug!(
                        "connect said we're already connected after autoreconnect sleep"
                    );
                    return;
                }
                Err(error) => {
                    if self.expected_disconnect.is_set() {
                        tracing::debug!(
                            "autoreconnect failed, but disconnect was expected, not reconnecting"
                        );
                        return;
                    }
                    tracing::error!(error = %error, "error reconnecting after autoreconnect sleep");
                    if let Some(hook) = &self.config.auto_reconnect_hook
                        && !hook(&error)
                    {
                        tracing::debug!("auto reconnect hook returned false, not reconnecting");
                        return;
                    }
                }
                Ok(()) => return,
            }
        }
    }

    /// Whether the websocket is connected (not necessarily authenticated).
    pub async fn is_connected(&self) -> bool {
        self.socket
            .read()
            .await
            .socket
            .as_ref()
            .is_some_and(|socket| socket.is_connected())
    }

    /// Disconnects from the websocket. Emits no event: [`Event::Disconnected`]
    /// is only for disconnects caused by the server or the network.
    pub async fn disconnect(&self) {
        let mut state = self.socket.write().await;
        self.expect_disconnect();
        self.unlocked_disconnect(&mut state).await;
        drop(state);
        self.clear_delayed_message_requests();
    }

    /// Disconnects and forces an automatic reconnect. Does nothing when the
    /// socket is already disconnected or auto-reconnect is off.
    pub async fn reset_connection(&self) {
        let state = self.socket.write().await;
        self.force_auto_reconnect.store(true, Ordering::SeqCst);
        if let Some(socket) = &state.socket {
            socket.stop(true, true).await;
            self.clear_response_waiters(&xml_stream_end_node());
        }
    }

    async fn unlocked_disconnect(&self, state: &mut SocketState) {
        if let Some(socket) = state.socket.take() {
            socket.stop(true, false).await;
            self.clear_response_waiters(&xml_stream_end_node());
        }
        if let Some(connection) = state.connection.take() {
            connection.cancel();
        }
        if let Some(wait) = state.handler_queue_wait.take()
            && tokio::time::timeout(Duration::from_secs(5), wait)
                .await
                .is_err()
        {
            tracing::warn!("handler queue wait channel not closed after 5 seconds");
        }
    }

    /// Asks the server to unlink this device, then disconnects and deletes
    /// the local device. Emits no event: [`Event::LoggedOut`] is only for
    /// logouts triggered elsewhere.
    pub async fn logout(&self) -> Result<(), ClientError> {
        let own_id = self.get_own_id().await;
        if own_id.is_empty() {
            return Err(ClientError::NotLoggedIn);
        }
        self.send_iq(crate::request::InfoQuery {
            namespace: "md",
            r#type: crate::request::IqType::Set,
            to: crate::types::SERVER_JID.clone(),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "remove-companion-device".to_owned(),
                attrs: Attrs::from([
                    ("jid".to_owned(), own_id.into()),
                    ("reason".to_owned(), "user_initiated".into()),
                ]),
                content: None,
            }])),
            ..Default::default()
        })
        .await
        .map_err(|error| error.wrap("error sending logout request"))?;
        self.disconnect().await;
        self.delete_device()
            .await
            .map_err(|error| ClientError::from(error).wrap("error deleting data from store"))
    }

    /// Registers an event handler; returns its ID for
    /// [`Client::remove_event_handler`].
    pub fn add_event_handler(&self, handler: Arc<dyn EventHandler>) -> u32 {
        let id = self.next_handler_id.fetch_add(1, Ordering::SeqCst) + 1;
        self.event_handlers
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .push((id, handler));
        id
    }

    /// Registers a synchronous event handler function that always succeeds.
    pub fn add_event_fn<Function>(&self, handler: Function) -> u32
    where
        Function: Fn(&Event) + Send + Sync + 'static,
    {
        self.add_event_handler(Arc::new(FnHandler(handler)))
    }

    /// A channel that receives every event from now on.
    pub fn subscribe(&self) -> mpsc::UnboundedReceiver<Event> {
        let (sender, receiver) = mpsc::unbounded_channel();
        self.add_event_fn(move |event| {
            let _ = sender.send(event.clone());
        });
        receiver
    }

    /// Removes an event handler; returns whether it was found.
    pub fn remove_event_handler(&self, id: u32) -> bool {
        let mut handlers = self
            .event_handlers
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        let before = handlers.len();
        handlers.retain(|(handler_id, _)| *handler_id != id);
        handlers.len() != before
    }

    /// Removes every event handler.
    pub fn remove_event_handlers(&self) {
        self.event_handlers
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }

    fn handle_frame(self: &Arc<Self>, data: &[u8], queue: &mpsc::Sender<Node>) {
        let decompressed = match unpack(data) {
            Ok(decompressed) => decompressed,
            Err(error) => {
                tracing::warn!(error = %error, "failed to decompress frame");
                return;
            }
        };
        let node = match unmarshal(&decompressed) {
            Ok(node) => node,
            Err(error) => {
                tracing::warn!(error = %error, "failed to decode node in frame");
                return;
            }
        };
        tracing::trace!(tag = %node.tag, "received node");
        if node.tag == "xmlstreamend" {
            if !self.is_expected_disconnect() {
                tracing::warn!("received stream end frame");
            }
        } else if self.receive_response(&node) {
            // handled
        } else if NODE_HANDLER_TAGS.contains(&node.tag.as_str()) {
            match queue.try_send(node) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(node)) => {
                    tracing::warn!(
                        "handler queue is full, message ordering is no longer guaranteed"
                    );
                    let queue = queue.clone();
                    self.spawn(async move {
                        let _ = queue.send(node).await;
                    });
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {}
            }
        } else if node.tag != "ack" {
            tracing::debug!(tag = %node.tag, "didn't handle WhatsApp node");
        }
    }

    async fn handler_queue_loop(
        self: Arc<Self>,
        connection: CancellationToken,
        mut queue: mpsc::Receiver<Node>,
        close_wait: oneshot::Sender<()>,
    ) {
        const SLOW_HANDLER_WARNING: Duration = Duration::from_secs(30);
        tracing::debug!("starting handler queue loop");
        'nodes: loop {
            let node = tokio::select! {
                node = queue.recv() => node,
                () = connection.cancelled() => {
                    tracing::debug!("closing handler queue loop");
                    break;
                }
            };
            let Some(node) = node else { break };
            if connection.is_cancelled() {
                // Deviation from Go: the node is already dequeued, so the
                // drain below wouldn't see it. A stream error (the 515
                // after pairing) must still be handled or the reconnect
                // is lost.
                if node.tag == "stream:error" {
                    tracing::debug!(
                        "handling stream:error node dequeued after the connection ended"
                    );
                    self.handle_stream_error(&node).await;
                }
                tracing::debug!("closing handler queue loop before node handling");
                break;
            }
            let tag = node.tag.clone();
            let client = Arc::clone(&self);
            let start = tokio::time::Instant::now();
            let mut handler = self.tasks.spawn(async move {
                client.handle_node(node).await;
                let duration = start.elapsed();
                if duration > Duration::from_secs(5) {
                    tracing::warn!(duration = ?duration, "node handling took long");
                }
            });
            for _ in 0..10 {
                tokio::select! {
                    _ = &mut handler => continue 'nodes,
                    () = connection.cancelled() => {
                        tracing::warn!(tag = %tag, "closing handler queue loop in the middle of handling a node");
                        break 'nodes;
                    }
                    () = tokio::time::sleep(SLOW_HANDLER_WARNING) => {
                        tracing::warn!(tag = %tag, elapsed = ?start.elapsed(), "node handling is taking long");
                    }
                }
            }
            tracing::warn!(tag = %tag, "continuing handling of node in background as it's taking too long");
        }
        // Stream errors are handled even after disconnection so the
        // appropriate auto-reconnect is done.
        while let Ok(node) = queue.try_recv() {
            if node.tag == "stream:error" {
                tracing::debug!(
                    "handling stream:error node in handler queue loop after context cancellation"
                );
                self.handle_stream_error(&node).await;
            }
        }
        let _ = close_wait.send(());
    }

    /// Dispatches a node to its handler (Go's `nodeHandlers` map).
    /// Boxed with an explicit `Send` bound to break the inference cycle
    /// through handlers that reconnect (see [`Client::auto_reconnect`]).
    fn handle_node(self: Arc<Self>, node: Node) -> BoxFuture<'static, ()> {
        let span = tracing::info_span!("whatsmeow.handle_node", tag = %node.tag);
        Box::pin(self.handle_node_inner(node).instrument(span))
    }

    async fn handle_node_inner(self: Arc<Self>, node: Node) {
        match node.tag.as_str() {
            "success" => self.handle_connect_success(&node).await,
            "failure" => self.handle_connect_failure(&node).await,
            "stream:error" => self.handle_stream_error(&node).await,
            "iq" => self.handle_iq(&node).await,
            "ib" => self.handle_ib(&node).await,
            "notification" => self.handle_notification(&node).await,
            "chatstate" => self.handle_chat_state(&node).await,
            "presence" => self.handle_presence(&node).await,
            "message" | "appdata" => self.handle_encrypted_message(&node).await,
            "status" => self.handle_unencrypted_message(&node).await,
            "receipt" => self.handle_receipt(&node).await,
            other => self.handle_unported_node(other, &node).await,
        }
    }

    /// Calls aren't ported; call nodes are acked so the server doesn't
    /// redeliver them forever.
    async fn handle_unported_node(self: &Arc<Self>, tag: &str, node: &Node) {
        tracing::debug!(tag, "no handler for node yet, acking it");
        if tag == "call" {
            self.send_ack(node, 0).await;
        }
    }

    /// Marshals and sends a node; returns the marshaled bytes.
    pub(crate) async fn send_node_and_get_data(&self, node: &Node) -> Result<Vec<u8>, ClientError> {
        let socket = self.socket.read().await.socket.clone();
        let Some(socket) = socket else {
            return Err(ClientError::NotConnected);
        };
        let payload = marshal(node)?;
        tracing::trace!(tag = %node.tag, "sending node");
        socket.send_frame(&payload).await?;
        Ok(payload)
    }

    /// Marshals and sends a node.
    pub(crate) async fn send_node(&self, node: &Node) -> Result<(), ClientError> {
        self.send_node_and_get_data(node).await.map(|_| ())
    }

    /// Sends an event to every handler; returns whether a handler failed.
    pub(crate) async fn dispatch_event(&self, event: Event) -> bool {
        let handlers: Vec<Arc<dyn EventHandler>> = self
            .event_handlers
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .map(|(_, handler)| Arc::clone(handler))
            .collect();
        for handler in handlers {
            match AssertUnwindSafe(handler.handle(&event))
                .catch_unwind()
                .await
            {
                Ok(true) => {}
                Ok(false) => return true,
                Err(_) => {
                    tracing::error!("event handler panicked");
                    return false;
                }
            }
        }
        false
    }

    /// Parses a history sync `WebMessageInfo` into the [`Event::Message`]
    /// real-time messages produce (`ParseWebMessage`). An empty `chat_jid`
    /// is taken from the message key.
    pub async fn parse_web_message(
        &self,
        chat_jid: &Jid,
        web_message: crate::proto::wa_web::WebMessageInfo,
    ) -> Result<crate::types::events::Message, ClientError> {
        use crate::types::{
            GROUP_SERVER, MessageInfo, MessageSource, NEWSLETTER_SERVER, parse_jid,
        };
        let key = web_message.key.clone();
        let chat_jid = if chat_jid.is_empty() {
            parse_jid(key.remote_jid.as_deref().unwrap_or_default()).map_err(|error| {
                ClientError::Other(format!(
                    "no chat JID provided and failed to parse remote JID: {error}"
                ))
            })?
        } else {
            chat_jid.clone()
        };
        let mut info = MessageInfo {
            source: MessageSource {
                is_from_me: key.from_me.unwrap_or_default(),
                is_group: chat_jid.server == GROUP_SERVER,
                chat: chat_jid.clone(),
                ..MessageSource::default()
            },
            id: key.id.clone().unwrap_or_default(),
            push_name: web_message.push_name.clone().unwrap_or_default(),
            timestamp: DateTime::from_timestamp(
                i64::try_from(web_message.message_timestamp.unwrap_or_default())
                    .unwrap_or_default(),
                0,
            ),
            ..MessageInfo::default()
        };
        let parse_sender = |jid: &str| {
            parse_jid(jid).map_err(|error| {
                ClientError::Other(format!(
                    "failed to parse sender of message {}: {error}",
                    info.id
                ))
            })
        };
        let sender = if info.is_from_me {
            match web_message
                .original_self_author_user_jid_string
                .as_deref()
                .filter(|jid| !jid.is_empty())
            {
                Some(author) => parse_sender(author)?,
                None => {
                    let own = if info.chat.server == HIDDEN_USER_SERVER {
                        self.get_own_lid().await
                    } else {
                        self.get_own_id().await
                    }
                    .to_non_ad();
                    if own.is_empty() {
                        return Err(ClientError::NotLoggedIn);
                    }
                    own
                }
            }
        } else if chat_jid.server == DEFAULT_USER_SERVER
            || chat_jid.server == HIDDEN_USER_SERVER
            || chat_jid.server == NEWSLETTER_SERVER
        {
            chat_jid.clone()
        } else if let Some(participant) =
            web_message.participant.as_deref().filter(|p| !p.is_empty())
        {
            parse_sender(participant)?
        } else if let Some(participant) = key.participant.as_deref().filter(|p| !p.is_empty()) {
            parse_sender(participant)?
        } else {
            return Err(ClientError::Other(format!(
                "couldn't find sender of message {}",
                info.id
            )));
        };
        info.sender = sender;
        if let Some(parent_key) = web_message
            .comment_metadata
            .as_ref()
            .and_then(|metadata| metadata.comment_parent_key.as_ref())
        {
            info.msg_meta_info.thread_message_id = parent_key.id.clone().unwrap_or_default();
            info.msg_meta_info.thread_message_sender_jid =
                parse_jid(parent_key.participant.as_deref().unwrap_or_default())
                    .unwrap_or_default();
        }
        let mut event = crate::types::events::Message {
            info,
            raw_message: web_message.message.clone(),
            source_web_msg: Some(web_message),
            ..Default::default()
        };
        event.unwrap_raw();
        if let Some(protocol_message) = event
            .message
            .as_ref()
            .and_then(|message| message.protocol_message.as_ref())
            && protocol_message.r#type
                == Some(crate::proto::wa_e2e::protocol_message::Type::MessageEdit as i32)
        {
            let edited_id = protocol_message
                .key
                .as_ref()
                .and_then(|key| key.id.clone())
                .unwrap_or_default();
            let edited = protocol_message.edited_message.as_deref().cloned();
            event.info.id = edited_id;
            event.message = edited;
        }
        Ok(event)
    }

    /// Stores a LID ↔ phone number mapping, in either order.
    pub async fn store_lid_pn_mapping(&self, first: &Jid, second: &Jid) {
        let (lid, pn) =
            if first.server == HIDDEN_USER_SERVER && second.server == DEFAULT_USER_SERVER {
                (first, second)
            } else if first.server == DEFAULT_USER_SERVER && second.server == HIDDEN_USER_SERVER {
                (second, first)
            } else {
                return;
            };
        let lids = Arc::clone(&self.store.read().await.lids);
        if let Err(error) = lids.put_lid_mapping(lid, pn).await {
            tracing::error!(error = %error, "failed to store LID-PN mapping");
        }
    }

    fn get_unified_session_id(&self) -> String {
        const UNIFIED_OFFSET_MILLIS: i64 = 3 * 24 * 60 * 60 * 1000;
        const WEEK_MILLIS: i64 = 7 * 24 * 60 * 60 * 1000;
        let offset_millis = self.server_time_offset.load(Ordering::SeqCst) / 1_000_000;
        let unified = Utc::now().timestamp_millis() + offset_millis + UNIFIED_OFFSET_MILLIS;
        (unified % WEEK_MILLIS).to_string()
    }

    pub(crate) async fn send_unified_session(&self) {
        let node = Node {
            tag: "ib".to_owned(),
            attrs: Attrs::new(),
            content: Some(NodeContent::Nodes(vec![Node {
                tag: "unified_session".to_owned(),
                attrs: Attrs::from([("id".to_owned(), self.get_unified_session_id().into())]),
                content: None,
            }])),
        };
        if let Err(error) = self.send_node(&node).await {
            tracing::debug!(error = %error, "failed to send unified_session telemetry");
        }
    }

    /// Records a successful login.
    pub(crate) fn mark_connect_success(&self) {
        *lock(&self.last_successful_connect) = Some(Utc::now());
        self.auto_reconnect_errors.store(0, Ordering::SeqCst);
        self.set_logged_in(true);
    }

    /// When the client last logged in successfully.
    pub fn last_successful_connect(&self) -> Option<DateTime<Utc>> {
        *lock(&self.last_successful_connect)
    }

    /// Wakes [`Client::wait_for_connection`] (Go's `closeSocketWaitChan`).
    pub(crate) fn close_socket_wait_chan(&self) {
        self.notify_socket_waiters();
    }

    /// Generates a request ID (`generateRequestID`).
    pub(crate) fn generate_request_id(&self) -> String {
        format!(
            "{}{}",
            self.unique_id,
            self.id_counter.fetch_add(1, Ordering::SeqCst) + 1
        )
    }

    pub(crate) fn response_waiters(
        &self,
    ) -> MutexGuard<'_, HashMap<String, oneshot::Sender<Node>>> {
        lock(&self.response_waiters)
    }

    /// Waits until prekeys were uploaded after pairing (Go's
    /// `PreKeysUploaded.Wait`).
    pub async fn wait_pre_keys_uploaded(&self) {
        self.pre_keys_uploaded.wait().await;
    }

    /// The app state processor for the device's current stores.
    pub(crate) fn app_state_processor(&self) -> Arc<crate::appstate::Processor> {
        Arc::clone(&lock(&self.app_state_proc))
    }

    /// Deletes the device from its container and points the app state
    /// processor at the (now failing) stores, so it doesn't keep using the
    /// deleted device's stores. Go builds the processor once and keeps it.
    pub(crate) async fn delete_device(&self) -> Result<(), StoreError> {
        let mut store = self.store.write().await;
        let result = store.delete().await;
        *lock(&self.app_state_proc) = Arc::new(crate::appstate::Processor::new(&store));
        result
    }

    /// Stops background work: disconnects and waits for the client's tasks.
    pub async fn shutdown(&self) {
        self.disconnect().await;
        self.background.cancel();
        self.tasks.close();
        self.tasks.wait().await;
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.background.cancel();
    }
}

/// The node waiters receive when the websocket disconnects.
pub(crate) fn xml_stream_end_node() -> Node {
    Node {
        tag: "xmlstreamend".to_owned(),
        ..Node::default()
    }
}

/// Network errors and some HTTP statuses are worth retrying.
fn is_retryable_connect_error(error: &ClientError) -> bool {
    match error {
        ClientError::Socket(SocketError::DialFailed { status_code, .. }) => match status_code {
            Some(code) => matches!(code, 408 | 500 | 501 | 502 | 503 | 504),
            None => true,
        },
        ClientError::Socket(_) => true,
        _ => false,
    }
}

#[cfg(test)]
pub(crate) mod test;
