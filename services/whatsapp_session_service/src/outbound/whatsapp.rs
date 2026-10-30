//! The account's WhatsApp connection: the encrypted Postgres device store,
//! a whatsmeow [`Client`], and the mapping between whatsmeow and the domain.

use std::sync::{Arc, Weak};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use external_chat::domain::models::{MediaKind, MediaShape};
use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use uuid::Uuid;
use whatsapp_linked::domain::events::{
    ChatUpdate, ClaimedSend, InboundEvent, MediaImport, MessageAnchor, OutboundMedia,
    OutgoingContent, SessionScope, Target,
};
use whatsapp_linked::domain::models::{GroupInfo, Identity, Participant};
use whatsapp_store_pg::kms::WhatsAppKms;
use whatsapp_store_pg::{PgWhatsAppStore, WhatsAppStoreError};
use whatsmeow::download::{DownloadError, MediaType};
use whatsmeow::proto::wa_e2e;
use whatsmeow::proto::wa_history_sync::Conversation;
use whatsmeow::proto::wa_history_sync::history_sync::HistorySyncType;
use whatsmeow::send::{SendRequestExtra, build_edit};
use whatsmeow::signal::CurveSignatures;
use whatsmeow::store::Device;
use whatsmeow::types::{Jid, MessageInfo, MessageSource, WebAuthnResponse};
use whatsmeow::{
    Client, ClientConfig, ClientError, Dialer, Event, EventHandler, QrChannelItem, Signal,
};

use crate::domain::ports::{
    DownloadFailure, InboundSink, SendFailure, SessionConnector, SessionError, SessionEvent,
    UploadedMedia, WhatsAppSession,
};
use events::{Mapped, MediaLocator};

pub mod events;
#[cfg(test)]
mod test;

/// Purpose of sealed media locators (see `PgWhatsAppStore::seal`).
const LOCATOR_PURPOSE: &str = "media-locator";

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> SessionError {
    SessionError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// Opens accounts' devices and clients.
pub struct WhatsmeowConnector<Kms> {
    pool: PgPool,
    kms: Kms,
    signal: Arc<dyn Signal>,
    dialer: Arc<dyn Dialer>,
    media_base_url: Option<String>,
    send_timeout: Duration,
}

impl<Kms: WhatsAppKms + 'static> WhatsmeowConnector<Kms> {
    /// `signal` is `whatsmeow_signal::libsignal()` in production; `dialer`
    /// and `media_base_url` point at WhatsApp, or at a fake server in tests.
    pub fn new(
        pool: PgPool,
        kms: Kms,
        signal: Arc<dyn Signal>,
        dialer: Arc<dyn Dialer>,
        media_base_url: Option<String>,
        send_timeout: Duration,
    ) -> Self {
        WhatsmeowConnector {
            pool,
            kms,
            signal,
            dialer,
            media_base_url,
            send_timeout,
        }
    }

    async fn open_store(&self, scope: SessionScope) -> Result<Arc<PgWhatsAppStore>, SessionError> {
        Ok(Arc::new(
            PgWhatsAppStore::open(
                self.pool.clone(),
                scope.account_id,
                scope.lease_epoch,
                &self.kms,
            )
            .await
            .map_err(store_error)?,
        ))
    }

    async fn load_device(&self, store: &Arc<PgWhatsAppStore>) -> Result<Device, SessionError> {
        store
            .load_device(&Signatures(self.signal.as_ref()))
            .await
            .map_err(store_error)
    }
}

fn store_error(error: WhatsAppStoreError) -> SessionError {
    match error {
        WhatsAppStoreError::Fenced => SessionError::Fenced,
        error if error.is_unreadable_device() => SessionError::DeviceUnreadable,
        WhatsAppStoreError::Kms(_) => SessionError::KmsUnavailable,
        error => internal(error),
    }
}

/// `load_device` takes a sized signer; the client's Signal is a trait object.
struct Signatures<'signal>(&'signal dyn Signal);

impl CurveSignatures for Signatures<'_> {
    fn calculate_signature(&self, private_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
        self.0.calculate_signature(private_key, message)
    }

    fn verify_signature(
        &self,
        public_key: &[u8; 32],
        message: &[u8],
        signature: &[u8; 64],
    ) -> bool {
        self.0.verify_signature(public_key, message, signature)
    }
}

impl<Kms: WhatsAppKms + 'static> SessionConnector for WhatsmeowConnector<Kms> {
    type Session = WhatsmeowSession;

    async fn open(
        &self,
        scope: SessionScope,
        fresh_device: bool,
        inbound: Arc<dyn InboundSink>,
    ) -> Result<(WhatsmeowSession, mpsc::UnboundedReceiver<SessionEvent>), SessionError> {
        if fresh_device {
            // Deleted before opening, so a device whose data key KMS no longer
            // unwraps is replaced too. Its data key and every stored value go
            // with the row; opening generates both anew.
            PgWhatsAppStore::reset_device(&self.pool, scope.account_id, scope.lease_epoch)
                .await
                .map_err(store_error)?;
        }
        let store = self.open_store(scope).await?;
        let device = self.load_device(&store).await?;
        self.start(scope, store, device, inbound)
    }
}

impl<Kms: WhatsAppKms + 'static> WhatsmeowConnector<Kms> {
    fn start(
        &self,
        scope: SessionScope,
        store: Arc<PgWhatsAppStore>,
        device: Device,
        inbound: Arc<dyn InboundSink>,
    ) -> Result<(WhatsmeowSession, mpsc::UnboundedReceiver<SessionEvent>), SessionError> {
        let client = Client::new(
            device,
            Arc::clone(&self.signal),
            ClientConfig {
                dialer: Arc::clone(&self.dialer),
                initial_auto_reconnect: true,
                // Group events are stored before their node is acknowledged.
                synchronous_ack: true,
                media_base_url: self.media_base_url.clone(),
                ..ClientConfig::default()
            },
        );
        let (sender, receiver) = mpsc::unbounded_channel();
        client.add_event_handler(Arc::new(Forwarder {
            account: scope.account_id,
            client: Arc::downgrade(&client),
            store: Arc::clone(&store),
            events: sender.clone(),
            inbound,
        }));
        Ok((
            WhatsmeowSession {
                client,
                store,
                events: sender,
                pairing: CancellationToken::new(),
                send_timeout: self.send_timeout,
            },
            receiver,
        ))
    }
}

/// Stores group events through the inbound sink before the client acks
/// them; passes everything else on without waiting. It never waits on the
/// runner, which may itself be waiting for a send's acknowledgement.
struct Forwarder {
    account: Uuid,
    /// The client this handler is registered on, to parse history messages.
    client: Weak<Client>,
    store: Arc<PgWhatsAppStore>,
    events: mpsc::UnboundedSender<SessionEvent>,
    inbound: Arc<dyn InboundSink>,
}

impl Forwarder {
    /// [`events::complete_addresses`]; `false` when the LID store failed, so
    /// the event is left unacknowledged and WhatsApp redelivers it.
    async fn complete_addresses(&self, event: &mut InboundEvent) -> bool {
        match events::complete_addresses(self.store.as_ref(), event).await {
            Ok(()) => true,
            Err(error) => {
                tracing::warn!(
                    account_id = %self.account,
                    error = %error,
                    "Reading the WhatsApp LID store failed; leaving the event unacknowledged"
                );
                false
            }
        }
    }

    fn seal(&self, locator: &MediaLocator) -> Option<Vec<u8>> {
        let plaintext = serde_json::to_vec(locator).ok()?;
        self.store
            .seal(LOCATOR_PURPOSE, &plaintext)
            .inspect_err(|error| tracing::warn!(error = %error, "Sealing a media locator failed"))
            .ok()
    }

    /// Chat-list updates go to the runner, by phone number and with
    /// address-book names where the stores know them.
    async fn chats(&self, mut chats: Vec<ChatUpdate>) {
        if chats.is_empty() {
            return;
        }
        events::complete_chats(self.store.as_ref(), self.store.as_ref(), &mut chats).await;
        let _ = self.events.send(SessionEvent::Chats(chats));
    }

    /// A history-sync bundle: the chat list (initial, recent, full and
    /// push-name syncs), or an answer to an on-demand request for a chat's
    /// earlier messages.
    async fn history_sync(&self, history: &whatsmeow::types::events::HistorySync) {
        let data = &history.data;
        let on_demand = data.sync_type == HistorySyncType::OnDemand as i32;
        let span = tracing::info_span!(
            "whatsapp.history.sync",
            account_id = %self.account,
            sync_type = data.sync_type,
            conversations = data.conversations.len(),
            chats = tracing::field::Empty,
        );
        async {
            if on_demand {
                for conversation in &data.conversations {
                    Box::pin(self.history_page(conversation)).await;
                }
                return;
            }
            let chats = events::history_chats(data);
            tracing::Span::current().record("chats", chats.len());
            self.chats(chats).await;
        }
        .instrument(span)
        .await;
    }

    /// Stores a page of a chat's earlier messages as history events, then
    /// reports the page. A page whose messages could not all be stored is not
    /// reported: the request times out and is asked again.
    async fn history_page(&self, conversation: &Conversation) {
        let Some(mut page) = events::history_page(conversation) else {
            return;
        };
        // Messages are read in the chat as the page names it; the page is
        // reported under the chat Macro knows (by phone number).
        let phone_chat = page.chat_jid.clone();
        page.chat_jid = events::macro_chat(self.store.as_ref(), &page.chat_jid).await;
        let Some(client) = self.client.upgrade() else {
            return;
        };
        let span = tracing::info_span!(
            "whatsapp.history.page",
            account_id = %self.account,
            messages = page.messages,
            complete = page.complete,
            stored = tracing::field::Empty,
            unreadable = tracing::field::Empty,
            skipped = tracing::field::Empty,
            skipped_stub_types = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        async {
            let Ok(chat) = phone_chat.parse::<Jid>() else {
                return;
            };
            let mut stored = 0usize;
            let mut unreadable: Vec<i32> = vec![];
            // Messages Macro does not import, by WhatsApp stub type (0: not
            // a stub), so a page that stores less than it got is explained.
            let mut skipped: Vec<i32> = vec![];
            let mut kept = true;
            for message in &conversation.messages {
                let Some(web) = message.message.clone() else {
                    continue;
                };
                let stub_type = web.message_stub_type.unwrap_or(0);
                let parsed = match Box::pin(client.parse_web_message(&chat, web)).await {
                    Ok(parsed) => parsed,
                    Err(error) => {
                        unreadable.push(stub_type);
                        tracing::debug!(error = %error, stub_type, "Skipping an unreadable history message");
                        continue;
                    }
                };
                let now = Utc::now();
                let Some(event) = events::map_history_message(
                    self.account,
                    &parsed,
                    now,
                    &|locator: &MediaLocator| self.seal(locator),
                ) else {
                    skipped.push(stub_type);
                    continue;
                };
                // The phone sends a poll's votes with it, already decrypted;
                // they apply after the poll.
                let votes = events::history_poll_votes(self.account, &parsed, now);
                let mut message_kept = true;
                for mut event in std::iter::once(event).chain(votes) {
                    message_kept &= self.complete_addresses(&mut event).await
                        && Box::pin(self.inbound.accept(&event)).await;
                }
                if message_kept {
                    stored += 1;
                } else {
                    kept = false;
                }
            }
            let span = tracing::Span::current();
            span.record("stored", stored);
            span.record("unreadable", unreadable.len());
            span.record("skipped", skipped.len());
            span.record("skipped_stub_types", format!("{skipped:?}"));
            tracing::info!(
                stored,
                unreadable = unreadable.len(),
                unreadable_stub_types = ?unreadable,
                skipped = skipped.len(),
                skipped_stub_types = ?skipped,
                "WhatsApp history page received"
            );
            if !kept {
                tracing::Span::current().record("outcome", "not_stored");
                tracing::warn!("A history page could not be stored; it will be requested again");
                return;
            }
            tracing::Span::current().record("outcome", "stored");
            let _ = self.events.send(SessionEvent::HistoryPage(page));
        }
        .instrument(span)
        .await;
    }
}

impl Forwarder {
    /// A poll vote, decrypted with the poll's message secret. `None` when the
    /// message is not a vote; a vote that cannot be decrypted (the poll was
    /// sent before this device saw it) is acknowledged and dropped.
    async fn poll_vote(&self, message: &whatsmeow::types::events::Message) -> Option<bool> {
        message.message.as_ref()?.poll_update_message.as_ref()?;
        let client = self.client.upgrade()?;
        let selected = match client.decrypt_poll_vote(message).await {
            Ok(vote) => vote.selected_options,
            Err(error) => {
                tracing::debug!(
                    name: "whatsapp.inbound.skipped",
                    account_id = %self.account,
                    reason = "undecryptable_poll_vote",
                    error = %error,
                    "Acknowledged a WhatsApp poll vote without storing it"
                );
                return Some(true);
            }
        };
        let Some(mut event) = events::map_poll_vote(self.account, message, &selected, Utc::now())
        else {
            return Some(true);
        };
        if !self.complete_addresses(&mut event).await {
            return Some(false);
        }
        Some(self.inbound.accept(&event).await)
    }
}

// Object safe (`Arc<dyn EventHandler>`), hence `async_trait`.
#[async_trait]
impl EventHandler for Forwarder {
    async fn handle(&self, event: &Event) -> bool {
        match event {
            // Boxed: these futures are large, and the handler runs nested
            // in the client's node handling.
            Event::HistorySync(history) => {
                Box::pin(self.history_sync(history)).await;
                return true;
            }
            Event::Message(message) => {
                Box::pin(self.chats(events::message_chat(message).into_iter().collect())).await;
            }
            event => {
                Box::pin(self.chats(events::chat_setting(event).into_iter().collect())).await;
            }
        }
        if let Event::Message(message) = event
            && let Some(vote) = Box::pin(self.poll_vote(message)).await
        {
            return vote;
        }
        let seal = |locator: &MediaLocator| self.seal(locator);
        let mapped = events::map_event(self.account, event, Utc::now(), &seal);
        if mapped.is_empty() && matches!(event, Event::Message(_)) {
            tracing::debug!(
                name: "whatsapp.inbound.skipped",
                account_id = %self.account,
                reason = "not_group_content",
                "Acknowledged a WhatsApp message without storing it"
            );
        }
        let mut stored = true;
        for mapped in mapped {
            match mapped {
                Mapped::Inbound(mut event) => {
                    stored &= self.complete_addresses(&mut event).await
                        && self.inbound.accept(&event).await;
                }
                Mapped::Session(event) => {
                    let _ = self.events.send(event);
                }
            }
        }
        stored
    }
}

/// One account's whatsmeow client.
pub struct WhatsmeowSession {
    client: Arc<Client>,
    store: Arc<PgWhatsAppStore>,
    events: mpsc::UnboundedSender<SessionEvent>,
    pairing: CancellationToken,
    send_timeout: Duration,
}

impl Drop for WhatsmeowSession {
    fn drop(&mut self) {
        self.pairing.cancel();
    }
}

fn parse_jid(jid: &str) -> Result<Jid, SendFailure> {
    jid.parse()
        .map_err(|_| SendFailure::Rejected("invalid_jid"))
}

fn rejected(error: &ClientError) -> Option<&'static str> {
    // Only errors raised before the message could reach WhatsApp are safe to
    // call rejected; anything else may have been delivered.
    match error {
        ClientError::NotConnected | ClientError::NotLoggedIn => Some("not_connected"),
        ClientError::NotInGroup | ClientError::GroupNotFound => Some("not_in_group"),
        ClientError::NoPermissionInGroup => Some("no_permission"),
        ClientError::RecipientAdJid
        | ClientError::BroadcastListUnsupported
        | ClientError::UnknownServer => Some("invalid_recipient"),
        ClientError::RecipientNotOnWhatsApp => Some("recipient_not_on_provider"),
        // Only the queries before the message (recipient lookups) are IQs.
        _ if error.is_iq_code(429) => Some("rate_limited"),
        _ => None,
    }
}

/// WhatsApp refused a group read because the account is not in the group
/// or the group is gone.
fn not_a_member(error: &ClientError) -> bool {
    match error {
        ClientError::NotInGroup | ClientError::GroupNotFound => true,
        ClientError::WrappedIq { human, .. } => not_a_member(human),
        _ => false,
    }
}

fn media_type(kind: MediaKind) -> MediaType {
    match kind {
        MediaKind::Image => MediaType::Image,
        MediaKind::Audio => MediaType::Audio,
        MediaKind::Video => MediaType::Video,
        MediaKind::Document => MediaType::Document,
    }
}

/// Whether a download can ever succeed after this error.
fn download_failure(error: &ClientError) -> DownloadFailure {
    let ClientError::Download(error) = error else {
        return DownloadFailure::Retryable;
    };
    match error.as_ref() {
        DownloadError::Http {
            status_code: 403 | 404 | 410,
            ..
        } => DownloadFailure::Permanent,
        DownloadError::Http { .. } => DownloadFailure::Retryable,
        _ => DownloadFailure::Permanent,
    }
}

/// The context a sent message carries: the quoted message, and the group's
/// disappearing timer so members' phones treat it like their own messages.
fn send_context(
    quote: Option<&Target>,
    expiration: Option<u32>,
) -> Option<Box<wa_e2e::ContextInfo>> {
    if quote.is_none() && expiration.is_none() {
        return None;
    }
    Some(Box::new(wa_e2e::ContextInfo {
        stanza_id: quote.map(|quote| quote.source_id.clone()),
        participant: quote.map(|quote| quote.sender_jid.clone()),
        expiration,
        ..Default::default()
    }))
}

/// The message part carrying an uploaded attachment.
fn media_message(
    kind: MediaKind,
    mime: &str,
    filename: &str,
    caption: Option<&str>,
    context_info: Option<Box<wa_e2e::ContextInfo>>,
    shape: MediaShape,
    uploaded: &UploadedMedia,
) -> wa_e2e::Message {
    let caption = caption.map(str::to_owned);
    let url = Some(uploaded.url.clone());
    let direct_path = Some(uploaded.direct_path.clone());
    let media_key = Some(uploaded.media_key.clone());
    let file_enc_sha256 = Some(uploaded.file_enc_sha256.clone());
    let file_sha256 = Some(uploaded.file_sha256.clone());
    let file_length = Some(uploaded.file_length);
    let mimetype = Some(mime.to_owned());
    match kind {
        MediaKind::Image => wa_e2e::Message {
            image_message: Some(Box::new(wa_e2e::ImageMessage {
                url,
                direct_path,
                media_key,
                file_enc_sha256,
                file_sha256,
                file_length,
                mimetype,
                caption,
                width: shape.width,
                height: shape.height,
                context_info,
                ..Default::default()
            })),
            ..Default::default()
        },
        MediaKind::Video => wa_e2e::Message {
            video_message: Some(Box::new(wa_e2e::VideoMessage {
                url,
                direct_path,
                media_key,
                file_enc_sha256,
                file_sha256,
                file_length,
                mimetype,
                caption,
                width: shape.width,
                height: shape.height,
                seconds: shape.duration_seconds,
                context_info,
                ..Default::default()
            })),
            ..Default::default()
        },
        // Audio has no caption.
        MediaKind::Audio => wa_e2e::Message {
            audio_message: Some(Box::new(wa_e2e::AudioMessage {
                url,
                direct_path,
                media_key,
                file_enc_sha256,
                file_sha256,
                file_length,
                mimetype,
                seconds: shape.duration_seconds,
                context_info,
                ..Default::default()
            })),
            ..Default::default()
        },
        MediaKind::Document => wa_e2e::Message {
            document_message: Some(Box::new(wa_e2e::DocumentMessage {
                url,
                direct_path,
                media_key,
                file_enc_sha256,
                file_sha256,
                file_length,
                mimetype,
                file_name: Some(filename.to_owned()),
                title: Some(filename.to_owned()),
                caption,
                context_info,
                ..Default::default()
            })),
            ..Default::default()
        },
    }
}

impl WhatsmeowSession {
    async fn outgoing(
        &self,
        chat: &Jid,
        content: &OutgoingContent,
        expiration: Option<u32>,
        media: Option<&UploadedMedia>,
    ) -> Result<wa_e2e::Message, SendFailure> {
        Ok(match content {
            OutgoingContent::Text {
                text,
                quote: None,
                mentions,
            } if mentions.is_empty() && expiration.is_none() => wa_e2e::Message {
                conversation: Some(text.clone()),
                ..Default::default()
            },
            OutgoingContent::Text {
                text,
                quote,
                mentions,
            } => {
                let mut context_info = send_context(quote.as_ref(), expiration).unwrap_or_default();
                context_info.mentioned_jid = mentions.clone();
                wa_e2e::Message {
                    extended_text_message: Some(Box::new(wa_e2e::ExtendedTextMessage {
                        text: Some(text.clone()),
                        context_info: Some(context_info),
                        ..Default::default()
                    })),
                    ..Default::default()
                }
            }
            OutgoingContent::Media {
                kind,
                mime,
                filename,
                caption,
                quote,
                shape,
            } => {
                let uploaded = media.ok_or(SendFailure::Rejected("media_not_uploaded"))?;
                media_message(
                    *kind,
                    mime,
                    filename,
                    caption.as_deref(),
                    send_context(quote.as_ref(), expiration),
                    *shape,
                    uploaded,
                )
            }
            OutgoingContent::Reaction { target, emoji } => {
                let sender = parse_jid(&target.sender_jid)?;
                self.client
                    .build_reaction(chat, &sender, &target.source_id, emoji)
                    .await
            }
            OutgoingContent::Edit { target, text } => build_edit(
                chat,
                &target.source_id,
                wa_e2e::Message {
                    conversation: Some(text.clone()),
                    ..Default::default()
                },
            ),
            OutgoingContent::Delete { target } => {
                self.client
                    .build_revoke(chat, &Jid::default(), &target.source_id)
                    .await
            }
        })
    }
}

/// The message an anchor names, as whatsmeow's request builders take it. Our
/// own messages have no sender (the key says from-me).
fn anchor_info(chat_jid: &str, anchor: &MessageAnchor) -> Result<MessageInfo, SessionError> {
    let invalid =
        |what: &str| SessionError::Internal(rootcause::report!("invalid {what}").into_dynamic());
    let chat: Jid = chat_jid.parse().map_err(|_| invalid("chat"))?;
    let sender = match (&anchor.sender_jid, anchor.from_me) {
        (Some(sender), false) => sender.parse().map_err(|_| invalid("sender"))?,
        _ => Jid::default(),
    };
    Ok(MessageInfo {
        source: MessageSource {
            is_group: chat.server == whatsmeow::types::GROUP_SERVER,
            chat,
            sender,
            is_from_me: anchor.from_me,
            ..MessageSource::default()
        },
        id: anchor.id.clone(),
        timestamp: Some(anchor.at),
        ..MessageInfo::default()
    })
}

fn group_info(group: whatsmeow::types::GroupInfo, observed_at: DateTime<Utc>) -> GroupInfo {
    GroupInfo {
        jid: group.jid.to_string(),
        name: group.name.name,
        participants: group
            .participants
            .iter()
            .map(|participant| {
                let (jid, alternate) = if participant.phone_number.is_empty() {
                    (&participant.jid, &participant.lid)
                } else {
                    (&participant.phone_number, &participant.lid)
                };
                Participant {
                    identity: Identity {
                        jid: jid.to_non_ad().to_string(),
                        alternate_jid: (!alternate.is_empty() && alternate != jid)
                            .then(|| alternate.to_non_ad().to_string()),
                        display_name: (!participant.display_name.is_empty())
                            .then(|| participant.display_name.clone()),
                    },
                    admin: participant.is_admin || participant.is_super_admin,
                }
            })
            .collect(),
        announce: group.announce.is_announce,
        // WhatsApp lists a group that turned disappearing messages off as
        // `<ephemeral expiration="0"/>`: only a timer means on.
        disappearing_seconds: (group.ephemeral.is_ephemeral
            && group.ephemeral.disappearing_timer > 0)
            .then_some(group.ephemeral.disappearing_timer),
        community_parent: group.parent.is_parent,
        community_jid: (!group.parent.is_parent
            && !group.linked_parent.linked_parent_jid.is_empty())
        .then(|| {
            group
                .linked_parent
                .linked_parent_jid
                .to_non_ad()
                .to_string()
        }),
        community_announcements: !group.parent.is_parent
            && !group.linked_parent.linked_parent_jid.is_empty()
            && group.is_default_sub.is_default_sub_group,
        observed_at,
    }
}

impl WhatsAppSession for WhatsmeowSession {
    async fn identity_jid(&self) -> Option<String> {
        let own = self.client.get_own_id().await;
        (!own.is_empty()).then(|| own.to_non_ad().to_string())
    }

    async fn start_pairing(&self) -> Result<(), SessionError> {
        let mut codes = self
            .client
            .get_qr_channel(self.pairing.clone())
            .await
            .map_err(internal)?;
        let events = self.events.clone();
        tokio::spawn(async move {
            while let Some(item) = codes.recv().await {
                let event = match item {
                    QrChannelItem::Code { code, .. } => SessionEvent::Qr(code),
                    QrChannelItem::Timeout => SessionEvent::PairExpired,
                    QrChannelItem::Error(_)
                    | QrChannelItem::ErrUnexpectedEvent
                    | QrChannelItem::ClientOutdated
                    | QrChannelItem::ScannedWithoutMultidevice => SessionEvent::PairFailed,
                    // Success and passkey steps arrive as client events.
                    _ => continue,
                };
                if events.send(event).is_err() {
                    return;
                }
            }
        });
        Ok(())
    }

    async fn send_passkey_response(&self, response: serde_json::Value) -> Result<(), SessionError> {
        let response: WebAuthnResponse = serde_json::from_value(response).map_err(internal)?;
        self.client
            .send_passkey_response(&response)
            .await
            .map_err(internal)
    }

    async fn confirm_passkey(&self) -> Result<(), SessionError> {
        self.client
            .send_passkey_confirmation()
            .await
            .map_err(internal)
    }

    async fn connect(&self) -> Result<(), SessionError> {
        self.client.connect().await.map_err(internal)
    }

    async fn new_message_id(&self) -> String {
        self.client.generate_message_id().await
    }

    async fn upload_media(&self, media: &OutboundMedia) -> Result<UploadedMedia, SendFailure> {
        // Boxed: the client's media futures are large enough to overflow a
        // 2 MiB stack when nested in the runner's future.
        let uploaded = Box::pin(self.client.upload(&media.bytes, media_type(media.kind)))
            .await
            .map_err(|error| {
                tracing::warn!(error = %error, "Uploading a WhatsApp attachment failed");
                SendFailure::Rejected("media_upload_failed")
            })?;
        Ok(UploadedMedia {
            url: uploaded.url,
            direct_path: uploaded.direct_path,
            media_key: uploaded.media_key,
            file_enc_sha256: uploaded.file_enc_sha256,
            file_sha256: uploaded.file_sha256,
            file_length: uploaded.file_length,
        })
    }

    async fn send(
        &self,
        send: &ClaimedSend,
        message_id: &str,
        media: Option<&UploadedMedia>,
    ) -> Result<DateTime<Utc>, SendFailure> {
        let chat = parse_jid(&send.group_jid)?;
        let message = self
            .outgoing(&chat, &send.content, send.disappearing_seconds, media)
            .await?;
        let response = Box::pin(self.client.send_message(
            &chat,
            message,
            SendRequestExtra {
                id: message_id.to_owned(),
                timeout: Some(self.send_timeout),
                // A send cut off by a disconnect is unknown, never resent.
                no_disconnect_retry: true,
                ..SendRequestExtra::default()
            },
        ))
        .await
        .map_err(|error| match rejected(&error) {
            Some(code) => SendFailure::Rejected(code),
            None => SendFailure::Unknown,
        })?;
        Ok(response.timestamp.unwrap_or_else(Utc::now))
    }

    async fn download_media(&self, import: &MediaImport) -> Result<Vec<u8>, DownloadFailure> {
        let plaintext = self
            .store
            .unseal(LOCATOR_PURPOSE, &import.locator)
            .map_err(|_| DownloadFailure::Permanent)?;
        let locator: MediaLocator =
            serde_json::from_slice(&plaintext).map_err(|_| DownloadFailure::Permanent)?;
        Box::pin(self.client.download_media_with_path(
            &locator.direct_path,
            Some(&locator.file_enc_sha256),
            Some(&locator.file_sha256),
            Some(&locator.media_key),
            Some(locator.media_type.media_type()),
            "",
            false,
        ))
        .await
            .map_err(|error| {
                let failure = download_failure(&error);
                tracing::warn!(error = %error, failure = ?failure, "Downloading a WhatsApp attachment failed");
                failure
            })
    }

    async fn joined_groups(&self) -> Result<Vec<GroupInfo>, SessionError> {
        let observed_at = Utc::now();
        let groups = self.client.get_joined_groups().await.map_err(internal)?;
        Ok(groups
            .into_iter()
            .map(|group| group_info(group, observed_at))
            .collect())
    }

    async fn group(&self, group_jid: &str) -> Result<Option<GroupInfo>, SessionError> {
        // The parse error repeats the JID; keep it out of logs.
        let jid: Jid = group_jid.parse().map_err(|_| {
            SessionError::Internal(rootcause::report!("invalid group JID").into_dynamic())
        })?;
        match self.client.get_group_info(&jid).await {
            Ok(group) => Ok(Some(group_info(group, Utc::now()))),
            Err(error) if not_a_member(&error) => Ok(None),
            Err(error) => Err(internal(error)),
        }
    }

    async fn request_history(
        &self,
        chat_jid: &str,
        before: &MessageAnchor,
        count: u32,
    ) -> Result<(), SessionError> {
        let mut info = anchor_info(chat_jid, before)?;
        info.source.chat = events::phone_chat(self.store.as_ref(), info.source.chat.clone()).await;
        let request = self
            .client
            .build_history_sync_request(&info, i32::try_from(count).unwrap_or(i32::MAX));
        Box::pin(self.client.send_peer_message(request))
            .await
            .map(|_| ())
            .map_err(internal)
    }

    async fn request_message(
        &self,
        chat_jid: &str,
        message: &MessageAnchor,
    ) -> Result<(), SessionError> {
        let mut info = anchor_info(chat_jid, message)?;
        info.source.chat = events::phone_chat(self.store.as_ref(), info.source.chat.clone()).await;
        let request =
            self.client
                .build_unavailable_message_request(&info.chat, &info.sender, &info.id);
        Box::pin(self.client.send_peer_message(request))
            .await
            .map(|_| ())
            .map_err(internal)
    }

    async fn logout(&self) {
        if let Err(error) = self.client.logout().await {
            tracing::warn!(error = %error, "Logging the WhatsApp device out failed");
        }
    }

    async fn disconnect(&self) {
        self.pairing.cancel();
        self.client.disconnect().await;
    }
}
