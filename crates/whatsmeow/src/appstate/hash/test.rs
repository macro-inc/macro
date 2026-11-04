// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision.

use prost::Message;

use super::*;
use crate::appstate::vectors;
use crate::store::{NoopError, NoopStore};

#[test]
fn generate_snapshot_mac_matches_go() {
    let vectors = vectors::load();
    for vector in vectors.snapshot_mac {
        let state = HashState {
            version: vector.version,
            hash: vector.hash.0.try_into().unwrap(),
        };
        let name = WaPatchName::from(vector.name);
        assert_eq!(
            hex::encode(state.generate_snapshot_mac(&name, &vector.key.0)),
            hex::encode(&vector.mac.0)
        );
    }
}

#[test]
fn generate_patch_mac_matches_go() {
    let vectors = vectors::load();
    assert_eq!(vectors.patch_mac.len(), 2);
    for vector in vectors.patch_mac {
        let patch = SyncdPatch::decode(vector.patch.0.as_slice()).unwrap();
        let name = WaPatchName::from(vector.name);
        assert_eq!(
            hex::encode(generate_patch_mac(&patch, &name, &vector.key.0, vector.version).unwrap()),
            hex::encode(&vector.mac.0)
        );
    }
}

#[test]
fn generate_patch_mac_rejects_short_values() {
    let patch = SyncdPatch {
        mutations: vec![SyncdMutation {
            operation: Some(SyncdOperation::Remove as i32),
            record: Some(crate::proto::wa_server_sync::SyncdRecord {
                value: Some(crate::proto::wa_server_sync::SyncdValue {
                    blob: Some(vec![1; 31]),
                }),
                ..Default::default()
            }),
        }],
        ..SyncdPatch::default()
    };
    let name = WaPatchName::from("regular".to_owned());
    assert_eq!(
        generate_patch_mac(&patch, &name, &[0; 32], 1),
        Err(ShortValueError(31))
    );
}

#[test]
fn generate_content_mac_matches_go_for_every_operation_byte() {
    let vectors = vectors::load();
    // SET, REMOVE, and 255, which Go's byte(operation)+1 wraps to 0.
    assert_eq!(
        vectors
            .content_mac
            .iter()
            .map(|vector| vector.operation)
            .collect::<Vec<_>>(),
        vec![0, 1, 255]
    );
    for vector in vectors.content_mac {
        assert_eq!(
            hex::encode(generate_content_mac(
                vector.operation,
                &vector.data.0,
                &vector.key_id.0,
                &vector.key.0
            )),
            hex::encode(&vector.mac.0)
        );
    }
}

#[test]
fn index_mac_matches_go() {
    let vectors = vectors::load();
    for vector in vectors.index_mac {
        assert_eq!(
            hex::encode(concat_and_hmac::<Hmac<Sha256>>(
                &vector.key.0,
                &[&vector.index.0]
            )),
            hex::encode(&vector.mac.0)
        );
    }
}

#[tokio::test]
async fn update_hash_warns_on_remove_without_previous_value_and_stops_on_store_errors() {
    let remove = SyncdMutation {
        operation: Some(SyncdOperation::Remove as i32),
        record: Some(crate::proto::wa_server_sync::SyncdRecord {
            index: Some(crate::proto::wa_server_sync::SyncdIndex {
                blob: Some(vec![0xab, 0xcd]),
            }),
            ..Default::default()
        }),
    };
    let mut state = HashState::default();
    let (warnings, result) = state
        .update_hash(std::slice::from_ref(&remove), PreviousValueMacs::Empty)
        .await;
    result.unwrap();
    assert_eq!(
        warnings,
        vec![MissingPreviousSetValueWarning {
            index_mac: vec![0xab, 0xcd]
        }]
    );
    assert_eq!(
        warnings[0].to_string(),
        "missing value MAC of previous SET operation for ABCD"
    );
    assert_eq!(state, HashState::default());

    let deleted = NoopStore {
        error: NoopError::DeviceDeleted,
    };
    let name = WaPatchName::from("regular".to_owned());
    let (_, result) = state
        .update_hash(
            &[remove],
            PreviousValueMacs::Store {
                app_state: &deleted,
                name: &name,
            },
        )
        .await;
    assert_eq!(
        result.unwrap_err().to_string(),
        "failed to get value MAC of previous SET operation: invalid use of deleted device"
    );
}
