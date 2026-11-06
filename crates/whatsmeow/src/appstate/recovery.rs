// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow appstate/recovery.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::io::{self, Read};

use flate2::read::MultiGzDecoder;
use hmac::Hmac;
use prost::Message;
use sha2::Sha256;

use super::decode::unmarshal_index;
use super::hash::{Mutation, concat_and_hmac};
use super::keys::{GetKeyError, Processor};
use crate::proto::wa_e2e::peer_data_operation_request_response_message::peer_data_operation_result::SyncDSnapshotFatalRecoveryResponse;
use crate::proto::wa_server_sync::syncd_mutation::SyncdOperation;
use crate::proto::wa_syncd_snapshot_recovery::SyncdSnapshotRecovery;
use crate::store::{AppStateMutationMac, StoreError};

/// Parsing a recovery response failed.
#[derive(Debug, thiserror::Error)]
pub enum ParseRecoveryError {
    /// The gzip stream is invalid. Go reports header errors as "failed to
    /// start decompressing" and close errors separately; the gzip reader here
    /// reports both while reading.
    #[error("failed to decompress: {0}")]
    Decompress(#[source] io::Error),
    /// The snapshot isn't a valid protobuf.
    #[error(transparent)]
    Unmarshal(#[from] prost::DecodeError),
}

/// Decodes the collection snapshot of a fatal recovery response from the
/// primary device, decompressing it if needed.
pub fn parse_recovery(
    resp: &SyncDSnapshotFatalRecoveryResponse,
) -> Result<SyncdSnapshotRecovery, ParseRecoveryError> {
    let mut data = resp.collection_snapshot.clone().unwrap_or_default();
    if resp.is_compressed.unwrap_or_default() {
        let mut decompressed = Vec::new();
        MultiGzDecoder::new(data.as_slice())
            .read_to_end(&mut decompressed)
            .map_err(ParseRecoveryError::Decompress)?;
        data = decompressed;
    }
    Ok(SyncdSnapshotRecovery::decode(data.as_slice())?)
}

/// Applying a recovery snapshot failed.
#[derive(Debug, thiserror::Error)]
pub enum ProcessRecoveryError {
    /// The LT hash isn't 128 bytes.
    #[error("invalid lthash length: {0}")]
    InvalidLtHashLength(usize),
    /// The key of a mutation couldn't be loaded.
    #[error("failed to get key {} for mutation #{number}: {source}", hex::encode(.key_id))]
    MutationKey {
        /// The key ID.
        key_id: Vec<u8>,
        /// The position of the mutation, from 1.
        number: usize,
        /// The failure.
        source: GetKeyError,
    },
    /// A mutation's index isn't a JSON list of strings.
    #[error("failed to unmarshal index for mutation #{number}: {source}")]
    UnmarshalIndex {
        /// The position of the mutation, from 1.
        number: usize,
        /// The failure.
        source: serde_json::Error,
    },
    /// Deleting the old version failed.
    #[error("failed to reset app state version in database: {0}")]
    ResetVersion(#[source] StoreError),
    /// Storing the new version failed.
    #[error("failed to update app state version in the database: {0}")]
    PutVersion(#[source] StoreError),
    /// Storing the mutation MACs failed.
    #[error("failed to insert added mutation MACs to the database: {0}")]
    PutMacs(#[source] StoreError),
}

impl Processor {
    /// Replaces the stored state of a collection with a recovery snapshot and
    /// returns its mutations, all SETs.
    ///
    /// Go also returns the mutations when storing fails; this returns just the
    /// error.
    pub async fn process_recovery(
        &self,
        recovery: &SyncdSnapshotRecovery,
    ) -> Result<Vec<Mutation>, ProcessRecoveryError> {
        let lthash = recovery.collection_lthash.as_deref().unwrap_or_default();
        let lthash = <[u8; 128]>::try_from(lthash)
            .map_err(|_| ProcessRecoveryError::InvalidLtHashLength(lthash.len()))?;
        let name = recovery.collection_name.as_deref().unwrap_or_default();
        let version = recovery
            .version
            .as_ref()
            .and_then(|version| version.version)
            .unwrap_or_default();
        let mut macs = Vec::with_capacity(recovery.mutation_records.len());
        let mut mutations = Vec::with_capacity(recovery.mutation_records.len());
        for (i, mutation) in recovery.mutation_records.iter().enumerate() {
            let key_id = mutation.key_id.as_deref().unwrap_or_default();
            let keys = self.get_app_state_key(key_id).await.map_err(|source| {
                ProcessRecoveryError::MutationKey {
                    key_id: key_id.to_vec(),
                    number: i + 1,
                    source,
                }
            })?;
            let value = mutation.value.as_ref();
            let index = value
                .and_then(|value| value.index.as_deref())
                .unwrap_or_default();
            let parsed_index =
                unmarshal_index(index).map_err(|source| ProcessRecoveryError::UnmarshalIndex {
                    number: i + 1,
                    source,
                })?;
            let mac = AppStateMutationMac {
                index_mac: concat_and_hmac::<Hmac<Sha256>>(&keys.index, &[index]),
                value_mac: mutation.mac.clone().unwrap_or_default(),
            };
            mutations.push(Mutation {
                key_id: key_id.to_vec(),
                operation: SyncdOperation::Set as i32,
                action: value.and_then(|value| value.value.clone()),
                version: value.and_then(|value| value.version).unwrap_or_default(),
                index: parsed_index,
                index_mac: mac.index_mac.clone(),
                value_mac: mac.value_mac.clone(),
                patch_version: version,
            });
            macs.push(mac);
        }
        self.app_state
            .delete_app_state_version(name)
            .await
            .map_err(ProcessRecoveryError::ResetVersion)?;
        self.app_state
            .put_app_state_version(name, version, lthash)
            .await
            .map_err(ProcessRecoveryError::PutVersion)?;
        self.app_state
            .put_app_state_mutation_macs(name, version, &macs)
            .await
            .map_err(ProcessRecoveryError::PutMacs)?;
        Ok(mutations)
    }
}

#[cfg(test)]
mod test;
