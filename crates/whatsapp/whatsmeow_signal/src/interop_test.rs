//! Interop with go.mau.fi/libsignal v0.2.2, the Signal implementation
//! whatsmeow uses, through the Go oracle in `testdata/generator`.
//!
//! One scripted conversation runs Rust devices against Go devices. Run live
//! (`cargo test -p whatsmeow_signal -- --ignored`), every Go call goes to the
//! oracle and the exchange can be recorded to
//! `testdata/interop_transcript.json`. The default test replays that
//! recording: Rust's randomness is seeded, so it must send exactly the bytes
//! Go accepted, and it must decrypt exactly the bytes Go produced.

use std::collections::{BTreeSet, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use libsignal_core::curve::KeyPair;
use rand::SeedableRng;
use rand::rngs::StdRng;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use whatsmeow::signal::{
    CiphertextType, CurveSignatures, PreKeyBundle, SenderKeyName, SignalAddress, SignalError,
    SignalProtocol,
};

use crate::Libsignal;
use crate::test_store::TestStore;

const TRANSCRIPT: &str = "testdata/interop_transcript.json";
const PROTOCOL_SEED: u64 = 0x5167_6e61_6c01;
const SIGNATURE_SEED: u64 = 0x5167_6e61_6c02;
const KEY_SEED: u64 = 0x5167_6e61_6c03;
const GROUP: &str = "120363000000000001@g.us";

#[derive(Serialize, Deserialize)]
struct Exchange {
    request: Value,
    response: Value,
}

/// The Go side of the conversation.
trait Oracle {
    fn call(&mut self, request: Value) -> Value;
}

/// The Go oracle process, recording every exchange.
struct LiveOracle {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    exchanges: Vec<Exchange>,
}

impl LiveOracle {
    fn start() -> Self {
        let mut child = Command::new("go")
            .args(["run", "."])
            .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/generator"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("`go` is on PATH (nix shell nixpkgs#go)");
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = BufReader::new(child.stdout.take().expect("stdout is piped"));
        Self {
            child,
            stdin,
            stdout,
            exchanges: Vec::new(),
        }
    }

    fn finish(mut self) -> Vec<Exchange> {
        drop(self.stdin);
        assert!(self.child.wait().expect("the oracle exits").success());
        self.exchanges
    }
}

impl Oracle for LiveOracle {
    fn call(&mut self, request: Value) -> Value {
        writeln!(self.stdin, "{request}").expect("the oracle reads requests");
        let mut line = String::new();
        self.stdout
            .read_line(&mut line)
            .expect("the oracle answers");
        let response: Value = serde_json::from_str(&line)
            .unwrap_or_else(|error| panic!("the oracle answered {line:?}: {error}"));
        self.exchanges.push(Exchange {
            request,
            response: response.clone(),
        });
        response
    }
}

/// A recorded conversation: each request must match the recorded one.
struct ReplayOracle {
    exchanges: VecDeque<Exchange>,
}

impl Oracle for ReplayOracle {
    fn call(&mut self, request: Value) -> Value {
        let exchange = self
            .exchanges
            .pop_front()
            .expect("the transcript has an answer for every request");
        assert_eq!(request, exchange.request, "Rust sent different bytes");
        exchange.response
    }
}

/// The response, or a panic with the oracle's error.
fn ok(response: Value) -> Value {
    assert!(
        response.get("error").is_none(),
        "go.mau.fi/libsignal failed: {response}"
    );
    response
}

fn bytes(response: &Value, field: &str) -> Vec<u8> {
    hex::decode(response[field].as_str().expect("the field is a hex string"))
        .expect("the field is hex")
}

fn key(response: &Value, field: &str) -> [u8; 32] {
    bytes(response, field)
        .try_into()
        .expect("the key is 32 bytes")
}

fn peer(address: &SignalAddress) -> Value {
    json!({ "name": address.name, "device": address.device_id })
}

fn bundle_json(bundle: &PreKeyBundle) -> Value {
    let mut value = json!({
        "registration_id": bundle.registration_id,
        "device_id": bundle.device_id,
        "signed_pre_key": {
            "id": bundle.signed_pre_key_id,
            "public": hex::encode(bundle.signed_pre_key_public),
        },
        "signed_pre_key_signature": hex::encode(bundle.signed_pre_key_signature),
        "identity_key": hex::encode(bundle.identity_key),
    });
    if let Some((id, public)) = bundle.pre_key {
        value["pre_key"] = json!({ "id": id, "public": hex::encode(public) });
    }
    value
}

fn bundle_from_json(value: &Value) -> PreKeyBundle {
    let id = |field: &Value| {
        u32::try_from(field.as_u64().expect("the ID is a number")).expect("the ID fits in u32")
    };
    PreKeyBundle {
        registration_id: id(&value["registration_id"]),
        device_id: id(&value["device_id"]),
        pre_key: value
            .get("pre_key")
            .map(|pre_key| (id(&pre_key["id"]), key(pre_key, "public"))),
        signed_pre_key_id: id(&value["signed_pre_key"]["id"]),
        signed_pre_key_public: key(&value["signed_pre_key"], "public"),
        signed_pre_key_signature: bytes(value, "signed_pre_key_signature")
            .try_into()
            .expect("the signature is 64 bytes"),
        identity_key: key(value, "identity_key"),
    }
}

fn kind_name(kind: CiphertextType) -> &'static str {
    match kind {
        CiphertextType::PreKey => "pkmsg",
        CiphertextType::Whisper => "msg",
    }
}

/// Go encrypts `plaintext` from `device` to `to`; returns (type, ciphertext).
fn go_encrypt(
    oracle: &mut dyn Oracle,
    device: &str,
    to: &SignalAddress,
    plaintext: &[u8],
) -> (String, Vec<u8>) {
    let response = ok(oracle.call(json!({
        "op": "encrypt", "device": device, "peer": peer(to), "plaintext": hex::encode(plaintext),
    })));
    (
        response["type"]
            .as_str()
            .expect("the type is a string")
            .to_owned(),
        bytes(&response, "ciphertext"),
    )
}

fn go_decrypt(
    oracle: &mut dyn Oracle,
    device: &str,
    from: &SignalAddress,
    kind: CiphertextType,
    ciphertext: &[u8],
) -> Value {
    oracle.call(json!({
        "op": "decrypt", "device": device, "peer": peer(from),
        "type": kind_name(kind), "ciphertext": hex::encode(ciphertext),
    }))
}

async fn xeddsa(oracle: &mut dyn Oracle, signatures: &Libsignal) {
    let mut generator = StdRng::seed_from_u64(KEY_SEED);
    let mut sign_bits = BTreeSet::new();
    for index in 0..8 {
        let pair = KeyPair::generate(&mut generator);
        let public: [u8; 32] = pair
            .public_key
            .public_key_bytes()
            .try_into()
            .expect("32-byte public key");
        let private: [u8; 32] = pair
            .private_key
            .serialize()
            .try_into()
            .expect("32-byte private key");
        let message = format!("xeddsa vector {index}").into_bytes();

        let go_signature: [u8; 64] = bytes(
            &ok(oracle.call(json!({
                "op": "sign", "private_key": hex::encode(private), "message": hex::encode(&message),
            }))),
            "signature",
        )
        .try_into()
        .expect("64-byte signature");
        sign_bits.insert(go_signature[63] & 0x80);
        assert!(signatures.verify_signature(&public, &message, &go_signature));
        assert!(!signatures.verify_signature(&public, b"another message", &go_signature));

        let rust_signature = signatures.calculate_signature(&private, &message);
        assert_eq!(rust_signature[63] & 0x80, go_signature[63] & 0x80);
        let verified = ok(oracle.call(json!({
            "op": "verify", "public_key": hex::encode(public), "message": hex::encode(&message),
            "signature": hex::encode(rust_signature),
        })));
        assert_eq!(verified["valid"], json!(true));
        let mut flipped = rust_signature;
        flipped[63] ^= 0x80;
        let verified = ok(oracle.call(json!({
            "op": "verify", "public_key": hex::encode(public), "message": hex::encode(&message),
            "signature": hex::encode(flipped),
        })));
        assert_eq!(verified["valid"], json!(false));
    }
    assert_eq!(
        sign_bits,
        BTreeSet::from([0x00, 0x80]),
        "the vectors cover both sign bits"
    );
}

/// Rust starts sessions from Go bundles; then a long back and forth.
async fn rust_initiates(oracle: &mut dyn Oracle, protocol: &Libsignal, alice: &TestStore) {
    let alice_address = SignalAddress::new("rust-alice".to_owned(), 1);
    let bob_address = SignalAddress::new("go-bob".to_owned(), 2);
    ok(oracle.call(json!({ "op": "new_device", "device": "bob", "registration_id": 2002 })));
    let bundle = ok(oracle.call(json!({
        "op": "make_bundle", "device": "bob", "signed_pre_key_id": 1, "pre_key_id": 31,
    })));
    let bundle = bundle_from_json(&bundle["bundle"]);
    protocol
        .process_bundle(alice, &bob_address, &bundle)
        .await
        .expect("Rust processes Go's bundle");

    let first = protocol
        .encrypt(alice, &bob_address, b"first")
        .await
        .expect("Rust encrypts");
    let second = protocol
        .encrypt(alice, &bob_address, b"second")
        .await
        .expect("Rust encrypts");
    assert_eq!(first.kind, CiphertextType::PreKey);
    for (message, expected) in [(&second, &b"second"[..]), (&first, b"first")] {
        let decrypted = ok(go_decrypt(
            oracle,
            "bob",
            &alice_address,
            message.kind,
            &message.serialized,
        ));
        assert_eq!(bytes(&decrypted, "plaintext"), expected);
    }

    let replies: Vec<(String, Vec<u8>)> = [&b"reply one"[..], b"reply two", b"reply three"]
        .into_iter()
        .map(|plaintext| go_encrypt(oracle, "bob", &alice_address, plaintext))
        .collect();
    for (index, expected) in [
        (0, &b"reply one"[..]),
        (2, b"reply three"),
        (1, b"reply two"),
    ] {
        assert_eq!(replies[index].0, "msg");
        assert_eq!(
            protocol
                .decrypt_message(alice, &bob_address, &replies[index].1)
                .await
                .expect("Rust decrypts Go's reply"),
            expected
        );
    }
    assert!(matches!(
        protocol
            .decrypt_message(alice, &bob_address, &replies[1].1)
            .await,
        Err(SignalError::OldCounter)
    ));
    let (_, untouched) = go_encrypt(oracle, "bob", &alice_address, b"untouched");
    let mut bad_mac = untouched.clone();
    let last = bad_mac.len() - 1;
    bad_mac[last] ^= 0x01;
    assert!(matches!(
        protocol
            .decrypt_message(alice, &bob_address, &bad_mac)
            .await,
        Err(SignalError::Internal(_))
    ));
    assert_eq!(
        protocol
            .decrypt_message(alice, &bob_address, &untouched)
            .await
            .expect("the untouched message still decrypts"),
        b"untouched"
    );

    // Several ratchet turns in both directions, each out of order.
    for round in 0..4 {
        let rust_messages = [
            format!("rust round {round} a"),
            format!("rust round {round} b"),
        ];
        let mut sent = Vec::new();
        for plaintext in &rust_messages {
            let message = protocol
                .encrypt(alice, &bob_address, plaintext.as_bytes())
                .await
                .expect("Rust encrypts");
            assert_eq!(message.kind, CiphertextType::Whisper);
            sent.push(message);
        }
        for index in [1, 0] {
            let decrypted = ok(go_decrypt(
                oracle,
                "bob",
                &alice_address,
                sent[index].kind,
                &sent[index].serialized,
            ));
            assert_eq!(
                bytes(&decrypted, "plaintext"),
                rust_messages[index].as_bytes()
            );
        }
        let duplicate = go_decrypt(
            oracle,
            "bob",
            &alice_address,
            sent[0].kind,
            &sent[0].serialized,
        );
        assert!(duplicate.get("error").is_some(), "Go rejects a duplicate");

        let go_messages = [format!("go round {round} a"), format!("go round {round} b")];
        let received: Vec<(String, Vec<u8>)> = go_messages
            .iter()
            .map(|plaintext| go_encrypt(oracle, "bob", &alice_address, plaintext.as_bytes()))
            .collect();
        for index in [1, 0] {
            assert_eq!(
                protocol
                    .decrypt_message(alice, &bob_address, &received[index].1)
                    .await
                    .expect("Rust decrypts Go"),
                go_messages[index].as_bytes()
            );
        }
    }

    // A bundle without a one-time pre-key.
    let erin_address = SignalAddress::new("go-erin".to_owned(), 5);
    ok(oracle.call(json!({ "op": "new_device", "device": "erin", "registration_id": 5005 })));
    let bundle = ok(oracle.call(json!({
        "op": "make_bundle", "device": "erin", "signed_pre_key_id": 9,
    })));
    protocol
        .process_bundle(alice, &erin_address, &bundle_from_json(&bundle["bundle"]))
        .await
        .expect("Rust processes a bundle without a one-time pre-key");
    let hello = protocol
        .encrypt(alice, &erin_address, b"hello erin")
        .await
        .expect("Rust encrypts");
    let decrypted = ok(go_decrypt(
        oracle,
        "erin",
        &alice_address,
        hello.kind,
        &hello.serialized,
    ));
    assert_eq!(bytes(&decrypted, "plaintext"), b"hello erin");
}

/// Go starts sessions from Rust bundles.
async fn go_initiates(oracle: &mut dyn Oracle, protocol: &Libsignal, carol: &TestStore) {
    let carol_address = SignalAddress::new("rust-carol".to_owned(), 3);
    let dave_address = SignalAddress::new("go-dave".to_owned(), 4);
    ok(oracle.call(json!({ "op": "new_device", "device": "dave", "registration_id": 4004 })));
    ok(oracle.call(json!({
        "op": "process_bundle", "device": "dave", "peer": peer(&carol_address),
        "bundle": bundle_json(&carol.bundle(3, Some(77))),
    })));
    let (first_kind, first) = go_encrypt(oracle, "dave", &carol_address, b"from go 1");
    let (_, second) = go_encrypt(oracle, "dave", &carol_address, b"from go 2");
    assert_eq!(first_kind, "pkmsg");
    assert_eq!(
        protocol
            .decrypt_pre_key_message(carol, &dave_address, &second)
            .await
            .expect("Rust decrypts Go's second pre-key message"),
        b"from go 2"
    );
    assert!(
        !carol.has_pre_key(77),
        "the used one-time pre-key is removed"
    );
    assert_eq!(
        protocol
            .decrypt_pre_key_message(carol, &dave_address, &first)
            .await
            .expect("Rust decrypts Go's first pre-key message"),
        b"from go 1"
    );

    let reply = protocol
        .encrypt(carol, &dave_address, b"reply from rust")
        .await
        .expect("Rust replies");
    assert_eq!(reply.kind, CiphertextType::Whisper);
    let decrypted = ok(go_decrypt(
        oracle,
        "dave",
        &carol_address,
        reply.kind,
        &reply.serialized,
    ));
    assert_eq!(bytes(&decrypted, "plaintext"), b"reply from rust");
    let (kind, after) = go_encrypt(oracle, "dave", &carol_address, b"after the reply");
    assert_eq!(kind, "msg");
    assert_eq!(
        protocol
            .decrypt_message(carol, &dave_address, &after)
            .await
            .expect("Rust decrypts"),
        b"after the reply"
    );

    // A Rust bundle without a one-time pre-key.
    let frank_address = SignalAddress::new("go-frank".to_owned(), 6);
    ok(oracle.call(json!({ "op": "new_device", "device": "frank", "registration_id": 6006 })));
    ok(oracle.call(json!({
        "op": "process_bundle", "device": "frank", "peer": peer(&carol_address),
        "bundle": bundle_json(&carol.bundle(3, None)),
    })));
    let (_, hello) = go_encrypt(oracle, "frank", &carol_address, b"no one-time key");
    assert_eq!(
        protocol
            .decrypt_pre_key_message(carol, &frank_address, &hello)
            .await
            .expect("Rust decrypts"),
        b"no one-time key"
    );
}

async fn groups(oracle: &mut dyn Oracle, protocol: &Libsignal, alice: &TestStore) {
    let alice_key = SenderKeyName {
        group_id: GROUP.to_owned(),
        sender: SignalAddress::new("rust-alice".to_owned(), 1),
    };
    let bob_key = SenderKeyName {
        group_id: GROUP.to_owned(),
        sender: SignalAddress::new("go-bob".to_owned(), 2),
    };

    // Rust sends to the group.
    let distribution = protocol
        .create_sender_key_distribution_message(alice, &alice_key)
        .await
        .expect("Rust creates its sender key");
    ok(oracle.call(json!({
        "op": "process_sender_key", "device": "bob", "group": GROUP,
        "peer": peer(&alice_key.sender), "message": hex::encode(&distribution),
    })));
    let mut sent = Vec::new();
    for plaintext in ["group zero", "group one", "group two"] {
        sent.push(
            protocol
                .group_encrypt(alice, &alice_key, plaintext.as_bytes())
                .await
                .expect("Rust encrypts for the group"),
        );
    }
    for (index, expected) in [(2, "group two"), (0, "group zero"), (1, "group one")] {
        let decrypted = ok(oracle.call(json!({
            "op": "group_decrypt", "device": "bob", "group": GROUP,
            "peer": peer(&alice_key.sender), "ciphertext": hex::encode(&sent[index]),
        })));
        assert_eq!(bytes(&decrypted, "plaintext"), expected.as_bytes());
    }

    // Go sends to the group.
    let go_distribution = ok(oracle.call(json!({
        "op": "create_sender_key", "device": "bob", "group": GROUP, "peer": peer(&bob_key.sender),
    })));
    protocol
        .process_sender_key_distribution_message(
            alice,
            &bob_key,
            &bytes(&go_distribution, "message"),
        )
        .await
        .expect("Rust stores Go's sender key");
    let received: Vec<Vec<u8>> = ["go group zero", "go group one", "go group two"]
        .into_iter()
        .map(|plaintext| {
            bytes(
                &ok(oracle.call(json!({
                    "op": "group_encrypt", "device": "bob", "group": GROUP,
                    "peer": peer(&bob_key.sender), "plaintext": hex::encode(plaintext),
                }))),
                "ciphertext",
            )
        })
        .collect();
    for (index, expected) in [
        (1, "go group one"),
        (2, "go group two"),
        (0, "go group zero"),
    ] {
        assert_eq!(
            protocol
                .group_decrypt(alice, &bob_key, &received[index])
                .await
                .expect("Rust decrypts Go's group message"),
            expected.as_bytes()
        );
    }
    assert!(matches!(
        protocol.group_decrypt(alice, &bob_key, &received[0]).await,
        Err(SignalError::OldCounter)
    ));
    let mut forged = received[2].clone();
    let last = forged.len() - 1;
    forged[last] ^= 0x01;
    assert!(matches!(
        protocol.group_decrypt(alice, &bob_key, &forged).await,
        Err(SignalError::Internal(_))
    ));

    // Both sides rotate; a message under each old key is still in flight.
    let rust_in_flight = protocol
        .group_encrypt(alice, &alice_key, b"rust in flight")
        .await
        .expect("Rust encrypts under the old key");
    alice.delete_sender_key(&alice_key);
    let rotated = protocol
        .create_sender_key_distribution_message(alice, &alice_key)
        .await
        .expect("Rust creates a new sender key");
    assert_ne!(rotated, distribution);
    ok(oracle.call(json!({
        "op": "process_sender_key", "device": "bob", "group": GROUP,
        "peer": peer(&alice_key.sender), "message": hex::encode(&rotated),
    })));
    let rust_rotated = protocol
        .group_encrypt(alice, &alice_key, b"rust rotated")
        .await
        .expect("Rust encrypts under the new key");
    for (message, expected) in [
        (&rust_rotated, &b"rust rotated"[..]),
        (&rust_in_flight, b"rust in flight"),
    ] {
        let decrypted = ok(oracle.call(json!({
            "op": "group_decrypt", "device": "bob", "group": GROUP,
            "peer": peer(&alice_key.sender), "ciphertext": hex::encode(message),
        })));
        assert_eq!(bytes(&decrypted, "plaintext"), expected);
    }

    let go_in_flight = bytes(
        &ok(oracle.call(json!({
            "op": "group_encrypt", "device": "bob", "group": GROUP,
            "peer": peer(&bob_key.sender), "plaintext": hex::encode("go in flight"),
        }))),
        "ciphertext",
    );
    ok(oracle.call(json!({
        "op": "delete_sender_key", "device": "bob", "group": GROUP, "peer": peer(&bob_key.sender),
    })));
    let go_rotated_distribution = ok(oracle.call(json!({
        "op": "create_sender_key", "device": "bob", "group": GROUP, "peer": peer(&bob_key.sender),
    })));
    protocol
        .process_sender_key_distribution_message(
            alice,
            &bob_key,
            &bytes(&go_rotated_distribution, "message"),
        )
        .await
        .expect("Rust stores Go's new sender key");
    let go_rotated = bytes(
        &ok(oracle.call(json!({
            "op": "group_encrypt", "device": "bob", "group": GROUP,
            "peer": peer(&bob_key.sender), "plaintext": hex::encode("go rotated"),
        }))),
        "ciphertext",
    );
    assert_eq!(
        protocol
            .group_decrypt(alice, &bob_key, &go_rotated)
            .await
            .expect("Rust decrypts under Go's new key"),
        b"go rotated"
    );
    assert_eq!(
        protocol
            .group_decrypt(alice, &bob_key, &go_in_flight)
            .await
            .expect("Rust decrypts under Go's old key"),
        b"go in flight"
    );
}

async fn conversation(oracle: &mut dyn Oracle) {
    let protocol = Libsignal::seeded(PROTOCOL_SEED);
    let signatures = Libsignal::seeded(SIGNATURE_SEED);
    let mut generator = StdRng::seed_from_u64(KEY_SEED);
    let alice = TestStore::new(&mut generator, &signatures, 1001, &[]);
    let carol = TestStore::new(&mut generator, &signatures, 3003, &[77]);

    xeddsa(oracle, &signatures).await;
    rust_initiates(oracle, &protocol, &alice).await;
    go_initiates(oracle, &protocol, &carol).await;
    groups(oracle, &protocol, &alice).await;
}

#[tokio::test]
async fn replays_the_recorded_go_conversation() {
    let transcript =
        std::fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(TRANSCRIPT))
            .expect("the transcript is committed");
    let mut oracle = ReplayOracle {
        exchanges: serde_json::from_str(&transcript).expect("the transcript parses"),
    };
    conversation(&mut oracle).await;
    assert!(
        oracle.exchanges.is_empty(),
        "the conversation used the whole transcript"
    );
}

#[tokio::test]
#[ignore = "needs Go; run locally (see testdata/generator/README.md)"]
async fn talks_to_go_libsignal() {
    let mut oracle = LiveOracle::start();
    conversation(&mut oracle).await;
    oracle.finish();
}

#[tokio::test]
#[ignore = "needs Go; rewrites testdata/interop_transcript.json"]
async fn record_go_transcript() {
    let mut oracle = LiveOracle::start();
    conversation(&mut oracle).await;
    let exchanges = oracle.finish();
    let mut transcript =
        serde_json::to_string_pretty(&exchanges).expect("the transcript serializes");
    transcript.push('\n');
    std::fs::write(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(TRANSCRIPT),
        transcript,
    )
    .expect("the transcript is writable");
}
