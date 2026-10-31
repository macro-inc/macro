//! The real whatsmeow `Client` running on [`Libsignal`] against the fake
//! WhatsApp server, whose phones run their own Signal sessions: direct and
//! group messages, both directions.
//!
//! The fake server signs its noise certificate with a test root key instead
//! of WhatsApp's, so [`TestRoot`] wraps [`Libsignal`] and checks signatures
//! by WhatsApp's root key against the test root. Every other call goes to
//! [`Libsignal`] unchanged.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use whatsapp_fake_server::{FakePhone, FakeWhatsApp, test_root_key};
use whatsmeow::handshake::WA_CERT_PUB_KEY;
use whatsmeow::proto::wa_e2e::Message;
use whatsmeow::signal::{
    CiphertextMessage, CurveSignatures, PreKeyBundle, SenderKeyName, SignalAddress, SignalError,
    SignalProtocol, SignalProtocolStore,
};
use whatsmeow::store::MemoryStore;
use whatsmeow::types::Jid;
use whatsmeow::{Client, ClientConfig, Event, QrChannelItem};
use whatsmeow_signal::Libsignal;

const TIMEOUT: Duration = Duration::from_secs(20);

struct TestRoot {
    libsignal: Libsignal,
    root_public: [u8; 32],
}

impl CurveSignatures for TestRoot {
    fn calculate_signature(&self, private_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
        self.libsignal.calculate_signature(private_key, message)
    }

    fn verify_signature(
        &self,
        public_key: &[u8; 32],
        message: &[u8],
        signature: &[u8; 64],
    ) -> bool {
        let public_key = if *public_key == WA_CERT_PUB_KEY {
            &self.root_public
        } else {
            public_key
        };
        self.libsignal
            .verify_signature(public_key, message, signature)
    }
}

#[async_trait]
impl SignalProtocol for TestRoot {
    async fn process_bundle(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        bundle: &PreKeyBundle,
    ) -> Result<(), SignalError> {
        self.libsignal.process_bundle(store, address, bundle).await
    }

    async fn encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        plaintext: &[u8],
    ) -> Result<CiphertextMessage, SignalError> {
        self.libsignal.encrypt(store, address, plaintext).await
    }

    async fn decrypt_pre_key_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        self.libsignal
            .decrypt_pre_key_message(store, address, ciphertext)
            .await
    }

    async fn decrypt_message(
        &self,
        store: &dyn SignalProtocolStore,
        address: &SignalAddress,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        self.libsignal
            .decrypt_message(store, address, ciphertext)
            .await
    }

    async fn create_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
    ) -> Result<Vec<u8>, SignalError> {
        self.libsignal
            .create_sender_key_distribution_message(store, name)
            .await
    }

    async fn process_sender_key_distribution_message(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        message: &[u8],
    ) -> Result<(), SignalError> {
        self.libsignal
            .process_sender_key_distribution_message(store, name, message)
            .await
    }

    async fn group_encrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        self.libsignal.group_encrypt(store, name, plaintext).await
    }

    async fn group_decrypt(
        &self,
        store: &dyn SignalProtocolStore,
        name: &SenderKeyName,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, SignalError> {
        self.libsignal.group_decrypt(store, name, ciphertext).await
    }
}

fn text_message(text: &str) -> Message {
    Message {
        conversation: Some(text.to_owned()),
        ..Default::default()
    }
}

/// The next message event whose text is `text`.
async fn next_text(
    events: &mut mpsc::UnboundedReceiver<Event>,
    text: &str,
) -> whatsmeow::types::events::Message {
    tokio::time::timeout(TIMEOUT, async {
        loop {
            if let Event::Message(message) = events.recv().await.expect("the event channel is open")
                && message
                    .message
                    .as_ref()
                    .and_then(|message| message.conversation.as_deref())
                    == Some(text)
            {
                return *message;
            }
        }
    })
    .await
    .expect("the message arrives")
}

/// Links a client on [`Libsignal`] as a device of `phone`.
async fn link(
    server: &FakeWhatsApp,
    phone: &FakePhone,
) -> (Arc<Client>, mpsc::UnboundedReceiver<Event>, Jid) {
    let libsignal = Libsignal::new();
    let device = Arc::new(MemoryStore::default()).new_device(&libsignal);
    let signal = Arc::new(TestRoot {
        libsignal,
        root_public: test_root_key().public,
    });
    let config = ClientConfig {
        dialer: server.dialer(),
        ..ClientConfig::default()
    };
    let client = Client::new(device, signal, config);
    let mut events = client.subscribe();
    let mut qr = client
        .get_qr_channel(CancellationToken::new())
        .await
        .expect("the QR channel opens before connecting");
    client.connect().await.expect("the client connects");
    let Some(QrChannelItem::Code { code, .. }) = qr.recv().await else {
        panic!("expected a QR code");
    };
    let device = phone
        .scan_qr(&code)
        .await
        .expect("the phone approves the QR code");
    assert!(server.wait_until_online(&device, TIMEOUT).await);
    tokio::time::timeout(TIMEOUT, async {
        while !matches!(
            events.recv().await.expect("the event channel is open"),
            Event::Connected(_)
        ) {}
    })
    .await
    .expect("the client connects");
    assert!(server.wait_until_keys_uploaded(&device, TIMEOUT).await);
    (client, events, device)
}

#[tokio::test]
async fn a_libsignal_client_sends_and_receives_direct_and_group_messages() {
    let server = FakeWhatsApp::start().await.expect("the fake server starts");
    let alice = server.add_user("15550000001", "Alice").await;
    let bob = server.add_user("15550000002", "Bob").await;
    let carol = server.add_user("15550000003", "Carol").await;
    let (client, mut events, device) = link(&server, &alice).await;

    // 1:1: the client starts the session from bob's prekeys.
    let sent = client
        .send_message(&bob.jid(), text_message("hello bob"), Default::default())
        .await
        .expect("the server acks the message");
    let received = bob
        .wait_for_message(TIMEOUT, |message| message.id == sent.id)
        .await
        .expect("bob's phone decrypts the message");
    assert_eq!(received.text(), Some("hello bob"));
    let reply = bob.send_text(&alice.jid(), "hello alice").await.unwrap();
    assert_eq!(next_text(&mut events, "hello alice").await.info.id, reply);

    // Groups: receive under a phone's sender key, send under the client's.
    let group = server.create_group("Book club", &[&alice, &bob, &carol]);
    let incoming = carol.send_text(&group, "welcome").await.unwrap();
    let message = next_text(&mut events, "welcome").await;
    assert_eq!(message.info.id, incoming);
    assert_eq!(message.info.source.chat, group);
    for text in ["thanks", "again"] {
        let sent = client
            .send_message(&group, text_message(text), Default::default())
            .await
            .expect("the server acks the group message");
        for phone in [&alice, &bob, &carol] {
            let received = phone
                .wait_for_message(TIMEOUT, |message| message.id == sent.id)
                .await
                .expect("every member's phone decrypts the group message");
            assert_eq!(received.text(), Some(text));
            assert_eq!(received.sender.device, device.device);
        }
    }
    for phone in [&alice, &bob, &carol] {
        assert!(phone.failures().is_empty(), "{:?}", phone.failures());
    }
}
