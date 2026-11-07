// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The ciphertexts below were produced by whatsmeow's Go `NoiseHandshake` at
//! the pinned revision, with the same fixed keys.

use super::*;
use crate::socket::{NOISE_START_PATTERN, WA_CONN_HEADER};
use crate::util::keys::new_key_pair_from_private_key;

fn fixed_private_key(start: u8) -> [u8; 32] {
    std::array::from_fn(|index| start + u8::try_from(index).unwrap())
}

#[test]
fn handshake_operations_match_go() {
    let client = new_key_pair_from_private_key(fixed_private_key(0x10));
    let server = new_key_pair_from_private_key(fixed_private_key(0x50));
    let noise = new_key_pair_from_private_key(fixed_private_key(0x90));
    assert_eq!(
        hex::encode(server.public),
        "392d174a38b3b1beafaf1fe824870841c5fa531bc6eafdb6402c124664488c1c"
    );

    let mut handshake = NoiseHandshake::start(NOISE_START_PATTERN, &WA_CONN_HEADER).unwrap();
    handshake.authenticate(&client.public);
    handshake.authenticate(&server.public);
    handshake
        .mix_shared_secret_into_key(client.private, server.public)
        .unwrap();
    assert_eq!(
        hex::encode(handshake.encrypt(b"first").unwrap()),
        "dfe67f8ad4a53540f16673a4667d76cc7a53bcacef"
    );
    assert_eq!(
        hex::encode(handshake.encrypt(b"second").unwrap()),
        "93e26bf20321b4d5f5c6cc314fca95950325fee98ea6"
    );
    handshake
        .mix_shared_secret_into_key(noise.private, server.public)
        .unwrap();
    assert_eq!(
        hex::encode(handshake.encrypt(b"third").unwrap()),
        "214324a0b83628dcb1ac495714baf780f574140b10"
    );
}

#[test]
fn mixing_rejects_low_order_points() {
    let client = new_key_pair_from_private_key(fixed_private_key(0x10));
    let mut handshake = NoiseHandshake::start(NOISE_START_PATTERN, &WA_CONN_HEADER).unwrap();
    assert_eq!(
        handshake.mix_shared_secret_into_key(client.private, [0; 32]),
        Err(NoiseHandshakeError::LowOrderPoint)
    );
}

#[test]
fn both_sides_of_an_xx_handshake_agree() {
    let client_ephemeral = new_key_pair_from_private_key(fixed_private_key(0x10));
    let client_static = new_key_pair_from_private_key(fixed_private_key(0x90));
    let server_ephemeral = new_key_pair_from_private_key(fixed_private_key(0x50));
    let server_static = new_key_pair_from_private_key(fixed_private_key(0x70));

    let mut client = NoiseHandshake::start(NOISE_START_PATTERN, &WA_CONN_HEADER).unwrap();
    let mut server = NoiseHandshake::start(NOISE_START_PATTERN, &WA_CONN_HEADER).unwrap();

    // -> e
    client.authenticate(&client_ephemeral.public);
    server.authenticate(&client_ephemeral.public);
    // <- e, ee, s, es
    server.authenticate(&server_ephemeral.public);
    server
        .mix_shared_secret_into_key(server_ephemeral.private, client_ephemeral.public)
        .unwrap();
    let static_ciphertext = server.encrypt(&server_static.public).unwrap();
    server
        .mix_shared_secret_into_key(server_static.private, client_ephemeral.public)
        .unwrap();
    let payload_ciphertext = server.encrypt(b"certificate").unwrap();

    client.authenticate(&server_ephemeral.public);
    client
        .mix_shared_secret_into_key(client_ephemeral.private, server_ephemeral.public)
        .unwrap();
    assert_eq!(
        client.decrypt(&static_ciphertext).unwrap(),
        server_static.public
    );
    client
        .mix_shared_secret_into_key(client_ephemeral.private, server_static.public)
        .unwrap();
    assert_eq!(client.decrypt(&payload_ciphertext).unwrap(), b"certificate");

    // -> s, se
    let client_static_ciphertext = client.encrypt(&client_static.public).unwrap();
    client
        .mix_shared_secret_into_key(client_static.private, server_ephemeral.public)
        .unwrap();
    let client_payload_ciphertext = client.encrypt(b"client payload").unwrap();

    assert_eq!(
        server.decrypt(&client_static_ciphertext).unwrap(),
        client_static.public
    );
    server
        .mix_shared_secret_into_key(server_ephemeral.private, client_static.public)
        .unwrap();
    assert_eq!(
        server.decrypt(&client_payload_ciphertext).unwrap(),
        b"client payload"
    );

    assert_eq!(client.hash, server.hash);
    assert_eq!(
        extract_and_expand(&client.salt, &[]),
        extract_and_expand(&server.salt, &[])
    );
}

#[test]
fn tampered_ciphertext_doesnt_change_the_hash() {
    let mut sender = NoiseHandshake::start(NOISE_START_PATTERN, &WA_CONN_HEADER).unwrap();
    let mut receiver = NoiseHandshake::start(NOISE_START_PATTERN, &WA_CONN_HEADER).unwrap();
    let mut ciphertext = sender.encrypt(b"payload").unwrap();
    ciphertext[0] ^= 1;
    let hash_before = receiver.hash;
    assert_eq!(receiver.decrypt(&ciphertext), Err(GcmError::Authentication));
    assert_eq!(receiver.hash, hash_before);
}
