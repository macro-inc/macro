// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow appstate/hash.go (MPL-2.0, Copyright (c) Tulir Asokan)

use constant_time_eq::constant_time_eq;
use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use sha2::{Sha256, Sha512};

use super::errors::AppStateError;
use super::keys::WaPatchName;
use super::lthash;
use crate::proto::wa_server_sync::SyncdMutation;
use crate::proto::wa_server_sync::SyncdPatch;
use crate::proto::wa_server_sync::syncd_mutation::SyncdOperation;
use crate::proto::wa_sync_action::SyncActionValue;
use crate::store::{AppStateStore, StoreError};

/// One decoded app state mutation.
#[derive(Clone, Debug, PartialEq)]
pub struct Mutation {
    /// The ID of the key the mutation was encrypted with.
    pub key_id: Vec<u8>,
    /// The raw `SyncdOperation` value, as prost stores enums; Go's enum type
    /// can also hold values it doesn't name. Compare with
    /// `SyncdOperation::Set as i32`.
    pub operation: i32,
    /// The decoded action; `None` when the mutation carried none.
    pub action: Option<SyncActionValue>,
    /// The action version.
    pub version: i32,
    /// The thing being mutated (like `mute`), followed by its parameters.
    pub index: Vec<String>,
    /// The MAC of the index.
    pub index_mac: Vec<u8>,
    /// The MAC of the value.
    pub value_mac: Vec<u8>,

    /// The version of the patch or snapshot the mutation came in.
    pub patch_version: u64,
}

/// The version and LT hash of one app state collection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HashState {
    /// The version.
    pub version: u64,
    /// The LT hash of the value MACs of every mutation that is set.
    pub hash: [u8; 128],
}

impl Default for HashState {
    fn default() -> Self {
        HashState {
            version: 0,
            hash: [0; 128],
        }
    }
}

/// A mutation value blob is shorter than the 32-byte value MAC that ends it.
/// Go slices without checking and panics.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("mutation value of {0} bytes is shorter than its 32-byte MAC")]
pub struct ShortValueError(pub usize);

/// A REMOVE mutation without a previous SET of its index. Go collects these as
/// warnings and ignores them.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{} for {}", AppStateError::MissingPreviousSetValueOperation, hex::encode_upper(.index_mac))]
pub struct MissingPreviousSetValueWarning {
    /// The index MAC of the REMOVE mutation.
    pub index_mac: Vec<u8>,
}

/// Updating an LT hash failed.
#[derive(Debug, thiserror::Error)]
pub enum UpdateHashError {
    /// Looking up the previous value MAC of an index failed.
    #[error("failed to get value MAC of previous SET operation: {0}")]
    PreviousSetValueMac(#[source] StoreError),
    /// A value blob is too short.
    #[error(transparent)]
    ShortValue(#[from] ShortValueError),
}

/// The value MAC at the end of a mutation value blob.
pub(super) fn value_mac(value: &[u8]) -> Result<&[u8], ShortValueError> {
    value
        .len()
        .checked_sub(32)
        .map(|start| &value[start..])
        .ok_or(ShortValueError(value.len()))
}

pub(super) fn mutation_value(mutation: &SyncdMutation) -> &[u8] {
    mutation
        .record
        .as_ref()
        .and_then(|record| record.value.as_ref())
        .and_then(|value| value.blob.as_deref())
        .unwrap_or_default()
}

pub(super) fn mutation_index(mutation: &SyncdMutation) -> &[u8] {
    mutation
        .record
        .as_ref()
        .and_then(|record| record.index.as_ref())
        .and_then(|index| index.blob.as_deref())
        .unwrap_or_default()
}

/// Where [`HashState::update_hash`] finds the value MAC an index had before a
/// mutation. Go passes a closure; these are the three closures its callers
/// pass (an enum, because async closures borrowing their captures don't give
/// `Send` futures).
pub(super) enum PreviousValueMacs<'a> {
    /// Nothing was set before (Go's `decodeSnapshot`).
    Empty,
    /// The stored MACs of the collection (Go's `EncodePatch`).
    Store {
        /// The app state store.
        app_state: &'a dyn AppStateStore,
        /// The collection.
        name: &'a WaPatchName,
    },
    /// The latest earlier mutation of the same index in the patch, else the
    /// stored MACs of the collection (Go's `validatePatch`).
    PatchThenStore {
        /// The app state store.
        app_state: &'a dyn AppStateStore,
        /// The collection.
        name: &'a WaPatchName,
    },
}

impl PreviousValueMacs<'_> {
    async fn get_prev_set_value_mac(
        &self,
        mutations: &[SyncdMutation],
        index_mac: &[u8],
        max_index: usize,
    ) -> Result<Option<Vec<u8>>, StoreError> {
        match self {
            PreviousValueMacs::Empty => Ok(None),
            PreviousValueMacs::Store { app_state, name } => {
                app_state
                    .get_app_state_mutation_mac(name.as_str(), index_mac)
                    .await
            }
            PreviousValueMacs::PatchThenStore { app_state, name } => {
                for previous in mutations[..max_index].iter().rev() {
                    if constant_time_eq(mutation_index(previous), index_mac) {
                        if previous.operation.unwrap_or_default() == SyncdOperation::Set as i32 {
                            // update_hash already checked the length of every
                            // SET value before max_index.
                            return Ok(value_mac(mutation_value(previous))
                                .ok()
                                .map(<[u8]>::to_vec));
                        }
                        // Found a REMOVE operation, no previous value
                        return Ok(None);
                    }
                }
                // Previous value not found in current patch, look in the database
                app_state
                    .get_app_state_mutation_mac(name.as_str(), index_mac)
                    .await
            }
        }
    }
}

impl HashState {
    /// Adds the value MACs of the SET mutations to the hash and subtracts the
    /// previous value MACs of every mutated index, which `previous_value_macs`
    /// looks up.
    ///
    /// Returns the REMOVE mutations without a previous value as warnings, also
    /// when it fails, as Go does.
    pub(super) async fn update_hash(
        &mut self,
        mutations: &[SyncdMutation],
        previous_value_macs: PreviousValueMacs<'_>,
    ) -> (
        Vec<MissingPreviousSetValueWarning>,
        Result<(), UpdateHashError>,
    ) {
        let mut added: Vec<Vec<u8>> = Vec::new();
        let mut removed: Vec<Vec<u8>> = Vec::new();
        let mut warnings = Vec::new();

        for (i, mutation) in mutations.iter().enumerate() {
            let operation = mutation.operation.unwrap_or_default();
            if operation == SyncdOperation::Set as i32 {
                match value_mac(mutation_value(mutation)) {
                    Ok(value_mac) => added.push(value_mac.to_vec()),
                    Err(error) => return (warnings, Err(error.into())),
                }
            }
            let index_mac = mutation_index(mutation);
            match previous_value_macs
                .get_prev_set_value_mac(mutations, index_mac, i)
                .await
            {
                Err(error) => return (warnings, Err(UpdateHashError::PreviousSetValueMac(error))),
                Ok(Some(removal)) => removed.push(removal),
                Ok(None) if operation == SyncdOperation::Remove as i32 => {
                    // TODO figure out if there are certain cases that are safe to
                    // ignore and others that aren't. At least removing contact
                    // access from WhatsApp seems to create a REMOVE op for your
                    // own JID that points to a non-existent index and is safe to
                    // ignore here. Other keys might not be safe to ignore.
                    warnings.push(MissingPreviousSetValueWarning {
                        index_mac: index_mac.to_vec(),
                    });
                }
                Ok(None) => {}
            }
        }

        lthash::WA_PATCH_INTEGRITY
            .subtract_then_add_in_place(&mut self.hash, &removed, &added)
            .expect("the 128-byte hash fits WA_PATCH_INTEGRITY's 128-byte items");
        (warnings, Ok(()))
    }

    pub(super) fn generate_snapshot_mac(&self, name: &WaPatchName, key: &[u8]) -> Vec<u8> {
        concat_and_hmac::<Hmac<Sha256>>(
            key,
            &[
                &self.hash,
                &uint64_to_bytes(self.version),
                name.as_str().as_bytes(),
            ],
        )
    }
}

fn uint64_to_bytes(value: u64) -> [u8; 8] {
    value.to_be_bytes()
}

/// HMACs the concatenation of `data` with the HMAC type `Hmac` (Go passes the
/// hash constructor).
pub(super) fn concat_and_hmac<Hmac: Mac + KeyInit>(key: &[u8], data: &[&[u8]]) -> Vec<u8> {
    let mut hmac = <Hmac as KeyInit>::new_from_slice(key).expect("HMAC accepts keys of any length");
    for item in data {
        hmac.update(item);
    }
    hmac.finalize().into_bytes().to_vec()
}

/// The MAC of a whole patch: its snapshot MAC, every value MAC, the version
/// and the collection name. Fails on a value shorter than its MAC, where Go
/// panics.
pub(super) fn generate_patch_mac(
    patch: &SyncdPatch,
    name: &WaPatchName,
    key: &[u8],
    version: u64,
) -> Result<Vec<u8>, ShortValueError> {
    let version = uint64_to_bytes(version);
    let mut data_to_hash: Vec<&[u8]> = Vec::with_capacity(patch.mutations.len() + 3);
    data_to_hash.push(patch.snapshot_mac.as_deref().unwrap_or_default());
    for mutation in &patch.mutations {
        data_to_hash.push(value_mac(mutation_value(mutation))?);
    }
    data_to_hash.push(&version);
    data_to_hash.push(name.as_str().as_bytes());
    Ok(concat_and_hmac::<Hmac<Sha256>>(key, &data_to_hash))
}

/// The MAC of one encrypted mutation value. `operation` is the raw
/// `SyncdOperation` value.
pub(super) fn generate_content_mac(
    operation: i32,
    data: &[u8],
    key_id: &[u8],
    key: &[u8],
) -> Vec<u8> {
    // Go's byte(operation) + 1: truncate, then wrap.
    let operation_bytes = [operation.to_le_bytes()[0].wrapping_add(1)];
    let key_data_length = uint64_to_bytes(key_id.len() as u64 + 1);
    let mut mac =
        concat_and_hmac::<Hmac<Sha512>>(key, &[&operation_bytes, key_id, data, &key_data_length]);
    mac.truncate(32);
    mac
}

#[cfg(test)]
mod test;
