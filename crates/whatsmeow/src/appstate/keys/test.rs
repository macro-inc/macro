// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision.

use super::*;
use crate::appstate::vectors;

#[test]
fn expand_app_state_keys_matches_go() {
    let vectors = vectors::load();
    assert_eq!(vectors.expanded_keys.len(), 2);
    for vector in vectors.expanded_keys {
        let keys = expand_app_state_keys(&vector.key_data.0);
        assert_eq!(keys.index.to_vec(), vector.index.0);
        assert_eq!(keys.value_encryption.to_vec(), vector.value_encryption.0);
        assert_eq!(keys.value_mac.to_vec(), vector.value_mac.0);
        assert_eq!(keys.snapshot_mac.to_vec(), vector.snapshot_mac.0);
        assert_eq!(keys.patch_mac.to_vec(), vector.patch_mac.0);
    }
}

#[tokio::test]
async fn get_app_state_key_caches_and_reports_missing_keys() {
    let vectors = vectors::load();
    let (store, processor) = vectors::processor_with_keys(&vectors.sequence.keys).await;
    let key = &vectors.sequence.keys[0];

    let keys = processor.get_app_state_key(&key.id.0).await.unwrap();
    assert_eq!(keys, expand_app_state_keys(&key.data.0));

    // Served from the cache once loaded, even if the store changes.
    store
        .put_app_state_sync_key(
            &key.id.0,
            crate::store::AppStateSyncKey {
                data: vec![9; 32],
                fingerprint: Vec::new(),
                timestamp: 0,
            },
        )
        .await
        .unwrap();
    assert_eq!(processor.get_app_state_key(&key.id.0).await.unwrap(), keys);

    let missing = processor.get_app_state_key(b"missing").await.unwrap_err();
    assert_eq!(missing.to_string(), "didn't find app state key");
    assert_eq!(missing.sentinel(), Some(AppStateError::KeyNotFound));
}

#[test]
fn patch_names_match_go() {
    assert_eq!(
        ALL_PATCH_NAMES.map(|name| name.to_string()),
        [
            "critical_block",
            "critical_unblock_low",
            "regular_high",
            "regular",
            "regular_low"
        ]
    );
}

#[test]
fn processor_futures_are_send_for_spawning() {
    fn assert_send<Future: Send>(_: Future) {}
    let store = Arc::new(crate::store::MemoryStore::default());
    let processor = Processor {
        key_cache: Default::default(),
        app_state_keys: store.clone(),
        app_state: store,
    };
    let list = PatchList {
        name: WA_PATCH_REGULAR,
        has_more_patches: false,
        patches: Vec::new(),
        snapshot: None,
    };
    assert_send(processor.decode_patches(&list, Default::default(), true));
    assert_send(processor.get_missing_key_ids(&list));
    assert_send(processor.encode_patch(
        b"key",
        Default::default(),
        crate::appstate::build_setting_push_name("Wolf"),
    ));
    assert_send(processor.process_recovery(&Default::default()));
}
