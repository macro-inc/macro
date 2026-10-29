// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow appstate/encode.go (MPL-2.0, Copyright (c) Tulir Asokan)

use chrono::{DateTime, TimeDelta, Utc};
use hmac::Hmac;
use prost::Message;
use sha2::Sha256;

use super::errors::AppStateError;
use super::hash::{
    HashState, PreviousValueMacs, ShortValueError, UpdateHashError, concat_and_hmac,
    generate_content_mac, generate_patch_mac,
};
use super::keys::*;
use crate::proto::wa_common::MessageKey;
use crate::proto::wa_server_sync::syncd_mutation::SyncdOperation;
use crate::proto::wa_server_sync::{
    KeyId, SyncdIndex, SyncdMutation, SyncdPatch, SyncdRecord, SyncdValue,
};
use crate::proto::wa_sync_action::{
    ArchiveChatAction, DeleteChatAction, LabelAssociationAction, LabelEditAction,
    MarkChatAsReadAction, MuteAction, PinAction, PushNameSetting, StarAction, SyncActionData,
    SyncActionMessage, SyncActionMessageRange, SyncActionValue,
};
use crate::types::Jid;
use crate::util::cbcutil::{self, CbcError};

/// Information about a single mutation to the app state.
#[derive(Clone, Debug, PartialEq)]
pub struct MutationInfo {
    /// The thing being mutated (like `mute` or `pin_v1`), followed by
    /// parameters like the target JID.
    pub index: Vec<String>,
    /// A static number that depends on the thing being mutated.
    pub version: i32,
    /// The data for the mutation. Go holds a pointer that may be nil (and
    /// then panics in `EncodePatch`).
    pub value: SyncActionValue,
}

/// Information about a patch to the app state. A patch can contain multiple
/// mutations, as long as all mutations are in the same app state type.
#[derive(Clone, Debug, PartialEq)]
pub struct PatchInfo {
    /// When the patch was created; [`Processor::encode_patch`] uses the
    /// current time when `None` (Go's zero time).
    pub timestamp: Option<DateTime<Utc>>,
    /// The app state type being mutated (Go's `Type`).
    pub patch_type: WaPatchName,
    /// The individual mutations to apply to the app state in this patch.
    pub mutations: Vec<MutationInfo>,
}

/// Builds an app state patch for muting or unmuting a chat.
///
/// If mute is true and the mute duration is zero (or negative), the chat is
/// muted forever.
pub fn build_mute(target: &Jid, mute: bool, mute_duration: TimeDelta) -> PatchInfo {
    let mute_end_timestamp = (mute_duration > TimeDelta::zero())
        .then(|| (Utc::now() + mute_duration).timestamp_millis());
    build_mute_abs(target, mute, mute_end_timestamp)
}

/// Builds an app state patch for muting or unmuting a chat with an absolute
/// timestamp in milliseconds.
pub fn build_mute_abs(target: &Jid, mute: bool, mute_end_timestamp: Option<i64>) -> PatchInfo {
    let mute_end_timestamp = match mute_end_timestamp {
        None if mute => Some(-1),
        other => other,
    };
    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_REGULAR_HIGH,
        mutations: vec![MutationInfo {
            index: vec![INDEX_MUTE.to_owned(), target.to_string()],
            version: 2,
            value: SyncActionValue {
                mute_action: Some(MuteAction {
                    muted: Some(mute),
                    mute_end_timestamp,
                    ..MuteAction::default()
                }),
                ..SyncActionValue::default()
            },
        }],
    }
}

fn new_pin_mutation_info(target: &Jid, pin: bool) -> MutationInfo {
    MutationInfo {
        index: vec![INDEX_PIN.to_owned(), target.to_string()],
        version: 5,
        value: SyncActionValue {
            pin_action: Some(PinAction { pinned: Some(pin) }),
            ..SyncActionValue::default()
        },
    }
}

/// Builds an app state patch for pinning or unpinning a chat.
pub fn build_pin(target: &Jid, pin: bool) -> PatchInfo {
    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_REGULAR_LOW,
        mutations: vec![new_pin_mutation_info(target, pin)],
    }
}

/// Builds an app state patch for archiving or unarchiving a chat.
///
/// The last message timestamp and last message key are optional (`None` for
/// the timestamp means now, like Go's zero time).
///
/// Archiving a chat will also unpin it automatically.
pub fn build_archive(
    target: &Jid,
    archive: bool,
    last_message_timestamp: Option<DateTime<Utc>>,
    last_message_key: Option<MessageKey>,
) -> PatchInfo {
    let archive_mutation_info = MutationInfo {
        index: vec![INDEX_ARCHIVE.to_owned(), target.to_string()],
        version: 3,
        value: SyncActionValue {
            archive_chat_action: Some(ArchiveChatAction {
                archived: Some(archive),
                message_range: Some(new_message_range(last_message_timestamp, last_message_key)),
                // TODO set LastSystemMessageTimestamp?
            }),
            ..SyncActionValue::default()
        },
    };

    let mut mutations = vec![archive_mutation_info];
    if archive {
        mutations.push(new_pin_mutation_info(target, false));
    }

    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_REGULAR_LOW,
        mutations,
    }
}

/// Builds an app state patch for marking a chat as read or unread.
pub fn build_mark_chat_as_read(
    target: &Jid,
    read: bool,
    last_message_timestamp: Option<DateTime<Utc>>,
    last_message_key: Option<MessageKey>,
) -> PatchInfo {
    let action = MarkChatAsReadAction {
        read: Some(read),
        message_range: Some(new_message_range(last_message_timestamp, last_message_key)),
    };

    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_REGULAR_LOW,
        mutations: vec![MutationInfo {
            index: vec![INDEX_MARK_CHAT_AS_READ.to_owned(), target.to_string()],
            version: 3,
            value: SyncActionValue {
                mark_chat_as_read_action: Some(action),
                ..SyncActionValue::default()
            },
        }],
    }
}

fn new_label_chat_mutation(target: &Jid, label_id: &str, labeled: bool) -> MutationInfo {
    MutationInfo {
        index: vec![
            INDEX_LABEL_ASSOCIATION_CHAT.to_owned(),
            label_id.to_owned(),
            target.to_string(),
        ],
        version: 3,
        value: SyncActionValue {
            label_association_action: Some(LabelAssociationAction {
                labeled: Some(labeled),
                ..LabelAssociationAction::default()
            }),
            ..SyncActionValue::default()
        },
    }
}

/// Builds an app state patch for labeling or un(labeling) a chat.
pub fn build_label_chat(target: &Jid, label_id: &str, labeled: bool) -> PatchInfo {
    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_REGULAR,
        mutations: vec![new_label_chat_mutation(target, label_id, labeled)],
    }
}

fn new_label_message_mutation(
    target: &Jid,
    label_id: &str,
    message_id: &str,
    labeled: bool,
) -> MutationInfo {
    MutationInfo {
        index: vec![
            INDEX_LABEL_ASSOCIATION_MESSAGE.to_owned(),
            label_id.to_owned(),
            target.to_string(),
            message_id.to_owned(),
            "0".to_owned(),
            "0".to_owned(),
        ],
        version: 3,
        value: SyncActionValue {
            label_association_action: Some(LabelAssociationAction {
                labeled: Some(labeled),
                ..LabelAssociationAction::default()
            }),
            ..SyncActionValue::default()
        },
    }
}

/// Builds an app state patch for labeling or un(labeling) a message.
pub fn build_label_message(
    target: &Jid,
    label_id: &str,
    message_id: &str,
    labeled: bool,
) -> PatchInfo {
    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_REGULAR,
        mutations: vec![new_label_message_mutation(
            target, label_id, message_id, labeled,
        )],
    }
}

fn new_label_edit_mutation(
    label_id: &str,
    label_name: &str,
    label_color: i32,
    deleted: bool,
) -> MutationInfo {
    MutationInfo {
        index: vec![INDEX_LABEL_EDIT.to_owned(), label_id.to_owned()],
        version: 3,
        value: SyncActionValue {
            label_edit_action: Some(LabelEditAction {
                name: Some(label_name.to_owned()),
                color: Some(label_color),
                deleted: Some(deleted),
                ..LabelEditAction::default()
            }),
            ..SyncActionValue::default()
        },
    }
}

/// Builds an app state patch for editing a label.
pub fn build_label_edit(
    label_id: &str,
    label_name: &str,
    label_color: i32,
    deleted: bool,
) -> PatchInfo {
    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_REGULAR,
        mutations: vec![new_label_edit_mutation(
            label_id,
            label_name,
            label_color,
            deleted,
        )],
    }
}

fn new_setting_push_name_mutation(push_name: &str) -> MutationInfo {
    MutationInfo {
        index: vec![INDEX_SETTING_PUSH_NAME.to_owned()],
        version: 1,
        value: SyncActionValue {
            push_name_setting: Some(PushNameSetting {
                name: Some(push_name.to_owned()),
            }),
            ..SyncActionValue::default()
        },
    }
}

/// Builds an app state patch for setting the push name.
pub fn build_setting_push_name(push_name: &str) -> PatchInfo {
    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_CRITICAL_BLOCK,
        mutations: vec![new_setting_push_name_mutation(push_name)],
    }
}

fn new_star_mutation(
    target_jid: String,
    sender_jid: String,
    message_id: &str,
    from_me: &str,
    starred: bool,
) -> MutationInfo {
    MutationInfo {
        index: vec![
            INDEX_STAR.to_owned(),
            target_jid,
            message_id.to_owned(),
            from_me.to_owned(),
            sender_jid,
        ],
        version: 2,
        value: SyncActionValue {
            star_action: Some(StarAction {
                starred: Some(starred),
            }),
            ..SyncActionValue::default()
        },
    }
}

/// Builds an app state patch for starring or unstarring a message.
pub fn build_star(
    target: &Jid,
    sender: &Jid,
    message_id: &str,
    from_me: bool,
    starred: bool,
) -> PatchInfo {
    let is_from_me = if from_me { "1" } else { "0" };
    let target_jid = target.to_string();
    let sender_jid = if target.user == sender.user {
        "0".to_owned()
    } else {
        sender.to_string()
    };
    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_REGULAR_HIGH,
        mutations: vec![new_star_mutation(
            target_jid, sender_jid, message_id, is_from_me, starred,
        )],
    }
}

/// Encoding a patch failed.
#[derive(Debug, thiserror::Error)]
pub enum EncodeError {
    /// The key couldn't be loaded.
    #[error("failed to get app state key details with key ID {}: {source}", hex::encode(.key_id))]
    Key {
        /// The key ID.
        key_id: Vec<u8>,
        /// The failure.
        source: GetKeyError,
    },
    /// A mutation couldn't be encrypted.
    #[error("failed to encrypt mutation: {0}")]
    Encrypt(#[source] CbcError),
    /// Updating the LT hash failed.
    #[error("failed to update state hash: {0}")]
    UpdateHash(#[source] UpdateHashError),
    /// A value is shorter than its MAC. Can't happen for encoded values; Go
    /// would panic.
    #[error(transparent)]
    ShortValue(#[from] ShortValueError),
}

impl EncodeError {
    /// The wrapped [`AppStateError`], like Go's `errors.Is`.
    pub fn sentinel(&self) -> Option<AppStateError> {
        match self {
            EncodeError::Key { source, .. } => source.sentinel(),
            _ => None,
        }
    }
}

/// Encodes an index like Go's `json.Marshal` of a `[]string`, which escapes
/// `<`, `>`, `&`, U+2028 and U+2029. Go marshals a nil slice as `null`; an
/// empty list here is `[]`.
pub(super) fn marshal_index(index: &[String]) -> Vec<u8> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = vec![b'['];
    for (position, item) in index.iter().enumerate() {
        if position > 0 {
            output.push(b',');
        }
        output.push(b'"');
        for character in item.chars() {
            match character {
                '\\' | '"' => output.extend_from_slice(&[b'\\', character as u8]),
                '\u{8}' => output.extend_from_slice(b"\\b"),
                '\u{c}' => output.extend_from_slice(b"\\f"),
                '\n' => output.extend_from_slice(b"\\n"),
                '\r' => output.extend_from_slice(b"\\r"),
                '\t' => output.extend_from_slice(b"\\t"),
                '\u{0}'..='\u{1f}' | '<' | '>' | '&' => {
                    let byte = character as u8;
                    output.extend_from_slice(&[
                        b'\\',
                        b'u',
                        b'0',
                        b'0',
                        HEX[usize::from(byte >> 4)],
                        HEX[usize::from(byte & 0xf)],
                    ]);
                }
                '\u{2028}' => output.extend_from_slice(b"\\u2028"),
                '\u{2029}' => output.extend_from_slice(b"\\u2029"),
                _ => {
                    let mut buffer = [0; 4];
                    output.extend_from_slice(character.encode_utf8(&mut buffer).as_bytes());
                }
            }
        }
        output.push(b'"');
    }
    output.push(b']');
    output
}

impl Processor {
    /// Encodes and encrypts a patch on top of `state` with the key `key_id`,
    /// returning the serialized `SyncdPatch` to send. Each mutation gets a
    /// random IV and the patch's timestamp (now when unset).
    pub async fn encode_patch(
        &self,
        key_id: &[u8],
        mut state: HashState,
        mut patch_info: PatchInfo,
    ) -> Result<Vec<u8>, EncodeError> {
        let keys = self
            .get_app_state_key(key_id)
            .await
            .map_err(|source| EncodeError::Key {
                key_id: key_id.to_vec(),
                source,
            })?;

        let timestamp = *patch_info.timestamp.get_or_insert_with(Utc::now);

        let mut mutations = Vec::with_capacity(patch_info.mutations.len());
        for mutation_info in patch_info.mutations {
            let mut value = mutation_info.value;
            value.timestamp = Some(timestamp.timestamp_millis());

            let index_bytes = marshal_index(&mutation_info.index);

            let pb_obj = SyncActionData {
                index: Some(index_bytes.clone()),
                value: Some(value),
                padding: Some(Vec::new()),
                version: Some(mutation_info.version),
            };

            let content = pb_obj.encode_to_vec();

            let mut encrypted_content = cbcutil::encrypt(&keys.value_encryption, None, &content)
                .map_err(EncodeError::Encrypt)?;

            let value_mac = generate_content_mac(
                SyncdOperation::Set as i32,
                &encrypted_content,
                key_id,
                &keys.value_mac,
            );
            let index_mac = concat_and_hmac::<Hmac<Sha256>>(&keys.index, &[&index_bytes]);

            encrypted_content.extend_from_slice(&value_mac);
            mutations.push(SyncdMutation {
                operation: Some(SyncdOperation::Set as i32),
                record: Some(SyncdRecord {
                    index: Some(SyncdIndex {
                        blob: Some(index_mac),
                    }),
                    value: Some(SyncdValue {
                        blob: Some(encrypted_content),
                    }),
                    key_id: Some(KeyId {
                        id: Some(key_id.to_vec()),
                    }),
                }),
            });
        }

        let patch_type = &patch_info.patch_type;
        let (warn, result) = state
            .update_hash(
                &mutations,
                PreviousValueMacs::Store {
                    app_state: self.app_state.as_ref(),
                    name: patch_type,
                },
            )
            .await;
        if !warn.is_empty() {
            tracing::warn!(
                name = %patch_type,
                warnings = ?warn,
                "Warnings while updating hash (sending new app state)"
            );
        }
        result.map_err(EncodeError::UpdateHash)?;

        state.version += 1;

        let mut syncd_patch = SyncdPatch {
            snapshot_mac: Some(state.generate_snapshot_mac(patch_type, &keys.snapshot_mac)),
            key_id: Some(KeyId {
                id: Some(key_id.to_vec()),
            }),
            mutations,
            ..SyncdPatch::default()
        };
        syncd_patch.patch_mac = Some(generate_patch_mac(
            &syncd_patch,
            patch_type,
            &keys.patch_mac,
            state.version,
        )?);

        Ok(syncd_patch.encode_to_vec())
    }
}

/// Builds an app state patch for deleting a chat.
pub fn build_delete_chat(
    target: &Jid,
    last_message_timestamp: Option<DateTime<Utc>>,
    last_message_key: Option<MessageKey>,
    delete_media: bool,
) -> PatchInfo {
    let action = DeleteChatAction {
        message_range: Some(new_message_range(last_message_timestamp, last_message_key)),
    };
    let delete_media_int = if delete_media { "1" } else { "0" };

    PatchInfo {
        timestamp: None,
        patch_type: WA_PATCH_REGULAR_HIGH,
        mutations: vec![MutationInfo {
            index: vec![
                INDEX_DELETE_CHAT.to_owned(),
                target.to_string(),
                delete_media_int.to_owned(),
            ],
            version: 6,
            value: SyncActionValue {
                delete_chat_action: Some(action),
                ..SyncActionValue::default()
            },
        }],
    }
}

fn new_message_range(
    last_message_timestamp: Option<DateTime<Utc>>,
    last_message_key: Option<MessageKey>,
) -> SyncActionMessageRange {
    let last_message_timestamp = last_message_timestamp.unwrap_or_else(Utc::now);
    let mut message_range = SyncActionMessageRange {
        last_message_timestamp: Some(last_message_timestamp.timestamp()),
        ..SyncActionMessageRange::default()
    };
    if let Some(last_message_key) = last_message_key {
        message_range.messages = vec![SyncActionMessage {
            key: Some(last_message_key),
            timestamp: Some(last_message_timestamp.timestamp()),
        }];
    }
    message_range
}

#[cfg(test)]
mod test;
