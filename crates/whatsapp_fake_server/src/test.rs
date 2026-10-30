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

#[tokio::test]
async fn group_changes_name_who_made_them() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let bob = server.add_user("15550000002", "Bob").await;
    let carol = server.add_user("15550000003", "Carol").await;
    let dana = server.add_user("15550000004", "Dana").await;
    let mut linked = link(&server, &alice).await;
    let group = server.create_group("Team", &[&bob, &alice, &carol]);

    server.change_group(&group, Some(&bob), GroupChange::Add(&dana));
    let Event::GroupInfo(added) = next_event(
        &mut linked.events,
        |event| matches!(event, Event::GroupInfo(change) if !change.join.is_empty()),
    )
    .await
    else {
        unreachable!("matched a group change");
    };
    assert_eq!(added.jid, group);
    assert_eq!(added.sender, Some(bob.lid()));
    assert_eq!(added.sender_pn, Some(bob.jid()));
    assert_eq!(added.join, vec![dana.lid()]);
    dana.send_text(&group, "hi, Dana here")
        .await
        .expect("an added member can send to the group");
    next_text(&mut linked.events, "hi, Dana here").await;

    server.change_group(&group, Some(&dana), GroupChange::Remove(&dana));
    let Event::GroupInfo(left) = next_event(
        &mut linked.events,
        |event| matches!(event, Event::GroupInfo(change) if !change.leave.is_empty()),
    )
    .await
    else {
        unreachable!("matched a group change");
    };
    assert_eq!(left.sender, Some(dana.lid()));
    assert_eq!(left.leave, vec![dana.lid()]);

    server.change_group(
        &group,
        Some(&carol),
        GroupChange::Subject("Team, renamed".to_owned()),
    );
    let Event::GroupInfo(renamed) = next_event(
        &mut linked.events,
        |event| matches!(event, Event::GroupInfo(change) if change.name.is_some()),
    )
    .await
    else {
        unreachable!("matched a group change");
    };
    assert_eq!(renamed.sender, Some(carol.lid()));
    assert_eq!(renamed.name.unwrap().name, "Team, renamed");

    server.change_group(
        &group,
        Some(&bob),
        GroupChange::Description("Where the team talks".to_owned()),
    );
    let Event::GroupInfo(described) = next_event(
        &mut linked.events,
        |event| matches!(event, Event::GroupInfo(change) if change.topic.is_some()),
    )
    .await
    else {
        unreachable!("matched a group change");
    };
    assert_eq!(described.topic.unwrap().topic, "Where the team talks");

    server.change_group(&group, Some(&bob), GroupChange::Promote(&carol));
    let Event::GroupInfo(promoted) = next_event(
        &mut linked.events,
        |event| matches!(event, Event::GroupInfo(change) if !change.promote.is_empty()),
    )
    .await
    else {
        unreachable!("matched a group change");
    };
    assert_eq!(promoted.promote, vec![carol.lid()]);

    let info = linked.client.get_group_info(&group).await.unwrap();
    assert_eq!(info.name.name, "Team, renamed");
    assert_eq!(info.topic.topic, "Where the team talks");
    let members: Vec<(String, bool)> = info
        .participants
        .iter()
        .map(|participant| (participant.jid.user.clone(), participant.is_admin))
        .collect();
    assert_eq!(
        members,
        vec![
            (bob.lid().user, true),
            (alice.lid().user, false),
            (carol.lid().user, true),
        ]
    );

    server.change_group(&group, Some(&bob), GroupChange::Demote(&carol));
    let Event::GroupInfo(demoted) = next_event(
        &mut linked.events,
        |event| matches!(event, Event::GroupInfo(change) if !change.demote.is_empty()),
    )
    .await
    else {
        unreachable!("matched a group change");
    };
    assert_eq!(demoted.demote, vec![carol.lid()]);

    // A change WhatsApp makes names no one.
    server.rename_group(&group, "Team, again");
    let Event::GroupInfo(anonymous) = next_event(
        &mut linked.events,
        |event| matches!(event, Event::GroupInfo(change) if change.name.is_some()),
    )
    .await
    else {
        unreachable!("matched a group change");
    };
    assert_eq!(anonymous.sender, None);
}

#[tokio::test]
async fn a_poll_vote_decrypts_with_the_polls_secret() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let bob = server.add_user("15550000002", "Bob").await;
    let carol = server.add_user("15550000003", "Carol").await;
    let mut linked = link(&server, &alice).await;
    let group = server.create_group("Lunch", &[&bob, &alice, &carol]);

    let poll = whatsmeow::msgsecret::build_poll_creation(
        "Where to?",
        &["Pizza".to_owned(), "Sushi".to_owned()],
        1,
    );
    let secret = poll
        .message_context_info
        .as_ref()
        .and_then(|context| context.message_secret.clone())
        .expect("a poll carries its message secret");
    let poll_id = bob.send_message(&group, poll).await.unwrap();
    next_event(&mut linked.events, |event| {
        matches!(event, Event::Message(message) if message.info.id == poll_id
            && message.message.as_ref().is_some_and(|message| message.poll_creation_message.is_some()))
    })
    .await;

    let vote_id = carol
        .vote(&group, &poll_id, &bob.lid(), &secret, &["Sushi"])
        .await
        .unwrap();
    let Event::Message(vote) = next_event(&mut linked.events, |event| {
        matches!(event, Event::Message(message) if message.info.id == vote_id
            && message.message.as_ref().is_some_and(|message| message.poll_update_message.is_some()))
    })
    .await
    else {
        unreachable!("matched a message event");
    };
    let decrypted = linked.client.decrypt_poll_vote(&vote).await.unwrap();
    assert_eq!(
        decrypted.selected_options,
        whatsmeow::msgsecret::hash_poll_options(&["Sushi".to_owned()])
    );
}

#[tokio::test]
async fn stickers_and_voice_notes_download_like_images() {
    let server = FakeWhatsApp::start().await.unwrap();
    let alice = server.add_user("15550000001", "Alice").await;
    let bob = server.add_user("15550000002", "Bob").await;
    let mut linked = link(&server, &alice).await;
    let group = server.create_group("Media", &[&alice, &bob]);

    let sticker = b"webp sticker frames".repeat(30);
    let uploaded = bob
        .upload_media(&sticker, whatsmeow::download::MediaType::Image)
        .await
        .unwrap();
    let sent = bob
        .send_message(
            &group,
            whatsmeow::proto::wa_e2e::Message {
                sticker_message: Some(Box::new(whatsmeow::proto::wa_e2e::StickerMessage {
                    url: Some(uploaded.url),
                    direct_path: Some(uploaded.direct_path),
                    media_key: Some(uploaded.media_key),
                    file_enc_sha256: Some(uploaded.file_enc_sha256),
                    file_sha256: Some(uploaded.file_sha256),
                    file_length: Some(uploaded.file_length),
                    mimetype: Some("image/webp".to_owned()),
                    width: Some(512),
                    height: Some(512),
                    ..Default::default()
                })),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let Event::Message(message) = next_event(&mut linked.events, |event| {
        matches!(event, Event::Message(message) if message.info.id == sent
            && message.message.as_ref().is_some_and(|message| message.sticker_message.is_some()))
    })
    .await
    else {
        unreachable!("matched a message event");
    };
    let part = message
        .message
        .as_ref()
        .and_then(|message| message.sticker_message.as_deref())
        .unwrap();
    assert_eq!(linked.client.download(part).await.unwrap(), sticker);

    let voice = b"opus voice note".repeat(30);
    let uploaded = bob
        .upload_media(&voice, whatsmeow::download::MediaType::Audio)
        .await
        .unwrap();
    let sent = bob
        .send_message(
            &group,
            whatsmeow::proto::wa_e2e::Message {
                audio_message: Some(Box::new(whatsmeow::proto::wa_e2e::AudioMessage {
                    url: Some(uploaded.url),
                    direct_path: Some(uploaded.direct_path),
                    media_key: Some(uploaded.media_key),
                    file_enc_sha256: Some(uploaded.file_enc_sha256),
                    file_sha256: Some(uploaded.file_sha256),
                    file_length: Some(uploaded.file_length),
                    mimetype: Some("audio/ogg; codecs=opus".to_owned()),
                    ptt: Some(true),
                    seconds: Some(4),
                    ..Default::default()
                })),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let Event::Message(message) = next_event(&mut linked.events, |event| {
        matches!(event, Event::Message(message) if message.info.id == sent
            && message.message.as_ref().is_some_and(|message| message.audio_message.is_some()))
    })
    .await
    else {
        unreachable!("matched a message event");
    };
    let part = message
        .message
        .as_ref()
        .and_then(|message| message.audio_message.as_deref())
        .unwrap();
    assert_eq!(part.ptt, Some(true));
    assert_eq!(linked.client.download(part).await.unwrap(), voice);
}
