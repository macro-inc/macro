// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow msgsecret.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Not ported: WASA and bot messages (`encryptWASAMessage`,
// `decryptBotMessage`), which the port skips. The encrypt functions take
// their IV through `encrypt_msg_secret_with` so tests can compare with Go.

//! Message secrets: the per-message keys that encrypt reactions, comments,
//! poll votes and edits to an earlier message.

use std::sync::Arc;

use chrono::Utc;
use prost::Message as _;
use sha2::{Digest, Sha256};

use crate::client::Client;
use crate::errors::ClientError;
use crate::proto::wa_common::MessageKey;
use crate::proto::wa_e2e::{
    self, EncCommentMessage, EncReactionMessage, PollEncValue, PollUpdateMessage, PollVoteMessage,
    ReactionMessage, poll_creation_message, secret_encrypted_message,
};
use crate::types::events::Message;
use crate::types::{DEFAULT_USER_SERVER, HIDDEN_USER_SERVER, Jid, MessageInfo, parse_jid};
use crate::util::gcmutil::{self, GcmError};
use crate::util::hkdfutil;

/// The use case a message secret key is derived for (`MsgSecretType`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MsgSecretType {
    /// A poll vote.
    PollVote,
    /// An encrypted reaction.
    Reaction,
    /// An encrypted comment.
    Comment,
    /// A report token.
    ReportToken,
    /// An event response.
    EventResponse,
    /// An event edit.
    EventEdit,
    /// A message edit.
    MessageEdit,
    /// A poll edit.
    PollEdit,
    /// A poll option added.
    PollAddOption,
    /// A bot message.
    BotMessage,
    /// No use case (Go's `""`, used for bot messages).
    Empty,
}

impl MsgSecretType {
    /// The string mixed into the key.
    pub fn as_str(self) -> &'static str {
        match self {
            MsgSecretType::PollVote => "Poll Vote",
            MsgSecretType::Reaction => "Enc Reaction",
            MsgSecretType::Comment => "Enc Comment",
            MsgSecretType::ReportToken => "Report Token",
            MsgSecretType::EventResponse => "Event Response",
            MsgSecretType::EventEdit => "Event Edit",
            MsgSecretType::MessageEdit => "Message Edit",
            MsgSecretType::PollEdit => "Poll Edit",
            MsgSecretType::PollAddOption => "Poll Add Option",
            MsgSecretType::BotMessage => "Bot Message",
            MsgSecretType::Empty => "",
        }
    }
}

/// The key and additional data for one use of an original message's secret.
pub fn generate_msg_secret_key(
    modification_type: MsgSecretType,
    modification_sender: &Jid,
    original_message_id: &str,
    original_message_sender: &Jid,
    original_message_secret: &[u8],
) -> (Vec<u8>, Vec<u8>) {
    let original_sender = original_message_sender.to_non_ad().to_string();
    let modification_sender = modification_sender.to_non_ad().to_string();
    let use_case_secret = [
        original_message_id.as_bytes(),
        original_sender.as_bytes(),
        modification_sender.as_bytes(),
        modification_type.as_str().as_bytes(),
    ]
    .concat();
    let secret_key = hkdfutil::sha256(original_message_secret, &[], &use_case_secret, 32);
    let additional_data = match modification_type {
        MsgSecretType::PollVote | MsgSecretType::EventResponse | MsgSecretType::Empty => {
            format!("{original_message_id}\x00{modification_sender}").into_bytes()
        }
        _ => Vec::new(),
    };
    (secret_key, additional_data)
}

fn get_orig_sender_from_key(message: &Message, key: &MessageKey) -> Result<Jid, ClientError> {
    let chat_server = message.info.chat.server.as_str();
    if key.from_me.unwrap_or_default() {
        Ok(message.info.sender.clone())
    } else if chat_server == DEFAULT_USER_SERVER || chat_server == HIDDEN_USER_SERVER {
        let remote_jid = key.remote_jid.as_deref().unwrap_or_default();
        parse_jid(remote_jid).map_err(|error| {
            ClientError::Other(format!(
                "failed to parse JID of original message sender: {error}"
            ))
        })
    } else {
        let participant = key.participant.as_deref().unwrap_or_default();
        let sender = parse_jid(participant).map_err(|error| error.to_string());
        match sender {
            Ok(sender)
                if sender.server == DEFAULT_USER_SERVER || sender.server == HIDDEN_USER_SERVER =>
            {
                Ok(sender)
            }
            Ok(_) => Err(ClientError::Other(
                "failed to parse JID of original message sender: unexpected server".to_owned(),
            )),
            Err(error) => Err(ClientError::Other(format!(
                "failed to parse JID of original message sender: {error}"
            ))),
        }
    }
}

/// `SHA-256` of each poll option name (`HashPollOptions`).
pub fn hash_poll_options(option_names: &[String]) -> Vec<Vec<u8>> {
    option_names
        .iter()
        .map(|option| Sha256::digest(option.as_bytes()).to_vec())
        .collect()
}

/// A new poll; the message secret is what voters encrypt with
/// (`BuildPollCreation`).
pub fn build_poll_creation(
    name: &str,
    option_names: &[String],
    selectable_option_count: i64,
) -> wa_e2e::Message {
    let selectable = if selectable_option_count < 0
        || selectable_option_count > i64::try_from(option_names.len()).unwrap_or(i64::MAX)
    {
        0
    } else {
        selectable_option_count
    };
    wa_e2e::Message {
        poll_creation_message: Some(Box::new(wa_e2e::PollCreationMessage {
            name: Some(name.to_owned()),
            options: option_names
                .iter()
                .map(|option| poll_creation_message::Option {
                    option_name: Some(option.clone()),
                    ..Default::default()
                })
                .collect(),
            selectable_options_count: Some(u32::try_from(selectable).unwrap_or_default()),
            ..Default::default()
        })),
        message_context_info: Some(wa_e2e::MessageContextInfo {
            message_secret: Some(rand::random::<[u8; 32]>().to_vec()),
            ..Default::default()
        }),
        ..Default::default()
    }
}

/// The key of the message an info describes (`getKeyFromInfo`).
pub fn get_key_from_info(info: &MessageInfo) -> MessageKey {
    MessageKey {
        remote_jid: Some(info.chat.to_string()),
        from_me: Some(info.is_from_me),
        id: Some(info.id.clone()),
        participant: info.is_group.then(|| info.sender.to_string()),
    }
}

impl Client {
    async fn decrypt_msg_secret(
        &self,
        message: &Message,
        use_case: MsgSecretType,
        enc_iv: &[u8],
        enc_payload: &[u8],
        original_key: &MessageKey,
    ) -> Result<Vec<u8>, ClientError> {
        let original_sender = get_orig_sender_from_key(message, original_key)?;
        let original_id = original_key.id.clone().unwrap_or_default();
        let msg_secrets = Arc::clone(&self.store.read().await.msg_secrets);
        let (base_key, stored_original_sender) = msg_secrets
            .get_message_secret(&message.info.chat, &original_sender, &original_id)
            .await
            .map_err(|error| {
                ClientError::from(error).wrap("failed to get original message secret key")
            })?
            .ok_or(ClientError::OriginalMessageSecretNotFound)?;
        let (secret_key, additional_data) = generate_msg_secret_key(
            use_case,
            &message.info.sender,
            &original_id,
            &original_sender,
            &base_key,
        );
        match gcmutil::decrypt(&secret_key, enc_iv, enc_payload, &additional_data) {
            Ok(plaintext) => {
                tracing::debug!("decrypted message secret without hack");
                Ok(plaintext)
            }
            Err(GcmError::Authentication) if original_sender != stored_original_sender => {
                let (secret_key, additional_data) = generate_msg_secret_key(
                    use_case,
                    &message.info.sender,
                    &original_id,
                    &stored_original_sender,
                    &base_key,
                );
                let plaintext =
                    gcmutil::decrypt(&secret_key, enc_iv, enc_payload, &additional_data).map_err(
                        |error| {
                            ClientError::Other(format!("failed to decrypt secret message: {error}"))
                        },
                    )?;
                tracing::debug!("decrypted message secret with orig sender hack");
                Ok(plaintext)
            }
            Err(error) => Err(ClientError::Other(format!(
                "failed to decrypt secret message: {error}"
            ))),
        }
    }

    /// Encrypts with an original message's secret; returns (ciphertext, IV).
    async fn encrypt_msg_secret(
        &self,
        own_id: &Jid,
        chat: &Jid,
        original_sender: &Jid,
        original_message_id: &str,
        use_case: MsgSecretType,
        plaintext: &[u8],
    ) -> Result<(Vec<u8>, Vec<u8>), ClientError> {
        if own_id.is_empty() {
            return Err(ClientError::NotLoggedIn);
        }
        let msg_secrets = Arc::clone(&self.store.read().await.msg_secrets);
        let (base_key, stored_original_sender) = msg_secrets
            .get_message_secret(chat, original_sender, &original_message_id.to_owned())
            .await
            .map_err(|error| {
                ClientError::from(error).wrap("failed to get original message secret key")
            })?
            .ok_or(ClientError::OriginalMessageSecretNotFound)?;
        let iv: [u8; 12] = rand::random();
        let ciphertext = encrypt_msg_secret_with(
            own_id,
            &stored_original_sender,
            original_message_id,
            use_case,
            &base_key,
            &iv,
            plaintext,
        )?;
        Ok((ciphertext, iv.to_vec()))
    }

    /// Decrypts an encrypted reaction (`DecryptReaction`).
    pub async fn decrypt_reaction(
        &self,
        reaction: &Message,
    ) -> Result<ReactionMessage, ClientError> {
        let encrypted = reaction
            .message
            .as_ref()
            .and_then(|message| message.enc_reaction_message.as_ref())
            .ok_or(ClientError::NotEncryptedReactionMessage)?;
        let plaintext = self
            .decrypt_msg_secret(
                reaction,
                MsgSecretType::Reaction,
                encrypted.enc_iv.as_deref().unwrap_or_default(),
                encrypted.enc_payload.as_deref().unwrap_or_default(),
                &encrypted.target_message_key.clone().unwrap_or_default(),
            )
            .await
            .map_err(|error| error.wrap("failed to decrypt reaction"))?;
        ReactionMessage::decode(plaintext.as_slice()).map_err(|error| {
            ClientError::Other(format!("failed to decode reaction protobuf: {error}"))
        })
    }

    /// Decrypts an encrypted comment (`DecryptComment`).
    pub async fn decrypt_comment(&self, comment: &Message) -> Result<wa_e2e::Message, ClientError> {
        let encrypted = comment
            .message
            .as_ref()
            .and_then(|message| message.enc_comment_message.as_ref())
            .ok_or(ClientError::NotEncryptedCommentMessage)?;
        let plaintext = self
            .decrypt_msg_secret(
                comment,
                MsgSecretType::Comment,
                encrypted.enc_iv.as_deref().unwrap_or_default(),
                encrypted.enc_payload.as_deref().unwrap_or_default(),
                &encrypted.target_message_key.clone().unwrap_or_default(),
            )
            .await
            .map_err(|error| error.wrap("failed to decrypt comment"))?;
        wa_e2e::Message::decode(plaintext.as_slice()).map_err(|error| {
            ClientError::Other(format!("failed to decode comment protobuf: {error}"))
        })
    }

    /// Decrypts a poll vote (`DecryptPollVote`).
    pub async fn decrypt_poll_vote(&self, vote: &Message) -> Result<PollVoteMessage, ClientError> {
        let poll_update = vote
            .message
            .as_ref()
            .and_then(|message| message.poll_update_message.as_ref())
            .ok_or(ClientError::NotPollUpdateMessage)?;
        let encrypted = poll_update.vote.clone().unwrap_or_default();
        let plaintext = self
            .decrypt_msg_secret(
                vote,
                MsgSecretType::PollVote,
                encrypted.enc_iv.as_deref().unwrap_or_default(),
                encrypted.enc_payload.as_deref().unwrap_or_default(),
                &poll_update
                    .poll_creation_message_key
                    .clone()
                    .unwrap_or_default(),
            )
            .await
            .map_err(|error| error.wrap("failed to decrypt poll vote"))?;
        PollVoteMessage::decode(plaintext.as_slice()).map_err(|error| {
            ClientError::Other(format!("failed to decode poll vote protobuf: {error}"))
        })
    }

    /// Decrypts a message or poll edit sent as a secret encrypted message
    /// (`DecryptSecretEncryptedMessage`).
    pub async fn decrypt_secret_encrypted_message(
        &self,
        event: &Message,
    ) -> Result<wa_e2e::Message, ClientError> {
        let encrypted = event
            .message
            .as_ref()
            .and_then(|message| message.secret_encrypted_message.as_ref())
            .ok_or(ClientError::NotSecretEncryptedMessage)?;
        let secret_enc_type = encrypted.secret_enc_type.unwrap_or_default();
        let secret_type = match secret_encrypted_message::SecretEncType::try_from(secret_enc_type) {
            Ok(secret_encrypted_message::SecretEncType::EventEdit) => MsgSecretType::EventEdit,
            Ok(
                secret_encrypted_message::SecretEncType::PollEdit
                | secret_encrypted_message::SecretEncType::PollAddOption,
            ) => MsgSecretType::PollEdit,
            Ok(secret_encrypted_message::SecretEncType::MessageEdit) => MsgSecretType::MessageEdit,
            other => {
                return Err(ClientError::Other(format!(
                    "unsupported secret enc type: {}",
                    other
                        .map(|kind| kind.as_str_name().to_owned())
                        .unwrap_or_else(|_| secret_enc_type.to_string())
                )));
            }
        };
        let plaintext = self
            .decrypt_msg_secret(
                event,
                secret_type,
                encrypted.enc_iv.as_deref().unwrap_or_default(),
                encrypted.enc_payload.as_deref().unwrap_or_default(),
                &encrypted.target_message_key.clone().unwrap_or_default(),
            )
            .await?;
        let mut message = wa_e2e::Message::decode(plaintext.as_slice()).map_err(|error| {
            ClientError::Other(format!("failed to decode message protobuf: {error}"))
        })?;
        if message.message_context_info.is_none() {
            message.message_context_info = event
                .message
                .as_ref()
                .and_then(|outer| outer.message_context_info.clone());
        }
        Ok(message)
    }

    /// A vote for options of a poll (`BuildPollVote`).
    pub async fn build_poll_vote(
        &self,
        poll_info: &MessageInfo,
        option_names: &[String],
    ) -> Result<wa_e2e::Message, ClientError> {
        let poll_update = self
            .encrypt_poll_vote(
                poll_info,
                &PollVoteMessage {
                    selected_options: hash_poll_options(option_names),
                },
            )
            .await?;
        Ok(wa_e2e::Message {
            poll_update_message: Some(poll_update),
            ..Default::default()
        })
    }

    /// Encrypts a poll vote (`EncryptPollVote`).
    pub async fn encrypt_poll_vote(
        &self,
        poll_info: &MessageInfo,
        vote: &PollVoteMessage,
    ) -> Result<PollUpdateMessage, ClientError> {
        let own_id = if poll_info.sender.server == DEFAULT_USER_SERVER {
            self.get_own_id().await
        } else {
            self.get_own_lid().await
        };
        let (ciphertext, iv) = self
            .encrypt_msg_secret(
                &own_id,
                &poll_info.chat,
                &poll_info.sender,
                &poll_info.id,
                MsgSecretType::PollVote,
                &vote.encode_to_vec(),
            )
            .await
            .map_err(|error| error.wrap("failed to encrypt poll vote"))?;
        Ok(PollUpdateMessage {
            poll_creation_message_key: Some(get_key_from_info(poll_info)),
            vote: Some(PollEncValue {
                enc_payload: Some(ciphertext),
                enc_iv: Some(iv),
            }),
            sender_timestamp_ms: Some(Utc::now().timestamp_millis()),
            ..Default::default()
        })
    }

    /// Encrypts a comment on a message (`EncryptComment`).
    pub async fn encrypt_comment(
        &self,
        root_message_info: &MessageInfo,
        comment: &wa_e2e::Message,
    ) -> Result<wa_e2e::Message, ClientError> {
        let own_lid = self.get_own_lid().await;
        let (ciphertext, iv) = self
            .encrypt_msg_secret(
                &own_lid,
                &root_message_info.chat,
                &root_message_info.sender,
                &root_message_info.id,
                MsgSecretType::Comment,
                &comment.encode_to_vec(),
            )
            .await
            .map_err(|error| error.wrap("failed to encrypt comment"))?;
        Ok(wa_e2e::Message {
            enc_comment_message: Some(EncCommentMessage {
                target_message_key: Some(MessageKey {
                    remote_jid: Some(root_message_info.chat.to_string()),
                    participant: Some(root_message_info.sender.to_non_ad().to_string()),
                    from_me: Some(root_message_info.is_from_me),
                    id: Some(root_message_info.id.clone()),
                }),
                enc_payload: Some(ciphertext),
                enc_iv: Some(iv),
            }),
            ..Default::default()
        })
    }

    /// Encrypts a reaction to a message (`EncryptReaction`); the reaction's
    /// key becomes the target key.
    pub async fn encrypt_reaction(
        &self,
        root_message_info: &MessageInfo,
        mut reaction: ReactionMessage,
    ) -> Result<EncReactionMessage, ClientError> {
        let reaction_key = reaction.key.take();
        let own_lid = self.get_own_lid().await;
        let (ciphertext, iv) = self
            .encrypt_msg_secret(
                &own_lid,
                &root_message_info.chat,
                &root_message_info.sender,
                &root_message_info.id,
                MsgSecretType::Reaction,
                &reaction.encode_to_vec(),
            )
            .await
            .map_err(|error| error.wrap("failed to encrypt reaction"))?;
        Ok(EncReactionMessage {
            target_message_key: reaction_key,
            enc_payload: Some(ciphertext),
            enc_iv: Some(iv),
        })
    }
}

/// Encrypts with the secret of an original message and a given IV, as
/// `encryptMsgSecret` does after loading the secret. `original_sender` is
/// the sender the secret was stored under.
pub fn encrypt_msg_secret_with(
    own_id: &Jid,
    original_sender: &Jid,
    original_message_id: &str,
    use_case: MsgSecretType,
    base_key: &[u8],
    iv: &[u8; 12],
    plaintext: &[u8],
) -> Result<Vec<u8>, ClientError> {
    let (secret_key, additional_data) = generate_msg_secret_key(
        use_case,
        own_id,
        original_message_id,
        original_sender,
        base_key,
    );
    gcmutil::encrypt(&secret_key, iv, plaintext, &additional_data)
        .map_err(|error| ClientError::Other(format!("failed to encrypt secret message: {error}")))
}

#[cfg(test)]
mod test;
