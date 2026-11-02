//! What a phone sends besides plain messages: attachments uploaded to the
//! media host, and poll votes encrypted with the poll's message secret.

use prost::Message as _;
use whatsmeow::download::MediaType;
use whatsmeow::msgsecret::{MsgSecretType, encrypt_msg_secret_with, hash_poll_options};
use whatsmeow::proto::wa_common::MessageKey;
use whatsmeow::proto::wa_e2e::{Message, PollEncValue, PollUpdateMessage, PollVoteMessage};
use whatsmeow::types::Jid;
use whatsmeow::upload::{UploadResponse, upload};

use super::FakePhone;
use crate::SendError;

impl FakePhone {
    /// Encrypts an attachment as `media_type` and uploads it to the media
    /// host; the response fills the attachment part of a message.
    pub async fn upload_media(
        &self,
        plaintext: &[u8],
        media_type: MediaType,
    ) -> Result<UploadResponse, SendError> {
        upload(
            &self.media_http(),
            &self.media_conn(),
            plaintext,
            media_type,
        )
        .await
        .map_err(SendError::Upload)
    }

    /// Votes on a poll in a group, choosing `options` (none withdraws the
    /// vote), as WhatsApp does: the vote is encrypted with the poll's message
    /// secret for this voter. `poll_author` is the poll sender's LID.
    /// Returns the vote's message ID.
    pub async fn vote(
        &self,
        chat: &Jid,
        poll_id: &str,
        poll_author: &Jid,
        poll_secret: &[u8],
        options: &[&str],
    ) -> Result<String, SendError> {
        let names: Vec<String> = options.iter().map(|option| (*option).to_owned()).collect();
        let vote = PollVoteMessage {
            selected_options: hash_poll_options(&names),
        };
        let iv: [u8; 12] = rand::random();
        let ciphertext = encrypt_msg_secret_with(
            &self.lid(),
            poll_author,
            poll_id,
            MsgSecretType::PollVote,
            poll_secret,
            &iv,
            &vote.encode_to_vec(),
        )
        .map_err(SendError::MessageSecret)?;
        let update = Message {
            poll_update_message: Some(PollUpdateMessage {
                poll_creation_message_key: Some(MessageKey {
                    remote_jid: Some(chat.to_string()),
                    from_me: Some(false),
                    id: Some(poll_id.to_owned()),
                    participant: Some(poll_author.to_non_ad().to_string()),
                }),
                vote: Some(PollEncValue {
                    enc_payload: Some(ciphertext),
                    enc_iv: Some(iv.to_vec()),
                }),
                sender_timestamp_ms: Some(chrono::Utc::now().timestamp_millis()),
                ..PollUpdateMessage::default()
            }),
            ..Message::default()
        };
        self.send_message(chat, update).await
    }
}
