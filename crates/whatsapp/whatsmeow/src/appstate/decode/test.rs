// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! Expected values were produced by whatsmeow's Go code at the pinned revision:
//! the generator builds a snapshot and patches with fixed IVs (one patch comes
//! from Go's `EncodePatch` with random IVs), and decodes them with Go's
//! `DecodePatches`.

use std::collections::BTreeMap;
use std::sync::Mutex;

use super::*;
use crate::appstate::vectors;
use crate::binary::AttributeValue;
use crate::proto::wa_server_sync::SyncdVersion;
use crate::store::AppStateStore;

#[tokio::test]
async fn decode_patches_matches_go_for_a_snapshot_and_patches_then_more_patches() {
    let vectors = vectors::load();
    let sequence = vectors.sequence;
    let (store, processor) = vectors::processor_with_keys(&sequence.keys).await;
    assert_eq!(sequence.steps.len(), 2);

    for step in &sequence.steps {
        let list = step.list.to_patch_list(&sequence.name);
        let (mutations, state) = processor
            .decode_patches(&list, step.initial_state.0, true)
            .await
            .unwrap();
        assert_eq!(
            mutations,
            step.mutations
                .iter()
                .map(vectors::MutationVector::to_mutation)
                .collect::<Vec<_>>()
        );
        assert_eq!(state, step.state.0);
        let (stored_version, stored_hash) =
            store.get_app_state_version(&sequence.name).await.unwrap();
        assert_eq!(stored_version, step.stored_state.0.version);
        assert_eq!(stored_hash, step.stored_state.0.hash);
        vectors::assert_lookups(&store, &sequence.name, &step.lookups).await;
    }

    // The first list: a 4-record snapshot, then a patch with SETs and
    // REMOVEs (one without a previous SET), then Go's EncodePatch output.
    let first = &sequence.steps[0];
    assert_eq!(first.mutations.len(), 11);
    assert_eq!(
        first
            .mutations
            .iter()
            .map(|mutation| mutation.operation)
            .collect::<Vec<_>>(),
        vec![0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0]
    );
    assert_eq!(
        first.mutations[3].index,
        vec!["clearChat", "120363000000000000@g.us", "<&>", "1"]
    );
}

#[tokio::test]
async fn decode_patches_without_mac_validation_skips_the_checks() {
    let vectors = vectors::load();
    let sequence = vectors.sequence;
    let (_, processor) = vectors::processor_with_keys(&sequence.keys).await;
    let step = &sequence.steps[0];
    let mut list = step.list.to_patch_list(&sequence.name);
    list.patches[0].patch_mac = Some(vec![0; 32]);
    list.snapshot.as_mut().unwrap().mac = Some(vec![0; 32]);

    let (mutations, state) = processor
        .decode_patches(&list, HashState::default(), false)
        .await
        .unwrap();
    assert_eq!(mutations.len(), step.mutations.len());
    assert_eq!(state, step.state.0);
}

#[tokio::test]
async fn decode_patches_fails_like_go() {
    let vectors = vectors::load();
    let sequence = vectors.sequence;
    let descriptions: Vec<&str> = vectors
        .decode_errors
        .iter()
        .map(|vector| vector.description.as_str())
        .collect();
    assert_eq!(
        descriptions,
        vec![
            "snapshot MAC mismatch",
            "content MAC mismatch",
            "index MAC mismatch",
            "patch MAC mismatch",
            "patch LT hash mismatch",
            "missing snapshot key",
            "missing record key"
        ]
    );
    for vector in &vectors.decode_errors {
        let (_, processor) = vectors::processor_with_keys(&sequence.keys).await;
        let list = vector.list.to_patch_list(&sequence.name);
        let error = processor
            .decode_patches(&list, vector.initial_state.0, true)
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), vector.error, "{}", vector.description);
        assert_eq!(
            error.sentinel() == Some(AppStateError::KeyNotFound),
            vector.key_not_found,
            "{}",
            vector.description
        );
        assert_eq!(
            processor.get_missing_key_ids(&list).await,
            vector
                .missing_keys
                .iter()
                .map(|key| key.0.clone())
                .collect::<Vec<_>>(),
            "{}",
            vector.description
        );
    }
}

#[tokio::test]
async fn decode_patches_rejects_values_go_panics_on() {
    let vectors = vectors::load();
    let sequence = vectors.sequence;
    let (_, processor) = vectors::processor_with_keys(&sequence.keys).await;
    let mut list = sequence.steps[0].list.to_patch_list(&sequence.name);
    let record = &mut list.snapshot.as_mut().unwrap().records[0];
    record.value.as_mut().unwrap().blob = Some(vec![0; 40]);
    let error = processor
        .decode_patches(&list, HashState::default(), false)
        .await
        .unwrap_err();
    assert_eq!(
        error.to_string(),
        "failed to decode snapshot of v3: mutation #1 value of 40 bytes is too short for its IV and MAC"
    );
}

struct FakeDownloader {
    blobs: BTreeMap<String, Vec<u8>>,
    requested: Mutex<Vec<String>>,
}

#[async_trait]
impl DownloadExternal for FakeDownloader {
    async fn download_external(
        &self,
        reference: &ExternalBlobReference,
    ) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        let path = reference.direct_path.clone().unwrap_or_default();
        self.requested.lock().unwrap().push(path.clone());
        self.blobs
            .get(&path)
            .cloned()
            .ok_or_else(|| format!("no blob at {path}").into())
    }
}

fn reference(path: &str) -> Vec<u8> {
    ExternalBlobReference {
        direct_path: Some(path.to_owned()),
        ..ExternalBlobReference::default()
    }
    .encode_to_vec()
}

#[tokio::test]
async fn parse_patch_list_downloads_the_snapshot_and_external_mutations() {
    let vectors = vectors::load();
    let step = &vectors.sequence.steps[0];
    let snapshot = step.list.snapshot.as_ref().unwrap().0.clone();
    let patch = SyncdPatch::decode(step.list.patches[0].0.as_slice()).unwrap();
    let external_patch = SyncdPatch {
        version: Some(SyncdVersion { version: Some(9) }),
        external_mutations: Some(ExternalBlobReference {
            direct_path: Some("/mutations".to_owned()),
            ..ExternalBlobReference::default()
        }),
        ..SyncdPatch::default()
    };
    let downloader = FakeDownloader {
        blobs: BTreeMap::from([
            ("/snapshot".to_owned(), snapshot.clone()),
            (
                "/mutations".to_owned(),
                SyncdMutations {
                    mutations: patch.mutations.clone(),
                }
                .encode_to_vec(),
            ),
        ]),
        requested: Mutex::new(Vec::new()),
    };
    let collection = Node {
        tag: "collection".to_owned(),
        attrs: [
            ("name".to_owned(), AttributeValue::from("regular_high")),
            ("has_more_patches".to_owned(), AttributeValue::from("true")),
        ]
        .into(),
        content: Some(NodeContent::Nodes(vec![
            Node {
                tag: "snapshot".to_owned(),
                content: Some(NodeContent::Bytes(reference("/snapshot"))),
                ..Node::default()
            },
            Node {
                tag: "patches".to_owned(),
                content: Some(NodeContent::Nodes(vec![
                    Node {
                        tag: "patch".to_owned(),
                        content: Some(NodeContent::Bytes(patch.encode_to_vec())),
                        ..Node::default()
                    },
                    Node {
                        tag: "other".to_owned(),
                        content: Some(NodeContent::Bytes(vec![1, 2, 3])),
                        ..Node::default()
                    },
                    Node {
                        tag: "patch".to_owned(),
                        content: Some(NodeContent::Bytes(external_patch.encode_to_vec())),
                        ..Node::default()
                    },
                ])),
                ..Node::default()
            },
        ])),
    };

    let list = parse_patch_list(&collection, Some(&downloader))
        .await
        .unwrap();
    assert_eq!(list.name.as_str(), "regular_high");
    assert!(list.has_more_patches);
    assert_eq!(
        list.snapshot,
        Some(SyncdSnapshot::decode(snapshot.as_slice()).unwrap())
    );
    assert_eq!(list.patches.len(), 2);
    assert_eq!(list.patches[0], patch);
    assert_eq!(list.patches[1].mutations, patch.mutations);
    assert_eq!(
        *downloader.requested.lock().unwrap(),
        vec!["/snapshot", "/mutations"]
    );

    // Without a downloader, external mutations are left alone, and a
    // snapshot (where Go would call a nil function) is an error.
    let error = parse_patch_list(&collection, None).await.unwrap_err();
    assert_eq!(
        error.to_string(),
        "no function to download the external snapshot"
    );
}

#[tokio::test]
async fn parse_patch_list_reports_bad_patches_and_attributes() {
    let downloader = FakeDownloader {
        blobs: BTreeMap::from([("/empty".to_owned(), Vec::new())]),
        requested: Mutex::new(Vec::new()),
    };
    let collection_with = |patches: Vec<Node>, attrs: bool| Node {
        tag: "collection".to_owned(),
        attrs: if attrs {
            [("name".to_owned(), AttributeValue::from("regular"))].into()
        } else {
            Default::default()
        },
        content: Some(NodeContent::Nodes(vec![Node {
            tag: "patches".to_owned(),
            content: Some(NodeContent::Nodes(patches)),
            ..Node::default()
        }])),
    };
    let patch_node = |content: Vec<u8>| Node {
        tag: "patch".to_owned(),
        content: Some(NodeContent::Bytes(content)),
        ..Node::default()
    };

    let error = parse_patch_list(
        &collection_with(vec![patch_node(Vec::new()), patch_node(vec![0xff])], true),
        Some(&downloader),
    )
    .await
    .unwrap_err();
    assert!(
        error
            .to_string()
            .starts_with("failed to unmarshal patch #2: "),
        "{error}"
    );

    let empty_external = SyncdPatch {
        external_mutations: Some(ExternalBlobReference {
            direct_path: Some("/empty".to_owned()),
            ..ExternalBlobReference::default()
        }),
        ..SyncdPatch::default()
    };
    let error = parse_patch_list(
        &collection_with(vec![patch_node(empty_external.encode_to_vec())], true),
        Some(&downloader),
    )
    .await
    .unwrap_err();
    assert_eq!(error.to_string(), "didn't get any mutations from download");

    let error = parse_patch_list(&collection_with(Vec::new(), false), Some(&downloader))
        .await
        .unwrap_err();
    assert!(matches!(error, ParsePatchListError::Attrs(_)), "{error}");
}
