// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision.
//! Go encodes with random IVs, so encoded patches are checked by decoding them
//! with MAC validation on top of the state Go's patches left behind.

use chrono::TimeZone;

use super::*;
use crate::appstate::decode::PatchList;
use crate::appstate::hash::Mutation;
use crate::appstate::vectors;
use crate::proto::wa_server_sync::SyncdVersion;
use crate::store::AppStateStore;
use crate::types::{DEFAULT_USER_SERVER, GROUP_SERVER, new_jid};

#[test]
fn marshal_index_matches_go_json() {
    let vectors = vectors::load();
    assert_eq!(vectors.index_json.len(), 3);
    for vector in vectors.index_json {
        assert_eq!(
            String::from_utf8(marshal_index(&vector.index)).unwrap(),
            vector.json
        );
    }
}

#[test]
fn builders_match_go() {
    let vectors = vectors::load();
    let chat_a = new_jid("111111111", DEFAULT_USER_SERVER);
    let chat_b = new_jid("222222222", DEFAULT_USER_SERVER);
    let chat_c = new_jid("333333333", DEFAULT_USER_SERVER);
    let group = new_jid("120363000000000000", GROUP_SERVER);
    let at = Utc.timestamp_opt(1_760_000_000, 0).unwrap();
    let key = MessageKey {
        remote_jid: Some(chat_a.to_string()),
        from_me: Some(true),
        id: Some("3EB0KEY".to_owned()),
        participant: None,
    };
    let built = vec![
        build_mute_abs(&chat_a, true, None),
        build_mute_abs(&chat_a, true, Some(1_760_003_600_000)),
        build_mute_abs(&chat_a, false, None),
        build_pin(&chat_b, true),
        build_archive(&chat_a, true, Some(at), Some(key.clone())),
        build_archive(&chat_a, false, Some(at), None),
        build_mark_chat_as_read(&chat_b, false, Some(at), Some(key.clone())),
        build_label_chat(&chat_a, "7", true),
        build_label_message(&chat_a, "7", "3EB0MSG", false),
        build_label_edit("7", "Work", 3, false),
        build_setting_push_name("Wolf"),
        build_star(&chat_a, &chat_a, "3EB0MSG", true, true),
        build_star(&group, &chat_b, "3EB0MSG", false, false),
        build_delete_chat(&chat_c, Some(at), Some(key), true),
    ];
    assert_eq!(built.len(), vectors.builders.len());
    for (patch_info, expected) in built.into_iter().zip(vectors.builders) {
        assert_eq!(patch_info.timestamp, None);
        assert_eq!(patch_info.patch_type.as_str(), expected.patch_type);
        assert_eq!(
            patch_info.mutations,
            expected
                .mutations
                .iter()
                .map(|mutation| MutationInfo {
                    index: mutation.index.clone(),
                    version: mutation.version,
                    value: SyncActionValue::decode(mutation.value.0.as_slice()).unwrap(),
                })
                .collect::<Vec<_>>()
        );
    }
}

#[test]
fn build_mute_with_a_duration_ends_after_it() {
    let chat = new_jid("111111111", DEFAULT_USER_SERVER);
    let before = Utc::now().timestamp_millis();
    let patch_info = build_mute(&chat, true, TimeDelta::hours(8));
    let end = patch_info.mutations[0]
        .value
        .mute_action
        .unwrap()
        .mute_end_timestamp
        .unwrap();
    let after = Utc::now().timestamp_millis();
    assert!(end >= before + 8 * 3_600_000 && end <= after + 8 * 3_600_000);
    assert_eq!(
        build_mute(&chat, true, TimeDelta::zero()).mutations[0]
            .value
            .mute_action
            .unwrap()
            .mute_end_timestamp,
        Some(-1)
    );
}

#[tokio::test]
async fn encoded_patches_decode_with_valid_macs_on_top_of_gos_state() {
    let vectors = vectors::load();
    let sequence = vectors.sequence;
    let (store, processor) = vectors::processor_with_keys(&sequence.keys).await;
    for step in &sequence.steps {
        processor
            .decode_patches(
                &step.list.to_patch_list(&sequence.name),
                step.initial_state.0,
                true,
            )
            .await
            .unwrap();
    }
    let (version, hash) = store.get_app_state_version(&sequence.name).await.unwrap();
    let state = HashState { version, hash };
    assert_eq!(state, sequence.steps[1].state.0);

    // Overwrites the mute of chat A that Go set in the snapshot and patch v4, and adds a star.
    let chat_a = new_jid("111111111", DEFAULT_USER_SERVER);
    let chat_d = new_jid("444444444", DEFAULT_USER_SERVER);
    let mut patch_info = build_mute_abs(&chat_a, true, Some(1_770_000_000_000));
    patch_info
        .mutations
        .extend(build_star(&chat_d, &chat_a, "3EB0NEW", false, true).mutations);
    patch_info.timestamp = Some(Utc.timestamp_millis_opt(1_760_000_009_000).unwrap());
    let key_id = &sequence.keys[0].id.0;

    let encoded = processor
        .encode_patch(key_id, state, patch_info.clone())
        .await
        .unwrap();

    let mut patch = SyncdPatch::decode(encoded.as_slice()).unwrap();
    assert_eq!(patch.version, None);
    // The server assigns the next version.
    patch.version = Some(SyncdVersion {
        version: Some(version + 1),
    });
    let list = PatchList {
        name: WA_PATCH_REGULAR_HIGH,
        has_more_patches: false,
        patches: vec![patch.clone()],
        snapshot: None,
    };
    let (mutations, new_state) = processor.decode_patches(&list, state, true).await.unwrap();
    assert_eq!(new_state.version, version + 1);
    assert_ne!(new_state.hash, state.hash);
    let expected: Vec<Mutation> = patch_info
        .mutations
        .iter()
        .zip(&patch.mutations)
        .map(|(info, encoded)| {
            let mut value = info.value.clone();
            value.timestamp = Some(1_760_000_009_000);
            let record = encoded.record.clone().unwrap();
            let blob = record.value.unwrap().blob.unwrap();
            Mutation {
                key_id: key_id.clone(),
                operation: SyncdOperation::Set as i32,
                action: Some(value),
                version: info.version,
                index: info.index.clone(),
                index_mac: record.index.unwrap().blob.unwrap(),
                value_mac: blob[blob.len() - 32..].to_vec(),
                patch_version: version + 1,
            }
        })
        .collect();
    assert_eq!(mutations, expected);
    // The overwritten mute's index MAC is the one Go stored for chat A.
    assert_eq!(
        mutations[0].index_mac,
        sequence.steps[0].mutations[0].index_mac.0
    );

    // The same patch on a stale state fails the LT hash check.
    let error = processor
        .decode_patches(&list, sequence.steps[0].state.0, true)
        .await
        .unwrap_err();
    assert_eq!(
        error.sentinel(),
        Some(AppStateError::MismatchingLtHash),
        "{error}"
    );
}

#[tokio::test]
async fn encode_patch_reports_missing_keys() {
    let vectors = vectors::load();
    let (_, processor) = vectors::processor_with_keys(&vectors.sequence.keys).await;
    let error = processor
        .encode_patch(
            b"missing",
            HashState::default(),
            build_setting_push_name("Wolf"),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "failed to get app state key details with key ID 6d697373696e67: didn't find app state key"
    );
    assert_eq!(error.sentinel(), Some(AppStateError::KeyNotFound));
}
