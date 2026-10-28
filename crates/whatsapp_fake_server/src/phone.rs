//! Fake phones: the primary device (device 0) of each fake user, played in
//! process with real Signal sessions and sender keys from `whatsmeow_signal`.
//!
//! A phone sends and receives like any WhatsApp device: it fetches prekey
//! bundles from the server, encrypts per device, distributes sender keys in
//! groups, decrypts what it receives and sends delivery receipts. It also
//! approves pairing QR codes, like scanning one in "Linked devices".

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use nom::IResult;
use nom::Parser;
use nom::bytes::complete::{is_not, tag, take_until};
use nom::multi::separated_list1;
use prost::Message as _;
use tokio::sync::oneshot;
use whatsmeow::binary::Node;
use whatsmeow::download::{DownloadError, MediaHttpClient, MediaType, download};
use whatsmeow::mediaconn::{MediaConn, MediaConnHost};
use whatsmeow::pair::ADV_ACCOUNT_SIGNATURE_PREFIX;
use whatsmeow::proto::wa_adv::{
    AdvDeviceIdentity, AdvSignedDeviceIdentity, AdvSignedDeviceIdentityHmac,
};
use whatsmeow::proto::wa_e2e::{
    DeviceSentMessage, ImageMessage, Message, SenderKeyDistributionMessage,
};
use whatsmeow::signal::{
    CiphertextType, CurveSignatures, SenderKeyName, SignalAddress, SignalProtocol,
    SignalProtocolStore,
};
use whatsmeow::store::Device;
use whatsmeow::types::{GROUP_SERVER, Jid, SERVER_JID};
use whatsmeow::upload::upload;
use whatsmeow_signal::{LibsignalCurveSignatures, LibsignalProtocol};

use crate::connection::adv_hmac;
use crate::stanza::{
    attr_jid, attr_string, bytes, children, content_bytes, jid, node, now, random_id, text,
};
use crate::state::{DeviceAddress, PendingPair, device_jid, group_jid};
use crate::{PairError, SendError, Shared};

/// How long a phone waits for the client to sign a pair-success.
const PAIR_CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(30);

/// A message a phone received and decrypted.
#[derive(Clone, Debug)]
pub struct ReceivedMessage {
    /// The message ID.
    pub id: String,
    /// The chat: the group, or the other user in a direct chat.
    pub chat: Jid,
    /// The sending device, as a LID device JID.
    pub sender: Jid,
    /// The sending user's phone number JID.
    pub sender_phone: Jid,
    /// The decrypted message.
    pub message: Message,
}

impl ReceivedMessage {
    /// The message text, for plain and extended text messages.
    pub fn text(&self) -> Option<&str> {
        self.message.conversation.as_deref().or_else(|| {
            self.message
                .extended_text_message
                .as_ref()
                .and_then(|extended| extended.text.as_deref())
        })
    }
}

/// A receipt a phone received for a message it sent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceivedReceipt {
    /// The message ID.
    pub id: String,
    /// The device that sent the receipt.
    pub from: Jid,
    /// The receipt type; empty for delivery receipts.
    pub receipt_type: String,
}

#[derive(Default)]
pub(crate) struct Inbox {
    pub(crate) messages: Vec<ReceivedMessage>,
    pub(crate) receipts: Vec<ReceivedReceipt>,
    /// Why stanzas failed to decrypt, for test diagnostics.
    pub(crate) failures: Vec<String>,
}

/// One fake user's phone.
pub(crate) struct PhoneCore {
    pub(crate) phone: String,
    pub(crate) lid: String,
    pub(crate) device: Device,
    signal: LibsignalProtocol,
    /// Serializes Signal operations, like whatsmeow's send lock.
    crypto: tokio::sync::Mutex<()>,
    pub(crate) inbox: Mutex<Inbox>,
}

impl PhoneCore {
    pub(crate) fn new(phone: String, lid: String, device: Device) -> PhoneCore {
        PhoneCore {
            phone,
            lid,
            device,
            signal: LibsignalProtocol::new(),
            crypto: tokio::sync::Mutex::new(()),
            inbox: Mutex::new(Inbox::default()),
        }
    }

    fn inbox(&self) -> std::sync::MutexGuard<'_, Inbox> {
        self.inbox.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn address(&self) -> DeviceAddress {
        DeviceAddress {
            phone: self.phone.clone(),
            device: 0,
        }
    }

    fn own_lid(&self) -> Jid {
        device_jid(&self.lid, 0, true)
    }
}

/// A fake user's phone. Cheap to clone.
#[derive(Clone)]
pub struct FakePhone {
    pub(crate) shared: Arc<Shared>,
    pub(crate) core: Arc<PhoneCore>,
}

impl FakePhone {
    /// The user's phone number JID (`<phone>@s.whatsapp.net`).
    pub fn jid(&self) -> Jid {
        device_jid(&self.core.phone, 0, false)
    }

    /// The user's LID JID (`<lid>@lid`).
    pub fn lid(&self) -> Jid {
        self.core.own_lid()
    }

    /// The phone number.
    pub fn phone(&self) -> &str {
        &self.core.phone
    }

    /// Every message the phone received so far.
    pub fn received(&self) -> Vec<ReceivedMessage> {
        self.core.inbox().messages.clone()
    }

    /// Every receipt the phone received so far.
    pub fn receipts(&self) -> Vec<ReceivedReceipt> {
        self.core.inbox().receipts.clone()
    }

    /// Why received stanzas failed to decrypt, if any did.
    pub fn failures(&self) -> Vec<String> {
        self.core.inbox().failures.clone()
    }

    /// Waits until the phone received a message matching `predicate`.
    pub async fn wait_for_message(
        &self,
        timeout: Duration,
        predicate: impl Fn(&ReceivedMessage) -> bool,
    ) -> Option<ReceivedMessage> {
        let core = Arc::clone(&self.core);
        self.shared
            .wait_for(timeout, move || {
                core.inbox()
                    .messages
                    .iter()
                    .find(|message| predicate(message))
                    .cloned()
            })
            .await
    }

    /// Waits until the phone received a receipt matching `predicate`.
    pub async fn wait_for_receipt(
        &self,
        timeout: Duration,
        predicate: impl Fn(&ReceivedReceipt) -> bool,
    ) -> Option<ReceivedReceipt> {
        let core = Arc::clone(&self.core);
        self.shared
            .wait_for(timeout, move || {
                core.inbox()
                    .receipts
                    .iter()
                    .find(|receipt| predicate(receipt))
                    .cloned()
            })
            .await
    }

    /// Sends a text message to a group or user; returns its ID.
    pub async fn send_text(&self, chat: &Jid, text: &str) -> Result<String, SendError> {
        self.send_message(
            chat,
            Message {
                conversation: Some(text.to_owned()),
                ..Message::default()
            },
        )
        .await
    }

    /// Uploads an image to the media host and sends it with a caption to a
    /// group or user; returns the message ID.
    pub async fn send_image(
        &self,
        chat: &Jid,
        image: &[u8],
        caption: &str,
    ) -> Result<String, SendError> {
        let uploaded = upload(
            &self.media_http(),
            &self.media_conn(),
            image,
            MediaType::Image,
        )
        .await
        .map_err(SendError::Upload)?;
        let message = Message {
            image_message: Some(Box::new(ImageMessage {
                url: Some(uploaded.url),
                direct_path: Some(uploaded.direct_path),
                media_key: Some(uploaded.media_key),
                file_enc_sha256: Some(uploaded.file_enc_sha256),
                file_sha256: Some(uploaded.file_sha256),
                file_length: Some(uploaded.file_length),
                mimetype: Some("image/jpeg".to_owned()),
                caption: Some(caption.to_owned()),
                ..ImageMessage::default()
            })),
            ..Message::default()
        };
        self.send_message(chat, message).await
    }

    /// Downloads and decrypts the image of a received message.
    pub async fn download_image(
        &self,
        received: &ReceivedMessage,
    ) -> Result<Vec<u8>, DownloadError> {
        let image = received
            .message
            .image_message
            .as_deref()
            .ok_or(DownloadError::NoUrlPresent)?;
        download(&self.media_http(), &self.media_conn(), image).await
    }

    fn media_http(&self) -> MediaHttpClient {
        MediaHttpClient::new(reqwest::Client::new(), String::new(), false)
            .with_base_url(&format!("http://{}", self.shared.media_host()))
    }

    fn media_conn(&self) -> MediaConn {
        MediaConn {
            auth: "fake-media-auth".to_owned(),
            auth_ttl: 21_600,
            ttl: 300,
            max_buckets: 12,
            fetched_at: chrono::Utc::now(),
            hosts: vec![MediaConnHost {
                hostname: self.shared.media_host(),
            }],
        }
    }

    /// Sends a message to a group or user; returns its ID.
    #[tracing::instrument(name = "fake_whatsapp.phone_send", skip_all, err)]
    pub async fn send_message(&self, chat: &Jid, message: Message) -> Result<String, SendError> {
        let id = random_id();
        let _crypto = self.core.crypto.lock().await;
        let stanza = if chat.server == GROUP_SERVER {
            self.group_stanza(chat, &id, &message).await?
        } else {
            self.direct_stanza(chat, &id, &message).await?
        };
        let ack = self
            .shared
            .lock()
            .route_message(&self.core.address(), &stanza);
        self.shared.changed();
        match attr_string(&ack, "error").as_str() {
            "" => Ok(id),
            code => Err(SendError::Rejected(code.to_owned())),
        }
    }

    async fn group_stanza(
        &self,
        chat: &Jid,
        id: &str,
        message: &Message,
    ) -> Result<Node, SendError> {
        let targets = {
            let state = self.shared.lock();
            let group = state.groups.get(&chat.user).ok_or(SendError::UnknownChat)?;
            if !group.members.contains(&self.core.phone) {
                return Err(SendError::NotInGroup);
            }
            let mut targets = Vec::new();
            for member in &group.members {
                if let Some(user) = state.users.get(member) {
                    for device in user.devices.keys() {
                        let address = DeviceAddress {
                            phone: member.clone(),
                            device: *device,
                        };
                        if address != self.core.address() {
                            targets.push(state.jid_of(&address, true));
                        }
                    }
                }
            }
            targets
        };
        let store = self.core.device.signal_store(None);
        let name = SenderKeyName {
            group_id: chat.to_string(),
            sender: self.core.own_lid().signal_address(),
        };
        let distribution = self
            .core
            .signal
            .create_sender_key_distribution_message(&store, &name)
            .await
            .map_err(SendError::signal)?;
        let distribution_plaintext = Message {
            sender_key_distribution_message: Some(SenderKeyDistributionMessage {
                group_id: Some(chat.to_string()),
                axolotl_sender_key_distribution_message: Some(distribution),
            }),
            ..Message::default()
        }
        .encode_to_vec();
        let mut participants = Vec::new();
        for target in targets {
            participants.extend(
                self.encrypt_for(&store, &target, &distribution_plaintext)
                    .await?,
            );
        }
        let group_ciphertext = self
            .core
            .signal
            .group_encrypt(&store, &name, &pad(&message.encode_to_vec()))
            .await
            .map_err(SendError::signal)?;
        Ok(node(
            "message",
            vec![
                ("id", text(id)),
                ("to", jid(chat)),
                ("type", text(message_type(message))),
            ],
            children(vec![
                node("participants", vec![], children(participants)),
                node(
                    "enc",
                    vec![("v", text("2")), ("type", text("skmsg"))],
                    bytes(group_ciphertext),
                ),
            ]),
        ))
    }

    async fn direct_stanza(
        &self,
        chat: &Jid,
        id: &str,
        message: &Message,
    ) -> Result<Node, SendError> {
        let (recipient, targets) = {
            let state = self.shared.lock();
            let phone = state.phone_of(chat).ok_or(SendError::UnknownChat)?;
            let mut targets = Vec::new();
            for user in [&phone, &self.core.phone] {
                if let Some(record) = state.users.get(user) {
                    for device in record.devices.keys() {
                        let address = DeviceAddress {
                            phone: user.clone(),
                            device: *device,
                        };
                        if address != self.core.address() {
                            targets.push((user == &self.core.phone, state.jid_of(&address, true)));
                        }
                    }
                }
            }
            let lid = state
                .users
                .get(&phone)
                .map(|user| user.lid.clone())
                .unwrap_or_default();
            (device_jid(&lid, 0, true), targets)
        };
        let plaintext = message.encode_to_vec();
        let own_plaintext = Message {
            device_sent_message: Some(Box::new(DeviceSentMessage {
                destination_jid: Some(recipient.to_string()),
                message: Some(Box::new(message.clone())),
                phash: None,
            })),
            ..Message::default()
        }
        .encode_to_vec();
        let store = self.core.device.signal_store(None);
        let mut participants = Vec::new();
        for (own, target) in targets {
            let plaintext = if own { &own_plaintext } else { &plaintext };
            participants.extend(self.encrypt_for(&store, &target, plaintext).await?);
        }
        Ok(node(
            "message",
            vec![
                ("id", text(id)),
                ("to", jid(&recipient)),
                ("type", text(message_type(message))),
            ],
            children(vec![node("participants", vec![], children(participants))]),
        ))
    }

    /// `<to jid><enc/></to>` for one device, starting a session from a
    /// prekey bundle if there is none. `None` when the device has no keys.
    async fn encrypt_for(
        &self,
        store: &dyn SignalProtocolStore,
        target: &Jid,
        plaintext: &[u8],
    ) -> Result<Option<Node>, SendError> {
        let address = target.signal_address();
        if !store
            .contains_session(&address)
            .await
            .map_err(SendError::store)?
        {
            let bundle_node = self.shared.lock().pre_key_bundle_node(target);
            let Ok(bundle) =
                whatsmeow::prekeys::node_to_pre_key_bundle(u32::from(target.device), &bundle_node)
            else {
                tracing::warn!("fake phone found no prekeys for a device, skipping it");
                return Ok(None);
            };
            self.core
                .signal
                .process_bundle(store, &address, &bundle)
                .await
                .map_err(SendError::signal)?;
        }
        let ciphertext = self
            .core
            .signal
            .encrypt(store, &address, &pad(plaintext))
            .await
            .map_err(SendError::signal)?;
        let enc_type = match ciphertext.kind {
            CiphertextType::PreKey => "pkmsg",
            CiphertextType::Whisper => "msg",
        };
        Ok(Some(node(
            "to",
            vec![("jid", jid(target))],
            children(vec![node(
                "enc",
                vec![("v", text("2")), ("type", text(enc_type))],
                bytes(ciphertext.serialized),
            )]),
        )))
    }

    /// Approves a pairing QR code shown by a client, like scanning it in
    /// "Linked devices". Returns the new device's JID once the client
    /// signed the pairing; the client then reconnects and logs in.
    #[tracing::instrument(name = "fake_whatsapp.scan_qr", skip_all, err)]
    pub async fn scan_qr(&self, qr: &str) -> Result<Jid, PairError> {
        let fields = parse_qr(qr).ok_or(PairError::MalformedQr)?;
        let (reference, noise, identity, adv_secret) =
            (&fields[0], &fields[1], &fields[2], &fields[3]);
        let noise_key: [u8; 32] = decode_key(noise)?;
        let identity_key: [u8; 32] = decode_key(identity)?;
        let adv_secret = STANDARD
            .decode(adv_secret)
            .map_err(|_| PairError::MalformedQr)?;

        let (reply, confirmation) = oneshot::channel();
        {
            let mut state = self.shared.lock();
            let connection = *state
                .pairing_refs
                .get(reference)
                .ok_or(PairError::UnknownQr)?;
            let user = state
                .users
                .get_mut(&self.core.phone)
                .ok_or(PairError::UnknownQr)?;
            user.next_device += 1;
            let device = user.next_device;
            let account = user.account.clone();
            let lid = user.lid.clone();
            let details = AdvDeviceIdentity {
                raw_id: Some(rand::random()),
                timestamp: Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|elapsed| elapsed.as_secs())
                        .unwrap_or_default(),
                ),
                key_index: Some(u32::from(device)),
                ..AdvDeviceIdentity::default()
            }
            .encode_to_vec();
            let account_message =
                [&ADV_ACCOUNT_SIGNATURE_PREFIX[..], &details, &identity_key].concat();
            let signed = AdvSignedDeviceIdentity {
                details: Some(details.clone()),
                account_signature_key: Some(account.public.to_vec()),
                account_signature: Some(
                    LibsignalCurveSignatures::new()
                        .calculate_signature(&account.private, &account_message)
                        .to_vec(),
                ),
                device_signature: None,
            }
            .encode_to_vec();
            let container = AdvSignedDeviceIdentityHmac {
                hmac: Some(adv_hmac(&adv_secret, &signed)),
                details: Some(signed),
                account_type: None,
            }
            .encode_to_vec();
            let iq_id = random_id();
            let pair_success = node(
                "iq",
                vec![
                    ("from", jid(&SERVER_JID)),
                    ("id", text(&iq_id)),
                    ("type", text("set")),
                    ("xmlns", text("md")),
                    ("t", now()),
                ],
                children(vec![node(
                    "pair-success",
                    vec![],
                    children(vec![
                        node("device-identity", vec![], bytes(container)),
                        node(
                            "device",
                            vec![
                                ("jid", jid(&device_jid(&self.core.phone, device, false))),
                                ("lid", jid(&device_jid(&lid, device, true))),
                            ],
                            None,
                        ),
                        node("platform", vec![("name", text("android"))], None),
                    ]),
                )]),
            );
            state.pending_pairs.insert(
                iq_id,
                PendingPair {
                    connection,
                    address: DeviceAddress {
                        phone: self.core.phone.clone(),
                        device,
                    },
                    noise_key,
                    identity_key,
                    account_public: account.public,
                    details,
                    reply,
                },
            );
            state.send(connection, pair_success);
        }
        match tokio::time::timeout(PAIR_CONFIRMATION_TIMEOUT, confirmation).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) | Err(_) => Err(PairError::NoConfirmation),
        }
    }

    /// Handles one node delivered to the phone.
    pub(crate) async fn handle(&self, delivered: Node) {
        match delivered.tag.as_str() {
            "message" => self.receive_message(&delivered).await,
            "receipt" => {
                let receipt = ReceivedReceipt {
                    id: attr_string(&delivered, "id"),
                    from: attr_jid(&delivered, "participant")
                        .or_else(|| attr_jid(&delivered, "from"))
                        .unwrap_or_default(),
                    receipt_type: attr_string(&delivered, "type"),
                };
                self.core.inbox().receipts.push(receipt);
            }
            _ => {}
        }
        self.shared.changed();
    }

    async fn receive_message(&self, stanza: &Node) {
        let from = attr_jid(stanza, "from").unwrap_or_default();
        let group = from.server == GROUP_SERVER;
        let sender_jid = if group {
            attr_jid(stanza, "participant").unwrap_or_default()
        } else {
            from.clone()
        };
        let (sender, sender_phone) = {
            let state = self.shared.lock();
            match state.resolve(&sender_jid) {
                Some(address) => (
                    state.jid_of(&address, true),
                    device_jid(&address.phone, 0, false),
                ),
                None => {
                    drop(state);
                    self.fail("message from an unknown device");
                    return;
                }
            }
        };
        let id = attr_string(stanza, "id");
        let sender_address = sender.signal_address();
        let _crypto = self.core.crypto.lock().await;
        let store = self.core.device.signal_store(None);
        for enc in stanza
            .get_children()
            .iter()
            .filter(|child| child.tag == "enc")
        {
            let Some(ciphertext) = content_bytes(enc) else {
                continue;
            };
            let decrypted = match attr_string(enc, "type").as_str() {
                "pkmsg" => {
                    self.core
                        .signal
                        .decrypt_pre_key_message(&store, &sender_address, ciphertext)
                        .await
                }
                "msg" => {
                    self.core
                        .signal
                        .decrypt_message(&store, &sender_address, ciphertext)
                        .await
                }
                "skmsg" if group => {
                    let name = SenderKeyName {
                        group_id: from.to_string(),
                        sender: sender_address.clone(),
                    };
                    self.core
                        .signal
                        .group_decrypt(&store, &name, ciphertext)
                        .await
                }
                _ => continue,
            };
            let plaintext = match decrypted {
                Ok(plaintext) => plaintext,
                Err(error) => {
                    self.fail(&format!("decrypting {}: {error}", attr_string(enc, "type")));
                    continue;
                }
            };
            let Some(message) = unpad(&plaintext).and_then(|data| Message::decode(data).ok())
            else {
                self.fail("undecodable plaintext");
                continue;
            };
            self.process_message(
                &store,
                &id,
                &from,
                &sender,
                &sender_phone,
                &sender_address,
                message,
            )
            .await;
        }
        drop(_crypto);
        let mut receipt_attrs = vec![("id", text(&id)), ("to", jid(&from))];
        if group {
            receipt_attrs.push(("participant", jid(&sender_jid)));
        }
        let receipt = node("receipt", receipt_attrs, None);
        self.shared
            .lock()
            .route_receipt(&self.core.address(), &receipt);
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "the parts of one received stanza"
    )]
    async fn process_message(
        &self,
        store: &dyn SignalProtocolStore,
        id: &str,
        from: &Jid,
        sender: &Jid,
        sender_phone: &Jid,
        sender_address: &SignalAddress,
        mut message: Message,
    ) {
        if let Some(distribution) = message.sender_key_distribution_message.take() {
            let group_id = distribution.group_id.unwrap_or_else(|| from.to_string());
            let name = SenderKeyName {
                group_id,
                sender: sender_address.clone(),
            };
            let result = self
                .core
                .signal
                .process_sender_key_distribution_message(
                    store,
                    &name,
                    &distribution
                        .axolotl_sender_key_distribution_message
                        .unwrap_or_default(),
                )
                .await;
            if let Err(error) = result {
                self.fail(&format!("processing a sender key: {error}"));
            }
        }
        let mut chat = if from.server == GROUP_SERVER {
            group_jid(&from.user)
        } else {
            from.to_non_ad()
        };
        if let Some(sent) = message.device_sent_message.take() {
            if let Some(destination) = sent
                .destination_jid
                .and_then(|destination| whatsmeow::types::parse_jid(&destination).ok())
            {
                chat = destination;
            }
            message = sent.message.map(|inner| *inner).unwrap_or_default();
        }
        if message == Message::default() {
            return;
        }
        self.core.inbox().messages.push(ReceivedMessage {
            id: id.to_owned(),
            chat,
            sender: sender.clone(),
            sender_phone: sender_phone.clone(),
            message,
        });
    }

    fn fail(&self, reason: &str) {
        tracing::warn!(reason, "fake phone failed to process a stanza");
        self.core.inbox().failures.push(reason.to_owned());
    }
}

/// The message type attribute whatsmeow sends.
fn message_type(message: &Message) -> &'static str {
    if message.reaction_message.is_some() {
        "reaction"
    } else if message.conversation.is_some() || message.extended_text_message.is_some() {
        "text"
    } else {
        "media"
    }
}

/// whatsmeow's padding: 1–15 bytes, each holding the padding length.
fn pad(plaintext: &[u8]) -> Vec<u8> {
    let mut length = rand::random::<u8>() & 0x0f;
    if length == 0 {
        length = 0x0f;
    }
    let mut padded = plaintext.to_vec();
    padded.extend(std::iter::repeat_n(length, usize::from(length)));
    padded
}

fn unpad(plaintext: &[u8]) -> Option<&[u8]> {
    let length = usize::from(*plaintext.last()?);
    plaintext.get(..plaintext.len().checked_sub(length)?)
}

fn decode_key(value: &str) -> Result<[u8; 32], PairError> {
    STANDARD
        .decode(value)
        .ok()
        .and_then(|key| key.try_into().ok())
        .ok_or(PairError::MalformedQr)
}

/// The comma-separated fields after the `#` of a pairing QR link:
/// ref, noise key, identity key, ADV secret, client type.
fn parse_qr(qr: &str) -> Option<Vec<String>> {
    fn fields(input: &str) -> IResult<&str, Vec<&str>> {
        let (input, _) = (take_until("#"), tag("#")).parse(input)?;
        separated_list1(tag(","), is_not(",")).parse(input)
    }
    let (_, fields) = fields(qr).ok()?;
    (fields.len() >= 4).then(|| fields.into_iter().map(str::to_owned).collect())
}
