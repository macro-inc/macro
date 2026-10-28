//! The whatsmeow client against the fake server over real local websockets,
//! with real Signal sessions on both sides.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use whatsmeow::store::{Device, MemoryStore};
use whatsmeow::types::Jid;
use whatsmeow::{Client, ClientConfig, Event, QrChannelItem};
use whatsmeow_signal::LibsignalCurveSignatures;

use super::*;

const TIMEOUT: Duration = Duration::from_secs(20);

struct Linked {
    client: Arc<Client>,
    events: mpsc::UnboundedReceiver<Event>,
    device: Jid,
    store: Arc<MemoryStore>,
}

fn new_client(
    server: &FakeWhatsApp,
    device: Device,
) -> (Arc<Client>, mpsc::UnboundedReceiver<Event>) {
    let config = ClientConfig {
        dialer: server.dialer(),
        media_base_url: Some(server.media_base_url()),
        ..ClientConfig::default()
    };
    let client = Client::new(device, test_signal(), config);
    let events = client.subscribe();
    (client, events)
}

async fn next_event(
    events: &mut mpsc::UnboundedReceiver<Event>,
    matches: impl Fn(&Event) -> bool,
) -> Event {
    tokio::time::timeout(TIMEOUT, async {
        loop {
            let event = events.recv().await.expect("the event channel is open");
            if matches(&event) {
                return event;
            }
        }
    })
    .await
    .expect("the event arrives")
}

/// Pairs a new client by scanning its first QR code with `phone`, then
/// waits for it to log in and upload prekeys.
async fn link(server: &FakeWhatsApp, phone: &FakePhone) -> Linked {
    let store = Arc::new(MemoryStore::default());
    let device = store.new_device(&LibsignalCurveSignatures::new());
    let (client, mut events) = new_client(server, device);
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
    assert!(
        server.wait_until_online(&device, TIMEOUT).await,
        "the device logs in"
    );
    next_event(&mut events, |event| matches!(event, Event::Connected(_))).await;
    assert!(server.wait_until_keys_uploaded(&device, TIMEOUT).await);
    Linked {
        client,
        events,
        device,
        store,
    }
}

#[tokio::test]
async fn a_client_pairs_by_qr_and_logs_in() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let linked = link(&server, &alice).await;

    assert_eq!(linked.device.user, "15550000001");
    assert_eq!(linked.device.device, 1);
    assert_eq!(linked.client.get_own_id().await, linked.device);
    assert_eq!(linked.client.get_own_lid().await.user, alice.lid().user);
    assert_eq!(server.linked_devices(&alice), vec![linked.device.clone()]);
    assert_eq!(linked.store.saved_devices(), vec![linked.device.clone()]);
}

#[tokio::test]
async fn a_second_login_of_the_same_device_replaces_the_first() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let mut first = link(&server, &alice).await;

    // A second client with the same device keys, as another replica that
    // loaded the same stored device.
    let device = clone_device(&first).await;
    let (second, mut second_events) = new_client(&server, device);
    second.connect().await.unwrap();
    next_event(&mut second_events, |event| {
        matches!(event, Event::Connected(_))
    })
    .await;

    next_event(&mut first.events, |event| {
        matches!(event, Event::StreamReplaced(_))
    })
    .await;
    assert!(server.is_online(&first.device));
}

#[tokio::test]
async fn a_kicked_device_is_logged_out() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let mut linked = link(&server, &alice).await;
    server.kick(&linked.device);
    next_event(&mut linked.events, |event| {
        matches!(event, Event::LoggedOut(_))
    })
    .await;
    assert!(server.linked_devices(&alice).is_empty());
}

/// A device with the same keys and identity as the linked one, backed by the
/// same memory store.
async fn clone_device(linked: &Linked) -> Device {
    let original = linked.client.store.read().await;
    let mut device = linked.store.new_device(&LibsignalCurveSignatures::new());
    device.noise_key = original.noise_key.clone();
    device.identity_key = original.identity_key.clone();
    device.signed_pre_key = original.signed_pre_key.clone();
    device.registration_id = original.registration_id;
    device.adv_secret_key = original.adv_secret_key.clone();
    device.id = original.id.clone();
    device.lid = original.lid.clone();
    device.account = original.account.clone();
    device.platform = original.platform.clone();
    device.push_name = original.push_name.clone();
    device.initialized = true;
    device
}

#[tokio::test]
async fn phones_exchange_direct_and_group_messages() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let bob = server.add_user("15550000002", "Bob").await;
    let carol = server.add_user("15550000003", "Carol").await;

    let id = alice.send_text(&bob.jid(), "hi bob").await.unwrap();
    let received = bob
        .wait_for_message(TIMEOUT, |message| message.id == id)
        .await
        .expect("bob receives the direct message");
    assert_eq!(received.text(), Some("hi bob"));
    assert_eq!(received.sender_phone, alice.jid());
    alice
        .wait_for_receipt(TIMEOUT, |receipt| receipt.id == id)
        .await
        .expect("alice gets a delivery receipt");

    // Bob answers on the session alice's prekey message started.
    let reply = bob.send_text(&alice.jid(), "hi alice").await.unwrap();
    let received = alice
        .wait_for_message(TIMEOUT, |message| message.id == reply)
        .await
        .expect("alice receives the reply");
    assert_eq!(received.text(), Some("hi alice"));

    let group = server.create_group("Friends", &[&alice, &bob, &carol]);
    let first = carol.send_text(&group, "first").await.unwrap();
    let second = carol.send_text(&group, "second").await.unwrap();
    for phone in [&alice, &bob] {
        for (id, text) in [(&first, "first"), (&second, "second")] {
            let received = phone
                .wait_for_message(TIMEOUT, |message| &message.id == id)
                .await
                .expect("every member receives the group message");
            assert_eq!(received.text(), Some(text));
            assert_eq!(received.chat, group);
        }
    }
    assert!(alice.failures().is_empty() && bob.failures().is_empty());
}

fn text_message(text: &str) -> whatsmeow::proto::wa_e2e::Message {
    whatsmeow::proto::wa_e2e::Message {
        conversation: Some(text.to_owned()),
        ..Default::default()
    }
}

/// The next message event whose text is `text`.
async fn next_text(
    events: &mut mpsc::UnboundedReceiver<Event>,
    text: &str,
) -> whatsmeow::types::events::Message {
    let event = next_event(events, |event| {
        matches!(event, Event::Message(message)
            if message.message.as_ref().and_then(|message| message.conversation.as_deref()) == Some(text))
    })
    .await;
    let Event::Message(message) = event else {
        unreachable!("matched a message event");
    };
    *message
}

#[tokio::test]
async fn a_client_and_a_phone_exchange_direct_messages() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let bob = server.add_user("15550000002", "Bob").await;
    let mut linked = link(&server, &alice).await;

    let sent = linked
        .client
        .send_message(
            &bob.jid(),
            text_message("hello from macro"),
            Default::default(),
        )
        .await
        .expect("the server acks the message");
    let received = bob
        .wait_for_message(TIMEOUT, |message| message.id == sent.id)
        .await
        .expect("bob's phone decrypts the message");
    assert_eq!(received.text(), Some("hello from macro"));
    assert_eq!(received.sender_phone, alice.jid());
    let own = alice
        .wait_for_message(TIMEOUT, |message| message.id == sent.id)
        .await
        .expect("alice's own phone gets the device-sent copy");
    assert_eq!(own.chat.user, bob.lid().user);

    let reply = bob.send_text(&alice.jid(), "hello back").await.unwrap();
    let message = next_text(&mut linked.events, "hello back").await;
    assert_eq!(message.info.id, reply);
    assert_eq!(message.info.source.sender.user, bob.lid().user);
    assert!(bob.failures().is_empty() && alice.failures().is_empty());
}

#[tokio::test]
async fn a_client_and_phones_talk_in_a_group() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let bob = server.add_user("15550000002", "Bob").await;
    let carol = server.add_user("15550000003", "Carol").await;
    let mut linked = link(&server, &alice).await;
    let group = server.create_group("Book club", &[&bob, &alice, &carol]);

    let groups = linked.client.get_joined_groups().await.unwrap();
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].jid, group);
    assert_eq!(groups[0].name.name, "Book club");

    let incoming = bob.send_text(&group, "welcome").await.unwrap();
    let message = next_text(&mut linked.events, "welcome").await;
    assert_eq!(message.info.id, incoming);
    assert_eq!(message.info.source.chat, group);
    assert!(message.info.source.is_group);

    let sent = linked
        .client
        .send_message(&group, text_message("thanks"), Default::default())
        .await
        .unwrap();
    for phone in [&alice, &bob, &carol] {
        let received = phone
            .wait_for_message(TIMEOUT, |message| message.id == sent.id)
            .await
            .expect("every member's phone decrypts the group message");
        assert_eq!(received.text(), Some("thanks"));
        assert_eq!(received.chat, group);
        assert_eq!(received.sender.user, alice.lid().user);
        assert_eq!(received.sender.device, linked.device.device);
    }
    // A second message reuses the sender key.
    let again = linked
        .client
        .send_message(&group, text_message("again"), Default::default())
        .await
        .unwrap();
    bob.wait_for_message(TIMEOUT, |message| message.id == again.id)
        .await
        .expect("the second group message decrypts");
    bob.wait_for_receipt(TIMEOUT, |receipt| {
        receipt.id == incoming && receipt.from.device == linked.device.device
    })
    .await
    .expect("the linked client sends a delivery receipt");
    for phone in [&alice, &bob, &carol] {
        assert!(phone.failures().is_empty(), "{:?}", phone.failures());
    }
}

#[tokio::test]
async fn messages_sent_while_offline_arrive_on_reconnect() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let bob = server.add_user("15550000002", "Bob").await;
    let mut linked = link(&server, &alice).await;
    let group = server.create_group("Offline", &[&alice, &bob]);

    linked.client.disconnect().await;
    assert!(server.wait_until_offline(&linked.device, TIMEOUT).await);
    let first = bob.send_text(&group, "while you were out").await.unwrap();
    let second = bob.send_text(&group, "and another").await.unwrap();
    assert_eq!(server.pending_count(&linked.device), 2);

    linked.client.connect().await.unwrap();
    let message = next_text(&mut linked.events, "while you were out").await;
    assert_eq!(message.info.id, first);
    let message = next_text(&mut linked.events, "and another").await;
    assert_eq!(message.info.id, second);
    next_event(&mut linked.events, |event| {
        matches!(event, Event::OfflineSyncCompleted(_))
    })
    .await;
    assert_eq!(server.delivery_count(&linked.device, &first), 1);
    for id in [&first, &second] {
        bob.wait_for_receipt(TIMEOUT, |receipt| {
            &receipt.id == id && receipt.from.device == linked.device.device
        })
        .await
        .expect("the linked client receipts each offline message");
    }
    assert_eq!(server.pending_count(&linked.device), 0);
}

#[tokio::test]
async fn images_travel_both_ways_through_the_media_host() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let bob = server.add_user("15550000002", "Bob").await;
    let mut linked = link(&server, &alice).await;
    let group = server.create_group("Photos", &[&alice, &bob]);

    let photo = b"not really a jpeg, but encrypted like one".repeat(50);
    let incoming = bob.send_image(&group, &photo, "look").await.unwrap();
    let event = next_event(&mut linked.events, |event| {
        matches!(event, Event::Message(message) if message.info.id == incoming
                && message.message.as_ref().is_some_and(|message| message.image_message.is_some()))
    })
    .await;
    let Event::Message(message) = event else {
        unreachable!("matched a message event");
    };
    let image = message
        .message
        .as_ref()
        .and_then(|message| message.image_message.as_deref())
        .expect("the client receives an image message");
    assert_eq!(image.caption.as_deref(), Some("look"));
    assert_eq!(linked.client.download(image).await.unwrap(), photo);

    let reply = b"a photo from macro".repeat(20);
    let uploaded = linked
        .client
        .upload(&reply, whatsmeow::download::MediaType::Image)
        .await
        .expect("the client uploads to the fake media host");
    let message = whatsmeow::proto::wa_e2e::Message {
        image_message: Some(Box::new(whatsmeow::proto::wa_e2e::ImageMessage {
            url: Some(uploaded.url),
            direct_path: Some(uploaded.direct_path),
            media_key: Some(uploaded.media_key),
            file_enc_sha256: Some(uploaded.file_enc_sha256),
            file_sha256: Some(uploaded.file_sha256),
            file_length: Some(uploaded.file_length),
            mimetype: Some("image/jpeg".to_owned()),
            ..Default::default()
        })),
        ..Default::default()
    };
    let sent = linked
        .client
        .send_message(&group, message, Default::default())
        .await
        .unwrap();
    let received = bob
        .wait_for_message(TIMEOUT, |message| message.id == sent.id)
        .await
        .expect("bob's phone receives the image");
    assert_eq!(bob.download_image(&received).await.unwrap(), reply);
}
