// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision.

use std::sync::Mutex;

use super::*;

#[test]
fn public_key_matches_go_for_a_fixed_private_key() {
    let private = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
        26, 27, 28, 29, 30, 31, 32,
    ];
    let key_pair = new_key_pair_from_private_key(private);
    assert_eq!(
        hex::encode(key_pair.public),
        "07a37cbc142093c8b755dc1b10e86cb426374ad16aa853ed0bdfc0b2b86d1c7c"
    );
    // Go stores the private key as given; clamping only happens in new_key_pair.
    assert_eq!(key_pair.private, private);
}

#[test]
fn new_key_pair_clamps_the_private_key() {
    let key_pair = new_key_pair();
    assert_eq!(key_pair.private[0] & 7, 0);
    assert_eq!(key_pair.private[31] & 128, 0);
    assert_eq!(key_pair.private[31] & 64, 64);
    assert_eq!(new_key_pair_from_private_key(key_pair.private), key_pair);
}

/// Records what it was asked to sign and returns a fixed signature.
struct RecordingSignatures {
    signed: Mutex<Vec<([u8; 32], Vec<u8>)>>,
}

impl CurveSignatures for RecordingSignatures {
    fn calculate_signature(&self, private_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
        self.signed
            .lock()
            .unwrap()
            .push((*private_key, message.to_vec()));
        [7; 64]
    }

    fn verify_signature(&self, _: &[u8; 32], _: &[u8], _: &[u8; 64]) -> bool {
        false
    }
}

#[test]
fn signed_pre_key_signs_the_type_prefixed_public_key() {
    let signatures = RecordingSignatures {
        signed: Mutex::new(Vec::new()),
    };
    let identity = new_key_pair();
    let pre_key = identity.create_signed_pre_key(&signatures, 42);

    assert_eq!(pre_key.key_id, 42);
    assert_eq!(pre_key.signature, Some([7; 64]));
    let signed = signatures.signed.into_inner().unwrap();
    assert_eq!(signed.len(), 1);
    assert_eq!(signed[0].0, identity.private);
    assert_eq!(signed[0].1[0], 5);
    assert_eq!(signed[0].1[1..], pre_key.key_pair.public);
}

#[test]
fn debug_output_hides_the_private_key() {
    let key_pair = new_key_pair_from_private_key([0x11; 32]);
    let debug = format!("{key_pair:?}");
    assert!(debug.contains(&hex::encode(key_pair.public)));
    assert!(!debug.contains(&hex::encode(key_pair.private)));
}
