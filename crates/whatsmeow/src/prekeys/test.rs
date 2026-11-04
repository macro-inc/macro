// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected bytes come from whatsmeow's `preKeyToNode` and
//! `nodeToPreKeyBundle` (see `testdata/generator`).

use super::*;
use crate::binary::marshal;
use crate::util::keys::new_key_pair_from_private_key;
use crate::vectors::Vectors;

fn fixed_private_key(start: u8) -> [u8; 32] {
    std::array::from_fn(|index| start.wrapping_add(u8::try_from(index).unwrap()))
}

#[test]
fn pre_key_nodes_match_go() {
    let vectors = Vectors::load("prekeys.json");
    let pre_key = PreKey {
        key_pair: new_key_pair_from_private_key(fixed_private_key(0x30)),
        key_id: 0x01_02_03,
        signature: None,
    };
    assert_eq!(
        hex::encode(marshal(&pre_key_to_node(&pre_key)).unwrap()),
        vectors.string("pre_key_node")
    );
    let signed_pre_key = PreKey {
        key_pair: new_key_pair_from_private_key(fixed_private_key(0x50)),
        key_id: 1,
        signature: Some([0x77; 64]),
    };
    assert_eq!(
        hex::encode(marshal(&pre_key_to_node(&signed_pre_key)).unwrap()),
        vectors.string("signed_pre_key_node")
    );
}

#[test]
fn pre_key_bundles_parse_like_go() {
    let vectors = Vectors::load("prekeys.json");
    let user = vectors.node("bundle_user_node");
    let bundle = node_to_pre_key_bundle(7, &user).unwrap();
    assert_eq!(
        bundle.registration_id,
        vectors.u64("bundle_registration_id") as u32
    );
    assert_eq!(bundle.device_id, 7);
    assert_eq!(
        bundle.pre_key,
        Some((
            vectors.u64("bundle_pre_key_id") as u32,
            vectors.bytes("bundle_pre_key_public").try_into().unwrap()
        ))
    );
    assert_eq!(
        bundle.signed_pre_key_id,
        vectors.u64("bundle_signed_pre_key_id") as u32
    );
    assert_eq!(
        bundle.signed_pre_key_public.to_vec(),
        vectors.bytes("bundle_signed_pre_key_public")
    );
    assert_eq!(
        bundle.signed_pre_key_signature.to_vec(),
        vectors.bytes("bundle_signed_pre_key_signature")
    );
    assert_eq!(
        bundle.identity_key.to_vec(),
        vectors.bytes("bundle_identity_key")
    );

    let without_pre_key = vectors.node("bundle_without_pre_key_node");
    assert_eq!(
        node_to_pre_key_bundle(7, &without_pre_key).unwrap().pre_key,
        None
    );

    let error = vectors.node("bundle_error_node");
    assert_eq!(
        node_to_pre_key_bundle(7, &error).unwrap_err().to_string(),
        vectors.string("bundle_error_message")
    );
}

#[test]
fn received_pre_keys_reject_bad_lengths() {
    let key = pre_key_to_node(&PreKey {
        key_pair: new_key_pair_from_private_key(fixed_private_key(1)),
        key_id: 9,
        signature: None,
    });
    let parsed = node_to_pre_key(&key).unwrap();
    assert_eq!(parsed.key_id, 9);
    assert_eq!(parsed.signature, None);

    let mut short = key.clone();
    if let Some(NodeContent::Nodes(children)) = &mut short.content {
        children[0].content = Some(NodeContent::Bytes(vec![1, 2]));
    }
    assert_eq!(
        node_to_pre_key(&short).unwrap_err(),
        "prekey ID has unexpected number of bytes (2, expected 3)"
    );
}
