// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The expected bytes were produced by whatsmeow's Go code at the pinned
//! revision, with the same fixed keys.

use std::sync::Arc;

use super::*;
use crate::signal::CurveSignatures;
use crate::store::MemoryStore;
use crate::types::{DEFAULT_USER_SERVER, Jid};
use crate::util::keys::{PreKey, new_key_pair_from_private_key};

struct UnusedSignatures;

impl CurveSignatures for UnusedSignatures {
    fn calculate_signature(&self, _: &[u8; 32], _: &[u8]) -> [u8; 64] {
        [0; 64]
    }

    fn verify_signature(&self, _: &[u8; 32], _: &[u8], _: &[u8; 64]) -> bool {
        false
    }
}

fn fixed_private_key(start: u8) -> [u8; 32] {
    std::array::from_fn(|index| start + u8::try_from(index).unwrap())
}

fn device_with_fixed_keys() -> Device {
    let mut device = Arc::new(MemoryStore::default()).new_device(&UnusedSignatures);
    device.identity_key = new_key_pair_from_private_key(fixed_private_key(0x20));
    device.signed_pre_key = PreKey {
        key_pair: new_key_pair_from_private_key(fixed_private_key(0x30)),
        key_id: 1,
        signature: Some(std::array::from_fn(|index| u8::try_from(index).unwrap())),
    };
    device.registration_id = 0x0102_0304;
    device
}

#[test]
fn registration_payload_matches_go() {
    let device = device_with_fixed_keys();
    assert_eq!(
        hex::encode(device.get_client_payload().unwrap().encode_to_vec()),
        "18002a38080e120b080210b8171884b483f5031a0330303022033030302a03302e3132003a074465736b746f704203302e3150005a02656e6202555332022000600168019a01e1010a04010203041201051a20358072d6365880d1aeea329adf9121383851ed21a28e3b75e965d0d2cd16625422030000012a2034e42d4af5ef94a07a3a84201b889d4cd1a743cb27b11b6a10438a8feb8e58473240000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f3a10ed6c6a921d03d857ec78c153a7f7a0cf42390a0977686174736d656f771206080010011800180020002a20188050200130013801400148015001580160017001780198013ca80101b00101880200"
    );
}

#[test]
fn login_payload_matches_go() {
    let mut device = device_with_fixed_keys();
    device.id = Some(Jid {
        user: "1234567890".to_owned(),
        device: 7,
        server: DEFAULT_USER_SERVER.to_owned(),
        ..Jid::default()
    });
    assert_eq!(
        hex::encode(device.get_client_payload().unwrap().encode_to_vec()),
        "08d285d8cc0418012a38080e120b080210b8171884b483f5031a0330303022033030302a03302e3132003a074465736b746f704203302e3150005a02656e620255533202200060016801900107c00101880201c80201"
    );

    device.id = Some(Jid::default());
    assert_eq!(
        device.get_client_payload(),
        Err(ClientPayloadError::EmptyJid)
    );
}

#[test]
fn os_info_changes_the_user_agent_and_device_props_like_go() {
    let os_info = Some(("Macro".to_owned(), [1, 2, 3]));
    let device = device_with_fixed_keys();
    let mut payload = build_base_client_payload(get_wa_version(), os_info.clone());
    let mut expected = device.get_client_payload().unwrap();
    expected.user_agent = payload.user_agent.take();
    if let Some(pairing_data) = expected.device_pairing_data.as_mut() {
        pairing_data.device_props = Some(build_device_props(os_info).encode_to_vec());
    }
    assert_eq!(
        hex::encode(expected.encode_to_vec()),
        "18002a3c080e120b080210b8171884b483f5031a0330303022033030302a05312e322e3332003a074465736b746f704205312e322e3350005a02656e6202555332022000600168019a01dd010a04010203041201051a20358072d6365880d1aeea329adf9121383851ed21a28e3b75e965d0d2cd16625422030000012a2034e42d4af5ef94a07a3a84201b889d4cd1a743cb27b11b6a10438a8feb8e58473240000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f3a10ed6c6a921d03d857ec78c153a7f7a0cf42350a054d6163726f1206080110021803180020002a20188050200130013801400148015001580160017001780198013ca80101b00101880200"
    );
}

#[test]
fn version_helpers_match_go() {
    let version = get_wa_version();
    assert_eq!(version.to_string(), "2.3000.1050728964");
    assert_eq!(
        hex::encode(version.hash()),
        "ed6c6a921d03d857ec78c153a7f7a0cf"
    );
    assert_eq!(
        parse_version("2.3000.1"),
        Ok(WaVersionContainer([2, 3000, 1]))
    );
    assert_eq!(
        parse_version("2.1").unwrap_err().to_string(),
        "'2.1' doesn't contain three dot-separated parts"
    );
    assert_eq!(
        parse_version("2.x.1").unwrap_err().to_string(),
        "second part of '2.x.1' is not a number: invalid digit found in string"
    );
    assert!(WaVersionContainer([2, 2999, 9]).less_than(&WaVersionContainer([2, 3000, 1])));
    assert!(!WaVersionContainer([2, 3000, 1]).less_than(&WaVersionContainer([2, 3000, 1])));
    assert!(WaVersionContainer::default().is_zero());
}
