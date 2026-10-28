// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The QR string was produced by whatsmeow's Go code at the pinned revision
//! with the same keys.

use std::sync::{Arc, Mutex};

use super::*;
use crate::store::MemoryStore;
use crate::util::keys::new_key_pair_from_private_key;

/// Records the messages it signs or verifies; accepts only `[7; 64]`.
#[derive(Default)]
struct RecordingSignatures {
    messages: Mutex<Vec<(Vec<u8>, Vec<u8>)>>,
}

impl CurveSignatures for RecordingSignatures {
    fn calculate_signature(&self, private_key: &[u8; 32], message: &[u8]) -> [u8; 64] {
        self.messages
            .lock()
            .unwrap()
            .push((private_key.to_vec(), message.to_vec()));
        [7; 64]
    }

    fn verify_signature(
        &self,
        public_key: &[u8; 32],
        message: &[u8],
        signature: &[u8; 64],
    ) -> bool {
        self.messages
            .lock()
            .unwrap()
            .push((public_key.to_vec(), message.to_vec()));
        *signature == [7; 64]
    }
}

fn fixed_private_key(start: u8) -> [u8; 32] {
    std::array::from_fn(|index| start + u8::try_from(index).unwrap())
}

#[test]
fn qr_data_matches_go() {
    let mut device = Arc::new(MemoryStore::default()).new_device(&RecordingSignatures::default());
    device.noise_key = new_key_pair_from_private_key(fixed_private_key(0x90));
    device.identity_key = new_key_pair_from_private_key(fixed_private_key(0x20));
    device.adv_secret_key = (0xa0..0xc0).collect();

    let client_type = get_qr_client_type(None);
    assert_eq!(client_type, PairClientType::OtherWebClient);
    assert_eq!(
        make_qr_data(&device, b"2@abcDEF+/==", client_type),
        "https://wa.me/settings/linked_devices#2@abcDEF+/==,n9etbc/0KY3T+W1bGyr5EKBTWxSI1/j6uzSamCiAthU=,NYBy1jZYgNGu6jKa35EhODhR7SGijjt16WXQ0s0WYlQ=,oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8=,9"
    );
    assert_eq!(
        get_qr_client_type(Some(PairClientType::MacOs)).to_string(),
        "c"
    );
}

#[test]
fn account_signature_covers_prefix_details_and_identity_key() {
    let identity_key = new_key_pair_from_private_key(fixed_private_key(0x20));
    let device_identity = AdvSignedDeviceIdentity {
        details: Some(b"details".to_vec()),
        account_signature_key: Some(vec![3; 32]),
        account_signature: Some(vec![7; 64]),
        device_signature: None,
    };
    let signatures = RecordingSignatures::default();
    assert!(verify_account_signature(
        &device_identity,
        &identity_key,
        false,
        &signatures
    ));
    assert!(verify_account_signature(
        &device_identity,
        &identity_key,
        true,
        &signatures
    ));
    let messages = signatures.messages.into_inner().unwrap();
    assert_eq!(messages[0].0, vec![3; 32]);
    assert_eq!(
        messages[0].1,
        [&[6, 0][..], b"details", &identity_key.public].concat()
    );
    assert_eq!(
        messages[1].1,
        [&[6, 5][..], b"details", &identity_key.public].concat()
    );

    let short_signature = AdvSignedDeviceIdentity {
        account_signature: Some(vec![7; 63]),
        ..device_identity
    };
    assert!(!verify_account_signature(
        &short_signature,
        &identity_key,
        false,
        &RecordingSignatures::default()
    ));
}

#[test]
fn device_signature_covers_the_account_key_too() {
    let identity_key = new_key_pair_from_private_key(fixed_private_key(0x20));
    let device_identity = AdvSignedDeviceIdentity {
        details: Some(b"details".to_vec()),
        account_signature_key: Some(vec![3; 32]),
        account_signature: Some(vec![7; 64]),
        device_signature: None,
    };
    let signatures = RecordingSignatures::default();
    assert_eq!(
        generate_device_signature(&device_identity, &identity_key, &signatures),
        [7; 64]
    );
    let messages = signatures.messages.into_inner().unwrap();
    assert_eq!(messages[0].0, identity_key.private.to_vec());
    assert_eq!(
        messages[0].1,
        [&[6, 1][..], b"details", &identity_key.public, &[3; 32]].concat()
    );
}

#[test]
fn concat_bytes_matches_go() {
    assert_eq!(concat_bytes(&[&[1, 2], &[], &[3]]), vec![1, 2, 3]);
}
