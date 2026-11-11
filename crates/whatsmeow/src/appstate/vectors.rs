// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

//! The test vectors in `testdata/appstate/vectors.json`, written by running
//! whatsmeow's Go code at the pinned revision (`testdata/generator/appstate`).
//! Not a port of a Go file.

use std::sync::Arc;

use prost::Message;
use serde::Deserialize;

use super::hash::{HashState, Mutation};
use super::keys::{Processor, WaPatchName};
use crate::proto::wa_server_sync::{SyncdPatch, SyncdSnapshot};
use crate::proto::wa_sync_action::SyncActionValue;
use crate::store::{AppStateStore, AppStateSyncKey, AppStateSyncKeyStore, MemoryStore};

/// Bytes written as a hex string.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hex(pub Vec<u8>);

impl<'de> Deserialize<'de> for Hex {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        hex::decode(text).map(Hex).map_err(serde::de::Error::custom)
    }
}

#[derive(Deserialize)]
pub struct Vectors {
    pub lthash: Vec<LtHashVector>,
    pub expanded_keys: Vec<ExpandedKeysVector>,
    pub snapshot_mac: Vec<SnapshotMacVector>,
    pub patch_mac: Vec<PatchMacVector>,
    pub content_mac: Vec<ContentMacVector>,
    pub index_mac: Vec<IndexMacVector>,
    pub index_json: Vec<IndexJsonVector>,
    pub builders: Vec<PatchInfoVector>,
    pub sequence: SequenceVector,
    pub decode_errors: Vec<DecodeErrorVector>,
    pub recovery: RecoveryVector,
}

#[derive(Deserialize)]
pub struct LtHashVector {
    pub base: Hex,
    pub subtract: Vec<Hex>,
    pub add: Vec<Hex>,
    pub result: Hex,
}

#[derive(Deserialize)]
pub struct ExpandedKeysVector {
    pub key_data: Hex,
    pub index: Hex,
    pub value_encryption: Hex,
    pub value_mac: Hex,
    pub snapshot_mac: Hex,
    pub patch_mac: Hex,
}

#[derive(Deserialize)]
pub struct SnapshotMacVector {
    pub hash: Hex,
    pub version: u64,
    pub name: String,
    pub key: Hex,
    pub mac: Hex,
}

#[derive(Deserialize)]
pub struct PatchMacVector {
    pub patch: Hex,
    pub name: String,
    pub key: Hex,
    pub version: u64,
    pub mac: Hex,
}

#[derive(Deserialize)]
pub struct ContentMacVector {
    pub operation: i32,
    pub data: Hex,
    pub key_id: Hex,
    pub key: Hex,
    pub mac: Hex,
}

#[derive(Deserialize)]
pub struct IndexMacVector {
    pub key: Hex,
    pub index: Hex,
    pub mac: Hex,
}

#[derive(Deserialize)]
pub struct IndexJsonVector {
    pub index: Vec<String>,
    pub json: String,
}

#[derive(Deserialize)]
pub struct PatchInfoVector {
    #[serde(rename = "type")]
    pub patch_type: String,
    pub mutations: Vec<MutationInfoVector>,
}

#[derive(Deserialize)]
pub struct MutationInfoVector {
    pub index: Vec<String>,
    pub version: i32,
    pub value: Hex,
}

#[derive(Deserialize)]
pub struct KeyVector {
    pub id: Hex,
    pub data: Hex,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(from = "StateJson")]
pub struct StateVector(pub HashState);

#[derive(Deserialize)]
struct StateJson {
    version: u64,
    hash: Hex,
}

impl From<StateJson> for StateVector {
    fn from(state: StateJson) -> Self {
        StateVector(HashState {
            version: state.version,
            hash: state
                .hash
                .0
                .try_into()
                .expect("the generator writes 128-byte hashes"),
        })
    }
}

#[derive(Deserialize)]
pub struct MutationVector {
    pub key_id: Hex,
    pub operation: i32,
    pub action: Option<Hex>,
    pub version: i32,
    pub index: Vec<String>,
    pub index_mac: Hex,
    pub value_mac: Hex,
    pub patch_version: u64,
}

impl MutationVector {
    pub fn to_mutation(&self) -> Mutation {
        Mutation {
            key_id: self.key_id.0.clone(),
            operation: self.operation,
            action: self
                .action
                .as_ref()
                .map(|action| SyncActionValue::decode(action.0.as_slice()).unwrap()),
            version: self.version,
            index: self.index.clone(),
            index_mac: self.index_mac.0.clone(),
            value_mac: self.value_mac.0.clone(),
            patch_version: self.patch_version,
        }
    }
}

#[derive(Deserialize)]
pub struct LookupVector {
    pub index_mac: Hex,
    pub value_mac: Option<Hex>,
}

#[derive(Deserialize)]
pub struct PatchListVector {
    pub snapshot: Option<Hex>,
    pub patches: Vec<Hex>,
}

impl PatchListVector {
    pub fn to_patch_list(&self, name: &str) -> super::decode::PatchList {
        super::decode::PatchList {
            name: WaPatchName::from(name.to_owned()),
            has_more_patches: false,
            patches: self
                .patches
                .iter()
                .map(|patch| SyncdPatch::decode(patch.0.as_slice()).unwrap())
                .collect(),
            snapshot: self
                .snapshot
                .as_ref()
                .map(|snapshot| SyncdSnapshot::decode(snapshot.0.as_slice()).unwrap()),
        }
    }
}

#[derive(Deserialize)]
pub struct DecodeStepVector {
    pub list: PatchListVector,
    pub initial_state: StateVector,
    pub mutations: Vec<MutationVector>,
    pub state: StateVector,
    pub stored_state: StateVector,
    pub lookups: Vec<LookupVector>,
}

#[derive(Deserialize)]
pub struct SequenceVector {
    pub name: String,
    pub keys: Vec<KeyVector>,
    pub steps: Vec<DecodeStepVector>,
}

#[derive(Deserialize)]
pub struct DecodeErrorVector {
    pub description: String,
    pub list: PatchListVector,
    pub initial_state: StateVector,
    pub error: String,
    pub key_not_found: bool,
    pub missing_keys: Vec<Hex>,
}

#[derive(Deserialize)]
pub struct RecoveryVector {
    pub collection_snapshot: Hex,
    pub is_compressed: bool,
    pub name: String,
    pub mutations: Vec<MutationVector>,
    pub stored_state: StateVector,
    pub lookups: Vec<LookupVector>,
    pub invalid_lthash_snapshot: Hex,
    pub invalid_lthash_error: String,
}

pub fn load() -> Vectors {
    serde_json::from_str(include_str!("../../testdata/appstate/vectors.json")).unwrap()
}

/// A memory store holding the sequence's keys, and a processor on it.
pub async fn processor_with_keys(keys: &[KeyVector]) -> (Arc<MemoryStore>, Processor) {
    let store = Arc::new(MemoryStore::default());
    for key in keys {
        store
            .put_app_state_sync_key(
                &key.id.0,
                AppStateSyncKey {
                    data: key.data.0.clone(),
                    fingerprint: Vec::new(),
                    timestamp: 0,
                },
            )
            .await
            .unwrap();
    }
    let processor = Processor {
        key_cache: Default::default(),
        app_state_keys: store.clone(),
        app_state: store.clone(),
    };
    (store, processor)
}

/// Checks the stored value MAC of every index MAC.
pub async fn assert_lookups(store: &MemoryStore, name: &str, lookups: &[LookupVector]) {
    for lookup in lookups {
        assert_eq!(
            store
                .get_app_state_mutation_mac(name, &lookup.index_mac.0)
                .await
                .unwrap(),
            lookup
                .value_mac
                .as_ref()
                .map(|value_mac| value_mac.0.clone()),
            "{}",
            hex::encode(&lookup.index_mac.0)
        );
    }
}
