// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision.

use super::*;
use crate::appstate::vectors;
use crate::store::AppStateStore;

#[tokio::test]
async fn parse_and_process_recovery_match_go() {
    let vectors = vectors::load();
    let recovery = vectors.recovery;
    assert!(recovery.is_compressed);
    let (store, processor) = vectors::processor_with_keys(&vectors.sequence.keys).await;
    // A version that the recovery replaces.
    store
        .put_app_state_version(&recovery.name, 7, [9; 128])
        .await
        .unwrap();

    let parsed = parse_recovery(&SyncDSnapshotFatalRecoveryResponse {
        collection_snapshot: Some(recovery.collection_snapshot.0.clone()),
        is_compressed: Some(true),
    })
    .unwrap();
    assert_eq!(parsed.collection_name.as_deref(), Some("regular_low"));

    let mutations = processor.process_recovery(&parsed).await.unwrap();
    assert_eq!(
        mutations,
        recovery
            .mutations
            .iter()
            .map(vectors::MutationVector::to_mutation)
            .collect::<Vec<_>>()
    );
    let (version, hash) = store.get_app_state_version(&recovery.name).await.unwrap();
    assert_eq!(version, recovery.stored_state.0.version);
    assert_eq!(hash, recovery.stored_state.0.hash);
    vectors::assert_lookups(&store, &recovery.name, &recovery.lookups).await;

    // The same snapshot uncompressed.
    let uncompressed = parse_recovery(&SyncDSnapshotFatalRecoveryResponse {
        collection_snapshot: Some(parsed.encode_to_vec()),
        is_compressed: Some(false),
    })
    .unwrap();
    assert_eq!(uncompressed, parsed);
}

#[tokio::test]
async fn process_recovery_rejects_an_invalid_lthash_like_go() {
    let vectors = vectors::load();
    let (_, processor) = vectors::processor_with_keys(&vectors.sequence.keys).await;
    let invalid =
        SyncdSnapshotRecovery::decode(vectors.recovery.invalid_lthash_snapshot.0.as_slice())
            .unwrap();
    let error = processor.process_recovery(&invalid).await.unwrap_err();
    assert_eq!(error.to_string(), vectors.recovery.invalid_lthash_error);
}

#[test]
fn parse_recovery_reports_bad_gzip() {
    let error = parse_recovery(&SyncDSnapshotFatalRecoveryResponse {
        collection_snapshot: Some(b"not gzip".to_vec()),
        is_compressed: Some(true),
    })
    .unwrap_err();
    assert!(
        error.to_string().starts_with("failed to decompress: "),
        "{error}"
    );
}
