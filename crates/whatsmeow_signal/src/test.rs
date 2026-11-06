use std::sync::Arc;

use rand::SeedableRng;
use rand::rngs::StdRng;
use whatsmeow::signal::{
    CiphertextType, CurveSignatures, PreKeyBundle, SenderKeyName, SignalAddress, SignalError,
    SignalProtocol, SignalProtocolStore,
};
use whatsmeow::store::MemoryStore;

use libsignal_core::curve::KeyPair;

use crate::Libsignal;
use crate::protocol::crypto;
use crate::protocol::messages::{SenderKeyDistributionMessage, SenderKeyMessage};
use crate::protocol::sender_keys::SenderChainKey;
use crate::test_store::TestStore;

#[tokio::test]
async fn one_to_one_conversation_survives_reordering_duplicates_and_skips() {
    let protocol = Libsignal::new();
    let signatures = Libsignal::new();
    let mut generator = StdRng::seed_from_u64(1);
    let alice = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let bob = TestStore::new(&mut generator, &signatures, 2002, &[7]);
    let alice_address = SignalAddress::new("alice".to_owned(), 1);
    let bob_address = SignalAddress::new("bob".to_owned(), 2);

    protocol
        .process_bundle(&alice, &bob_address, &bob.bundle(2, Some(7)))
        .await
        .expect("alice starts a session from bob's bundle");
    let first = protocol
        .encrypt(&alice, &bob_address, b"first")
        .await
        .expect("alice encrypts");
    let second = protocol
        .encrypt(&alice, &bob_address, b"second")
        .await
        .expect("alice encrypts");
    assert_eq!(first.kind, CiphertextType::PreKey);
    assert_eq!(second.kind, CiphertextType::PreKey);
    assert_eq!(first.serialized[0], 0x33);

    // The second pre-key message arrives first; both set up the same session.
    assert_eq!(
        protocol
            .decrypt_pre_key_message(&bob, &alice_address, &second.serialized)
            .await
            .expect("bob decrypts the second message"),
        b"second"
    );
    assert!(!bob.has_pre_key(7), "a used one-time pre-key is removed");
    assert_eq!(
        protocol
            .decrypt_pre_key_message(&bob, &alice_address, &first.serialized)
            .await
            .expect("bob decrypts the first message late"),
        b"first"
    );
    assert!(matches!(
        protocol
            .decrypt_pre_key_message(&bob, &alice_address, &first.serialized)
            .await,
        Err(SignalError::OldCounter)
    ));

    let reply_one = protocol
        .encrypt(&bob, &alice_address, b"reply one")
        .await
        .expect("bob replies");
    let reply_two = protocol
        .encrypt(&bob, &alice_address, b"reply two")
        .await
        .expect("bob replies");
    let reply_three = protocol
        .encrypt(&bob, &alice_address, b"reply three")
        .await
        .expect("bob replies");
    assert_eq!(reply_one.kind, CiphertextType::Whisper);
    assert_eq!(reply_one.serialized[0], 0x33);

    // Skip reply two, then go back for it.
    assert_eq!(
        protocol
            .decrypt_message(&alice, &bob_address, &reply_three.serialized)
            .await
            .expect("alice decrypts reply three"),
        b"reply three"
    );
    assert_eq!(
        protocol
            .decrypt_message(&alice, &bob_address, &reply_one.serialized)
            .await
            .expect("alice decrypts reply one"),
        b"reply one"
    );
    assert_eq!(
        protocol
            .decrypt_message(&alice, &bob_address, &reply_two.serialized)
            .await
            .expect("alice decrypts the skipped reply two"),
        b"reply two"
    );
    assert!(matches!(
        protocol
            .decrypt_message(&alice, &bob_address, &reply_two.serialized)
            .await,
        Err(SignalError::OldCounter)
    ));

    // Bob's reply acknowledged the session, so alice now sends plain messages.
    let third = protocol
        .encrypt(&alice, &bob_address, b"third")
        .await
        .expect("alice encrypts");
    assert_eq!(third.kind, CiphertextType::Whisper);
    assert_eq!(
        protocol
            .decrypt_message(&bob, &alice_address, &third.serialized)
            .await
            .expect("bob decrypts"),
        b"third"
    );
}

#[tokio::test]
async fn session_without_a_one_time_pre_key() {
    let protocol = Libsignal::new();
    let signatures = Libsignal::new();
    let mut generator = StdRng::seed_from_u64(2);
    let alice = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let bob = TestStore::new(&mut generator, &signatures, 2002, &[]);
    let alice_address = SignalAddress::new("alice".to_owned(), 1);
    let bob_address = SignalAddress::new("bob".to_owned(), 2);

    protocol
        .process_bundle(&alice, &bob_address, &bob.bundle(2, None))
        .await
        .expect("alice starts a session from a bundle without a one-time pre-key");
    let message = protocol
        .encrypt(&alice, &bob_address, b"hello")
        .await
        .expect("alice encrypts");
    assert_eq!(
        protocol
            .decrypt_pre_key_message(&bob, &alice_address, &message.serialized)
            .await
            .expect("bob decrypts"),
        b"hello"
    );
}

#[tokio::test]
async fn bad_signed_pre_key_signature_rejects_the_bundle() {
    let protocol = Libsignal::new();
    let signatures = Libsignal::new();
    let mut generator = StdRng::seed_from_u64(3);
    let alice = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let bob = TestStore::new(&mut generator, &signatures, 2002, &[]);
    let bob_address = SignalAddress::new("bob".to_owned(), 2);
    let mut bundle = bob.bundle(2, None);
    bundle.signed_pre_key_signature[10] ^= 1;

    assert!(matches!(
        protocol.process_bundle(&alice, &bob_address, &bundle).await,
        Err(SignalError::Internal(_))
    ));
    assert!(alice.session(&bob_address).is_none());
}

#[tokio::test]
async fn bad_mac_is_rejected_and_the_session_survives() {
    let protocol = Libsignal::new();
    let signatures = Libsignal::new();
    let mut generator = StdRng::seed_from_u64(4);
    let alice = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let bob = TestStore::new(&mut generator, &signatures, 2002, &[]);
    let alice_address = SignalAddress::new("alice".to_owned(), 1);
    let bob_address = SignalAddress::new("bob".to_owned(), 2);
    protocol
        .process_bundle(&alice, &bob_address, &bob.bundle(2, None))
        .await
        .expect("alice starts a session");
    let hello = protocol
        .encrypt(&alice, &bob_address, b"hello")
        .await
        .expect("alice encrypts");
    protocol
        .decrypt_pre_key_message(&bob, &alice_address, &hello.serialized)
        .await
        .expect("bob decrypts");
    let reply = protocol
        .encrypt(&bob, &alice_address, b"reply")
        .await
        .expect("bob replies");

    let mut bad_mac = reply.serialized.clone();
    let last = bad_mac.len() - 1;
    bad_mac[last] ^= 0x01;
    let mut bad_body = reply.serialized.clone();
    bad_body[last - 10] ^= 0x01;
    let record_before = alice.session(&bob_address);
    for forged in [bad_mac, bad_body] {
        assert!(matches!(
            protocol
                .decrypt_message(&alice, &bob_address, &forged)
                .await,
            Err(SignalError::Internal(_))
        ));
    }
    assert_eq!(alice.session(&bob_address), record_before);

    assert_eq!(
        protocol
            .decrypt_message(&alice, &bob_address, &reply.serialized)
            .await
            .expect("the untouched message still decrypts"),
        b"reply"
    );
}

#[tokio::test]
async fn changed_identity_is_untrusted() {
    let protocol = Libsignal::new();
    let signatures = Libsignal::new();
    let mut generator = StdRng::seed_from_u64(5);
    let alice = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let bob = TestStore::new(&mut generator, &signatures, 2002, &[]);
    let reinstalled_bob = TestStore::new(&mut generator, &signatures, 2003, &[]);
    let bob_address = SignalAddress::new("bob".to_owned(), 2);

    protocol
        .process_bundle(&alice, &bob_address, &bob.bundle(2, None))
        .await
        .expect("alice trusts bob's first identity");
    assert!(matches!(
        protocol
            .process_bundle(&alice, &bob_address, &reinstalled_bob.bundle(2, None))
            .await,
        Err(SignalError::UntrustedIdentity)
    ));
}

#[tokio::test]
async fn group_messages_survive_reordering_and_rotation() {
    let protocol = Libsignal::new();
    let signatures = Libsignal::new();
    let mut generator = StdRng::seed_from_u64(6);
    let alice = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let bob = TestStore::new(&mut generator, &signatures, 2002, &[]);
    let alice_key = SenderKeyName {
        group_id: "120363000000000001@g.us".to_owned(),
        sender: SignalAddress::new("alice".to_owned(), 1),
    };

    let distribution = protocol
        .create_sender_key_distribution_message(&alice, &alice_key)
        .await
        .expect("alice creates her sender key");
    assert_eq!(distribution[0], 0x33);
    assert_eq!(
        protocol
            .create_sender_key_distribution_message(&alice, &alice_key)
            .await
            .expect("alice reuses her sender key"),
        distribution
    );
    protocol
        .process_sender_key_distribution_message(&bob, &alice_key, &distribution)
        .await
        .expect("bob stores alice's sender key");

    let mut sent = Vec::new();
    for plaintext in [&b"zero"[..], b"one", b"two", b"three"] {
        sent.push(
            protocol
                .group_encrypt(&alice, &alice_key, plaintext)
                .await
                .expect("alice encrypts for the group"),
        );
    }
    assert_eq!(sent[0][0], 0x33);
    for (index, expected) in [(2, &b"two"[..]), (0, b"zero"), (3, b"three"), (1, b"one")] {
        assert_eq!(
            protocol
                .group_decrypt(&bob, &alice_key, &sent[index])
                .await
                .expect("bob decrypts out of order"),
            expected
        );
    }
    assert!(matches!(
        protocol.group_decrypt(&bob, &alice_key, &sent[2]).await,
        Err(SignalError::OldCounter)
    ));

    // Rotate: alice forgets her sender key and distributes a new one. A
    // message under the old key that was still in flight decrypts too.
    let in_flight = protocol
        .group_encrypt(&alice, &alice_key, b"in flight")
        .await
        .expect("alice encrypts under the old key");
    alice.delete_sender_key(&alice_key);
    let rotated = protocol
        .create_sender_key_distribution_message(&alice, &alice_key)
        .await
        .expect("alice creates a new sender key");
    assert_ne!(rotated, distribution);
    protocol
        .process_sender_key_distribution_message(&bob, &alice_key, &rotated)
        .await
        .expect("bob stores the new sender key");
    let after_rotation = protocol
        .group_encrypt(&alice, &alice_key, b"after rotation")
        .await
        .expect("alice encrypts under the new key");
    assert_eq!(
        protocol
            .group_decrypt(&bob, &alice_key, &after_rotation)
            .await
            .expect("bob decrypts under the new key"),
        b"after rotation"
    );
    assert_eq!(
        protocol
            .group_decrypt(&bob, &alice_key, &in_flight)
            .await
            .expect("bob still decrypts under the old key"),
        b"in flight"
    );
}

#[tokio::test]
async fn forged_group_messages_are_rejected() {
    let protocol = Libsignal::new();
    let signatures = Libsignal::new();
    let mut generator = StdRng::seed_from_u64(7);
    let alice = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let bob = TestStore::new(&mut generator, &signatures, 2002, &[]);
    let alice_key = SenderKeyName {
        group_id: "120363000000000001@g.us".to_owned(),
        sender: SignalAddress::new("alice".to_owned(), 1),
    };
    let distribution = protocol
        .create_sender_key_distribution_message(&alice, &alice_key)
        .await
        .expect("alice creates her sender key");
    protocol
        .process_sender_key_distribution_message(&bob, &alice_key, &distribution)
        .await
        .expect("bob stores alice's sender key");
    let message = protocol
        .group_encrypt(&alice, &alice_key, b"hello group")
        .await
        .expect("alice encrypts");

    // Mallory knows alice's chain key (she was in the group) but not her
    // signing key: she encrypts correctly under alice's key ID and signs
    // with her own key.
    let parsed = SenderKeyDistributionMessage::try_from(&distribution[..])
        .expect("alice's distribution message parses");
    let message_key =
        SenderChainKey::new(parsed.iteration(), parsed.chain_key().to_vec()).sender_message_key();
    let mallory_signing_key = KeyPair::generate(&mut generator);
    let signed_by_mallory = SenderKeyMessage::new(
        3,
        parsed.key_id(),
        message_key.iteration(),
        crypto::aes_256_cbc_encrypt(b"forged", message_key.cipher_key(), message_key.iv())
            .expect("valid key and IV")
            .into_boxed_slice(),
        &mut generator,
        &mallory_signing_key.private_key,
    )
    .expect("mallory signs");
    let mut bad_signature = message.clone();
    let last = bad_signature.len() - 1;
    bad_signature[last] ^= 0x01;
    let mut bad_body = message.clone();
    bad_body[10] ^= 0x01;

    for forged in [
        signed_by_mallory.serialized().to_vec(),
        bad_signature,
        bad_body,
    ] {
        assert!(matches!(
            protocol.group_decrypt(&bob, &alice_key, &forged).await,
            Err(SignalError::Internal(_))
        ));
    }
    assert_eq!(
        protocol
            .group_decrypt(&bob, &alice_key, &message)
            .await
            .expect("the untouched message still decrypts"),
        b"hello group"
    );
}

#[tokio::test]
async fn group_message_without_a_sender_key() {
    let protocol = Libsignal::new();
    let signatures = Libsignal::new();
    let mut generator = StdRng::seed_from_u64(8);
    let alice = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let bob = TestStore::new(&mut generator, &signatures, 2002, &[]);
    let alice_key = SenderKeyName {
        group_id: "120363000000000001@g.us".to_owned(),
        sender: SignalAddress::new("alice".to_owned(), 1),
    };
    protocol
        .create_sender_key_distribution_message(&alice, &alice_key)
        .await
        .expect("alice creates her sender key");
    let message = protocol
        .group_encrypt(&alice, &alice_key, b"hello group")
        .await
        .expect("alice encrypts");

    assert!(matches!(
        protocol.group_decrypt(&bob, &alice_key, &message).await,
        Err(SignalError::NoSenderKeyForUser)
    ));
}

#[test]
fn signatures_verify_only_the_signed_message() {
    let signatures = Libsignal::new();
    let mut generator = StdRng::seed_from_u64(9);
    let store = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let (public, private) = store.get_identity_key_pair();

    let signature = signatures.calculate_signature(&private, b"message");
    assert!(signatures.verify_signature(&public, b"message", &signature));
    assert!(!signatures.verify_signature(&public, b"massage", &signature));
    let mut flipped = signature;
    flipped[63] ^= 0x80;
    assert!(!signatures.verify_signature(&public, b"message", &flipped));
}

/// The real store path: two devices of the port's in-memory store.
#[tokio::test]
async fn whatsmeow_memory_store_devices_talk() {
    let protocol = Libsignal::new();
    let signatures = Libsignal::new();
    let alice_device = Arc::new(MemoryStore::default()).new_device(&signatures);
    let bob_device = Arc::new(MemoryStore::default()).new_device(&signatures);
    let alice = alice_device.signal_store(None);
    let bob = bob_device.signal_store(None);
    let alice_address = SignalAddress::new("alice".to_owned(), 1);
    let bob_address = SignalAddress::new("bob".to_owned(), 2);
    let one_time = bob_device
        .pre_keys
        .gen_one_pre_key()
        .await
        .expect("bob generates a pre-key");
    let bundle = PreKeyBundle {
        registration_id: bob_device.registration_id,
        device_id: 2,
        pre_key: Some((one_time.key_id, one_time.key_pair.public)),
        signed_pre_key_id: bob_device.signed_pre_key.key_id,
        signed_pre_key_public: bob_device.signed_pre_key.key_pair.public,
        signed_pre_key_signature: bob_device
            .signed_pre_key
            .signature
            .expect("the signed pre-key is signed"),
        identity_key: bob_device.identity_key.public,
    };

    protocol
        .process_bundle(&alice, &bob_address, &bundle)
        .await
        .expect("alice starts a session");
    assert!(
        alice
            .contains_session(&bob_address)
            .await
            .expect("the store answers")
    );
    let hello = protocol
        .encrypt(&alice, &bob_address, b"hello")
        .await
        .expect("alice encrypts");
    assert_eq!(
        protocol
            .decrypt_pre_key_message(&bob, &alice_address, &hello.serialized)
            .await
            .expect("bob decrypts"),
        b"hello"
    );
    assert!(
        bob_device
            .pre_keys
            .get_pre_key(one_time.key_id)
            .await
            .expect("the store answers")
            .is_none()
    );
    let reply = protocol
        .encrypt(&bob, &alice_address, b"reply")
        .await
        .expect("bob replies");
    assert_eq!(
        protocol
            .decrypt_message(&alice, &bob_address, &reply.serialized)
            .await
            .expect("alice decrypts"),
        b"reply"
    );
}
