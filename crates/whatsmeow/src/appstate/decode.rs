// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow appstate/decode.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::collections::HashMap;

use async_trait::async_trait;
use constant_time_eq::constant_time_eq;
use hmac::Hmac;
use prost::Message;
use sha2::Sha256;

use super::errors::AppStateError;
use super::hash::{
    HashState, MissingPreviousSetValueWarning, Mutation, PreviousValueMacs, ShortValueError,
    UpdateHashError, concat_and_hmac, generate_content_mac, generate_patch_mac, mutation_index,
    mutation_value,
};
use super::keys::{ExpandedAppStateKeys, GetKeyError, Processor, WaPatchName};
use crate::binary::{ErrorList, Node, NodeContent};
use crate::proto::wa_server_sync::syncd_mutation::SyncdOperation;
use crate::proto::wa_server_sync::{
    ExternalBlobReference, SyncdMutation, SyncdMutations, SyncdPatch, SyncdSnapshot,
};
use crate::proto::wa_sync_action::SyncActionData;
use crate::store::{AppStateMutationMac, StoreError};
use crate::util::cbcutil::{self, CbcError};

/// A decoded response to getting app state patches from the WhatsApp servers.
#[derive(Clone, Debug, PartialEq)]
pub struct PatchList {
    /// The collection.
    pub name: WaPatchName,
    /// Whether the server has more patches after these.
    pub has_more_patches: bool,
    /// The patches.
    pub patches: Vec<SyncdPatch>,
    /// The snapshot, if the server sent one.
    pub snapshot: Option<SyncdSnapshot>,
}

/// Downloads a blob of external app state patches (Go's
/// `DownloadExternalFunc`).
#[async_trait]
pub trait DownloadExternal: Send + Sync {
    /// Downloads and decrypts the referenced blob.
    async fn download_external(
        &self,
        reference: &ExternalBlobReference,
    ) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>>;
}

/// Parsing a patch list failed.
#[derive(Debug, thiserror::Error)]
pub enum ParsePatchListError {
    /// The snapshot reference isn't a valid protobuf.
    #[error("failed to unmarshal snapshot: {0}")]
    UnmarshalSnapshot(#[source] prost::DecodeError),
    /// There is a snapshot but no downloader. Go calls the nil function and
    /// panics.
    #[error("no function to download the external snapshot")]
    MissingDownloader,
    /// Downloading the snapshot or external mutations failed.
    #[error("failed to download external mutations: {0}")]
    Download(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// The downloaded snapshot or mutation list isn't a valid protobuf.
    #[error("failed to unmarshal mutation list: {0}")]
    UnmarshalMutationList(#[source] prost::DecodeError),
    /// A patch isn't a valid protobuf.
    #[error("failed to unmarshal patch #{number}: {source}")]
    UnmarshalPatch {
        /// The position of the patch node, from 1.
        number: usize,
        /// The decode failure.
        source: prost::DecodeError,
    },
    /// The downloaded mutation list is empty.
    #[error("didn't get any mutations from download")]
    EmptyDownload,
    /// The collection's attributes are missing or invalid.
    #[error(transparent)]
    Attrs(#[from] ErrorList),
}

async fn parse_snapshot_internal(
    collection: &Node,
    download_external: Option<&dyn DownloadExternal>,
) -> Result<Option<SyncdSnapshot>, ParsePatchListError> {
    let snapshot_node = collection.get_child_by_tag(&["snapshot"]);
    let Some(NodeContent::Bytes(raw_snapshot)) = &snapshot_node.content else {
        return Ok(None);
    };
    if snapshot_node.tag != "snapshot" {
        return Ok(None);
    }
    let snapshot = ExternalBlobReference::decode(raw_snapshot.as_slice())
        .map_err(ParsePatchListError::UnmarshalSnapshot)?;
    let download_external = download_external.ok_or(ParsePatchListError::MissingDownloader)?;
    let raw_data = download_external
        .download_external(&snapshot)
        .await
        .map_err(ParsePatchListError::Download)?;
    let downloaded = SyncdSnapshot::decode(raw_data.as_slice())
        .map_err(ParsePatchListError::UnmarshalMutationList)?;
    Ok(Some(downloaded))
}

async fn parse_patch_list_internal(
    collection: &Node,
    download_external: Option<&dyn DownloadExternal>,
) -> Result<Vec<SyncdPatch>, ParsePatchListError> {
    let patches_node = collection.get_child_by_tag(&["patches"]);
    let patch_nodes = patches_node.get_children();
    let mut patches = Vec::with_capacity(patch_nodes.len());
    for (i, patch_node) in patch_nodes.iter().enumerate() {
        let Some(NodeContent::Bytes(raw_patch)) = &patch_node.content else {
            continue;
        };
        if patch_node.tag != "patch" {
            continue;
        }
        let mut patch = SyncdPatch::decode(raw_patch.as_slice()).map_err(|source| {
            ParsePatchListError::UnmarshalPatch {
                number: i + 1,
                source,
            }
        })?;
        if let (Some(external_mutations), Some(download_external)) =
            (&patch.external_mutations, download_external)
        {
            let raw_data = download_external
                .download_external(external_mutations)
                .await
                .map_err(ParsePatchListError::Download)?;
            let downloaded = SyncdMutations::decode(raw_data.as_slice())
                .map_err(ParsePatchListError::UnmarshalMutationList)?;
            if downloaded.mutations.is_empty() {
                return Err(ParsePatchListError::EmptyDownload);
            }
            patch.mutations = downloaded.mutations;
        }
        patches.push(patch);
    }
    Ok(patches)
}

/// Decodes an XML node containing app state patches, including downloading
/// any external blobs.
///
/// Go also returns the list when only the attributes are invalid; this
/// returns just the error.
pub async fn parse_patch_list(
    collection: &Node,
    download_external: Option<&dyn DownloadExternal>,
) -> Result<PatchList, ParsePatchListError> {
    let mut ag = collection.attr_getter();
    let snapshot = parse_snapshot_internal(collection, download_external).await?;
    let patches = parse_patch_list_internal(collection, download_external).await?;
    let list = PatchList {
        name: WaPatchName::from(ag.string("name")),
        has_more_patches: ag.optional_bool("has_more_patches"),
        patches,
        snapshot,
    };
    ag.error()?;
    Ok(list)
}

/// Decoding app state failed.
#[derive(Debug, thiserror::Error)]
pub enum DecodeError {
    /// The key of a mutation couldn't be loaded.
    #[error("failed to get key {} to decode mutation: {source}", hex::encode_upper(.key_id))]
    MutationKey {
        /// The key ID.
        key_id: Vec<u8>,
        /// The failure.
        source: GetKeyError,
    },
    /// A mutation value is too short for its IV and MAC. Go panics.
    #[error("mutation #{number} value of {length} bytes is too short for its IV and MAC")]
    ShortMutationValue {
        /// The position of the mutation, from 1.
        number: usize,
        /// The value length.
        length: usize,
    },
    /// A mutation's content or index MAC doesn't match.
    #[error("failed to verify mutation #{number}: {sentinel}")]
    VerifyMutation {
        /// The position of the mutation, from 1.
        number: usize,
        /// [`AppStateError::MismatchingContentMac`] or
        /// [`AppStateError::MismatchingIndexMac`].
        sentinel: AppStateError,
    },
    /// A mutation couldn't be decrypted.
    #[error("failed to decrypt mutation #{number}: {source}")]
    DecryptMutation {
        /// The position of the mutation, from 1.
        number: usize,
        /// The failure.
        source: CbcError,
    },
    /// A decrypted mutation isn't a valid protobuf.
    #[error("failed to unmarshal mutation #{number}: {source}")]
    UnmarshalMutation {
        /// The position of the mutation, from 1.
        number: usize,
        /// The failure.
        source: prost::DecodeError,
    },
    /// A mutation's index isn't a JSON list of strings.
    #[error("failed to unmarshal index of mutation #{number}: {source}")]
    UnmarshalIndex {
        /// The position of the mutation, from 1.
        number: usize,
        /// The failure.
        source: serde_json::Error,
    },
    /// Storing the new version failed.
    #[error("failed to update app state version in the database: {0}")]
    PutVersion(#[source] StoreError),
    /// Deleting the removed mutation MACs failed.
    #[error("failed to remove deleted mutation MACs from the database: {0}")]
    DeleteMacs(#[source] StoreError),
    /// Storing the added mutation MACs failed.
    #[error("failed to insert added mutation MACs to the database: {0}")]
    PutMacs(#[source] StoreError),
    /// The key of a snapshot or patch couldn't be loaded.
    #[error("failed to get key {} to verify patch v{version} MACs: {source}", hex::encode_upper(.key_id))]
    SnapshotKey {
        /// The key ID.
        key_id: Vec<u8>,
        /// The version being verified.
        version: u64,
        /// The failure.
        source: GetKeyError,
    },
    /// A snapshot or patch MAC doesn't match.
    #[error("failed to verify patch v{version}: {sentinel}")]
    VerifyPatch {
        /// The version being verified.
        version: u64,
        /// [`AppStateError::MismatchingLtHash`] or
        /// [`AppStateError::MismatchingPatchMac`].
        sentinel: AppStateError,
    },
    /// Updating the LT hash failed.
    #[error("failed to update state hash: {0}")]
    UpdateHash(#[source] UpdateHashError),
    /// A patch value is shorter than its MAC. Go panics.
    #[error(transparent)]
    ShortValue(#[from] ShortValueError),
    /// The snapshot MAC couldn't be verified.
    #[error("failed to verify snapshot: {0}")]
    VerifySnapshot(#[source] Box<DecodeError>),
    /// The snapshot's records couldn't be decoded.
    #[error("failed to decode snapshot of v{version}: {source}")]
    DecodeSnapshot {
        /// The snapshot version.
        version: u64,
        /// The failure.
        source: Box<DecodeError>,
    },
}

impl DecodeError {
    /// The wrapped [`AppStateError`], like Go's `errors.Is`. The client
    /// requests missing keys on [`AppStateError::KeyNotFound`].
    pub fn sentinel(&self) -> Option<AppStateError> {
        match self {
            DecodeError::MutationKey { source, .. } | DecodeError::SnapshotKey { source, .. } => {
                source.sentinel()
            }
            DecodeError::VerifyMutation { sentinel, .. }
            | DecodeError::VerifyPatch { sentinel, .. } => Some(*sentinel),
            DecodeError::VerifySnapshot(source) | DecodeError::DecodeSnapshot { source, .. } => {
                source.sentinel()
            }
            _ => None,
        }
    }
}

#[derive(Default)]
struct PatchOutput {
    removed_macs: Vec<Vec<u8>>,
    added_macs: Vec<AppStateMutationMac>,
    mutations: Vec<Mutation>,
}

impl PatchOutput {
    fn remove_mac(&mut self, index_mac: &[u8]) {
        self.removed_macs.push(index_mac.to_vec());
        // If the mutation was previously added in this patch, remove it from added_macs
        self.added_macs
            .retain(|mac| !constant_time_eq(&mac.index_mac, index_mac));
    }

    fn add_mac(&mut self, index_mac: &[u8], value_mac: &[u8]) {
        self.added_macs.push(AppStateMutationMac {
            index_mac: index_mac.to_vec(),
            value_mac: value_mac.to_vec(),
        });
    }
}

struct DecodedMutation {
    index_mac: Vec<u8>,
    value_mac: Vec<u8>,
    index: Vec<String>,
    sync_action: SyncActionData,
}

fn index_mac_to_array(index_mac: &[u8]) -> [u8; 32] {
    <[u8; 32]>::try_from(index_mac).unwrap_or_default()
}

/// Parses a JSON index like Go's `json.Unmarshal` into a `[]string`: `null`
/// is an empty list.
pub(super) fn unmarshal_index(index: &[u8]) -> Result<Vec<String>, serde_json::Error> {
    Ok(serde_json::from_slice::<Option<Vec<String>>>(index)?.unwrap_or_default())
}

impl Processor {
    async fn decode_mutation(
        &self,
        mutation: &SyncdMutation,
        i: usize,
        validate_macs: bool,
    ) -> Result<DecodedMutation, DecodeError> {
        let key_id = mutation
            .record
            .as_ref()
            .and_then(|record| record.key_id.as_ref())
            .and_then(|key| key.id.as_deref())
            .unwrap_or_default();
        let keys: ExpandedAppStateKeys =
            self.get_app_state_key(key_id)
                .await
                .map_err(|source| DecodeError::MutationKey {
                    key_id: key_id.to_vec(),
                    source,
                })?;
        let blob = mutation_value(mutation);
        if blob.len() < 48 {
            return Err(DecodeError::ShortMutationValue {
                number: i + 1,
                length: blob.len(),
            });
        }
        let (content, value_mac) = blob.split_at(blob.len() - 32);
        if validate_macs {
            let expected_value_mac = generate_content_mac(
                mutation.operation.unwrap_or_default(),
                content,
                key_id,
                &keys.value_mac,
            );
            if !constant_time_eq(&expected_value_mac, value_mac) {
                return Err(DecodeError::VerifyMutation {
                    number: i + 1,
                    sentinel: AppStateError::MismatchingContentMac,
                });
            }
        }
        let (iv, content) = content.split_at(16);
        let plaintext =
            cbcutil::decrypt(&keys.value_encryption, iv, content).map_err(|source| {
                DecodeError::DecryptMutation {
                    number: i + 1,
                    source,
                }
            })?;
        let sync_action = SyncActionData::decode(plaintext.as_slice()).map_err(|source| {
            DecodeError::UnmarshalMutation {
                number: i + 1,
                source,
            }
        })?;
        let index_mac = mutation_index(mutation);
        let action_index = sync_action.index.as_deref().unwrap_or_default();
        if validate_macs {
            let expected_index_mac = concat_and_hmac::<Hmac<Sha256>>(&keys.index, &[action_index]);
            if !constant_time_eq(&expected_index_mac, index_mac) {
                return Err(DecodeError::VerifyMutation {
                    number: i + 1,
                    sentinel: AppStateError::MismatchingIndexMac,
                });
            }
        }
        let index =
            unmarshal_index(action_index).map_err(|source| DecodeError::UnmarshalIndex {
                number: i + 1,
                source,
            })?;
        Ok(DecodedMutation {
            index_mac: index_mac.to_vec(),
            value_mac: value_mac.to_vec(),
            index,
            sync_action,
        })
    }

    async fn decode_mutations(
        &self,
        mutations: &[SyncdMutation],
        out: &mut PatchOutput,
        validate_macs: bool,
        patch_version: u64,
        fake_indexes_to_remove: &HashMap<[u8; 32], Vec<u8>>,
    ) -> Result<(), DecodeError> {
        for (i, mutation) in mutations.iter().enumerate() {
            let decoded = self.decode_mutation(mutation, i, validate_macs).await?;
            let operation = mutation.operation.unwrap_or_default();
            if operation == SyncdOperation::Remove as i32 {
                out.remove_mac(&decoded.index_mac);
                if let Some(alt_index_mac) =
                    fake_indexes_to_remove.get(&index_mac_to_array(&decoded.index_mac))
                    && decoded.index_mac.len() == 32
                {
                    out.remove_mac(alt_index_mac);
                }
            } else if operation == SyncdOperation::Set as i32 {
                out.add_mac(&decoded.index_mac, &decoded.value_mac);
            }
            out.mutations.push(Mutation {
                key_id: mutation
                    .record
                    .as_ref()
                    .and_then(|record| record.key_id.as_ref())
                    .and_then(|key| key.id.clone())
                    .unwrap_or_default(),
                operation,
                action: decoded.sync_action.value,
                version: decoded.sync_action.version.unwrap_or_default(),
                index: decoded.index,
                index_mac: decoded.index_mac,
                value_mac: decoded.value_mac,

                patch_version,
            });
        }
        Ok(())
    }

    async fn store_macs(
        &self,
        name: &WaPatchName,
        current_state: HashState,
        out: &PatchOutput,
    ) -> Result<(), DecodeError> {
        self.app_state
            .put_app_state_version(name.as_str(), current_state.version, current_state.hash)
            .await
            .map_err(DecodeError::PutVersion)?;
        self.app_state
            .delete_app_state_mutation_macs(name.as_str(), &out.removed_macs)
            .await
            .map_err(DecodeError::DeleteMacs)?;
        self.app_state
            .put_app_state_mutation_macs(name.as_str(), current_state.version, &out.added_macs)
            .await
            .map_err(DecodeError::PutMacs)?;
        Ok(())
    }

    async fn validate_snapshot_mac(
        &self,
        name: &WaPatchName,
        current_state: HashState,
        key_id: &[u8],
        expected_snapshot_mac: &[u8],
    ) -> Result<ExpandedAppStateKeys, DecodeError> {
        let keys =
            self.get_app_state_key(key_id)
                .await
                .map_err(|source| DecodeError::SnapshotKey {
                    key_id: key_id.to_vec(),
                    version: current_state.version,
                    source,
                })?;
        let snapshot_mac = current_state.generate_snapshot_mac(name, &keys.snapshot_mac);
        if !constant_time_eq(&snapshot_mac, expected_snapshot_mac) {
            return Err(DecodeError::VerifyPatch {
                version: current_state.version,
                sentinel: AppStateError::MismatchingLtHash,
            });
        }
        Ok(keys)
    }

    async fn decode_snapshot(
        &self,
        name: &WaPatchName,
        ss: &SyncdSnapshot,
        initial_state: HashState,
        validate_macs: bool,
        new_mutations_input: Vec<Mutation>,
    ) -> Result<(Vec<Mutation>, HashState), DecodeError> {
        let mut current_state = initial_state;
        current_state.version = ss
            .version
            .as_ref()
            .and_then(|version| version.version)
            .unwrap_or_default();

        let encrypted_mutations: Vec<SyncdMutation> = ss
            .records
            .iter()
            .map(|record| SyncdMutation {
                operation: Some(SyncdOperation::Set as i32),
                record: Some(record.clone()),
            })
            .collect();

        // Go passes a nil map.
        let fake_indexes_to_remove = HashMap::new();
        let (warn, result) = current_state
            .update_hash(&encrypted_mutations, PreviousValueMacs::Empty)
            .await;
        result.map_err(DecodeError::UpdateHash)?;

        if validate_macs
            && let Err(error) = self
                .validate_snapshot_mac(
                    name,
                    current_state,
                    ss.key_id
                        .as_ref()
                        .and_then(|key| key.id.as_deref())
                        .unwrap_or_default(),
                    ss.mac.as_deref().unwrap_or_default(),
                )
                .await
        {
            if !warn.is_empty() {
                tracing::warn!(name = %name, warnings = ?warn, "Warnings while updating hash");
            }
            return Err(DecodeError::VerifySnapshot(Box::new(error)));
        }

        let mut out = PatchOutput {
            mutations: new_mutations_input,
            ..PatchOutput::default()
        };
        self.decode_mutations(
            &encrypted_mutations,
            &mut out,
            validate_macs,
            current_state.version,
            &fake_indexes_to_remove,
        )
        .await
        .map_err(|error| DecodeError::DecodeSnapshot {
            version: current_state.version,
            source: Box::new(error),
        })?;
        self.store_macs(name, current_state, &out).await?;
        Ok((out.mutations, current_state))
    }

    async fn validate_patch(
        &self,
        patch_name: &WaPatchName,
        patch: &SyncdPatch,
        current_state: HashState,
        validate_macs: bool,
    ) -> (
        Vec<MissingPreviousSetValueWarning>,
        Result<HashState, DecodeError>,
    ) {
        let version = patch
            .version
            .as_ref()
            .and_then(|version| version.version)
            .unwrap_or_default();
        let mut new_state = current_state;
        new_state.version = version;
        let (warn, result) = new_state
            .update_hash(
                &patch.mutations,
                PreviousValueMacs::PatchThenStore {
                    app_state: self.app_state.as_ref(),
                    name: patch_name,
                },
            )
            .await;
        if let Err(error) = result {
            return (warn, Err(DecodeError::UpdateHash(error)));
        }

        if validate_macs {
            let keys = match self
                .validate_snapshot_mac(
                    patch_name,
                    new_state,
                    patch
                        .key_id
                        .as_ref()
                        .and_then(|key| key.id.as_deref())
                        .unwrap_or_default(),
                    patch.snapshot_mac.as_deref().unwrap_or_default(),
                )
                .await
            {
                Ok(keys) => keys,
                Err(error) => return (warn, Err(error)),
            };
            let patch_mac = match generate_patch_mac(patch, patch_name, &keys.patch_mac, version) {
                Ok(patch_mac) => patch_mac,
                Err(error) => return (warn, Err(error.into())),
            };
            if !constant_time_eq(&patch_mac, patch.patch_mac.as_deref().unwrap_or_default()) {
                return (
                    warn,
                    Err(DecodeError::VerifyPatch {
                        version,
                        sentinel: AppStateError::MismatchingPatchMac,
                    }),
                );
            }
        }
        (warn, Ok(new_state))
    }

    /// Decodes all the patches in a patch list into a list of app state
    /// mutations, verifying them against `initial_state` when `validate_macs`
    /// is set, and stores the new version, LT hash and mutation MACs after the
    /// snapshot and after each patch.
    ///
    /// Go also returns the mutations and state decoded before a failure; this
    /// returns just the error. Use [`DecodeError::sentinel`] for Go's
    /// `errors.Is`.
    pub async fn decode_patches(
        &self,
        list: &PatchList,
        initial_state: HashState,
        validate_macs: bool,
    ) -> Result<(Vec<Mutation>, HashState), DecodeError> {
        let mut current_state = initial_state;
        let mut expected_length = list
            .snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.records.len());
        for patch in &list.patches {
            expected_length += patch.mutations.len();
        }
        let mut new_mutations = Vec::with_capacity(expected_length);

        if let Some(snapshot) = &list.snapshot {
            (new_mutations, current_state) = self
                .decode_snapshot(
                    &list.name,
                    snapshot,
                    current_state,
                    validate_macs,
                    new_mutations,
                )
                .await?;
        }

        for patch in &list.patches {
            // Go passes a nil map.
            let fake_indexes_to_remove = HashMap::new();
            let (warn, result) = self
                .validate_patch(&list.name, patch, current_state, validate_macs)
                .await;
            let new_state = match result {
                Ok(new_state) => new_state,
                Err(error) => {
                    if !warn.is_empty() {
                        tracing::warn!(
                            name = %list.name,
                            warnings = ?warn,
                            "Warnings while updating hash"
                        );
                    }
                    return Err(error);
                }
            };

            let mut out = PatchOutput {
                mutations: new_mutations,
                ..PatchOutput::default()
            };
            self.decode_mutations(
                &patch.mutations,
                &mut out,
                validate_macs,
                new_state.version,
                &fake_indexes_to_remove,
            )
            .await?;
            self.store_macs(&list.name, new_state, &out).await?;
            new_mutations = out.mutations;
            current_state = new_state;
        }
        Ok((new_mutations, current_state))
    }
}

#[cfg(test)]
mod test;
