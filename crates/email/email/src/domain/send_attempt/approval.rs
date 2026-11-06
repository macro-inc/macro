//! Versioned approval identity, independent of application-model serialization.
//! Add a new version when approved fields change; retain existing versions for
//! attempts admitted by earlier deployments.

use super::SendSnapshot;
use crate::domain::models::ContactInfo;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

const FINGERPRINT_FIELD: &str = "_send_approval";
const APPROVAL_VERSION: u8 = 2;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Fingerprint {
    version: u8,
    digest: String,
}

#[derive(Serialize, Deserialize)]
struct ApprovalV1 {
    message: MessageV1,
    attachment_ids: Vec<Uuid>,
    forwarded_attachment_ids: Vec<Uuid>,
    restore_body_html: Option<String>,
    restore_body_text: Option<String>,
    restore_body_macro: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct MessageV1 {
    sender_email: Option<String>,
    db_id: Option<Uuid>,
    provider_id: Option<String>,
    replying_to_id: Option<Uuid>,
    provider_thread_id: Option<String>,
    thread_db_id: Option<Uuid>,
    subject: String,
    to: Vec<ContactV1>,
    cc: Vec<ContactV1>,
    bcc: Vec<ContactV1>,
    body_text: Option<String>,
    body_html: Option<String>,
    body_macro: Option<String>,
    headers_json: Option<Value>,
    include_signature: Option<bool>,
}

#[derive(Serialize, Deserialize)]
struct ContactV1 {
    email: String,
    name: Option<String>,
}

impl From<&SendSnapshot> for ApprovalV1 {
    fn from(snapshot: &SendSnapshot) -> Self {
        let message = &snapshot.message;
        let contacts = |values: &[ContactInfo]| {
            values
                .iter()
                .map(|contact| ContactV1 {
                    email: contact.email.clone(),
                    name: contact.name.clone(),
                })
                .collect()
        };
        Self {
            message: MessageV1 {
                sender_email: message
                    .sender_email
                    .as_ref()
                    .map(|email| email.0.as_ref().to_owned()),
                db_id: message.db_id,
                provider_id: message.provider_id.clone(),
                replying_to_id: message.replying_to_id,
                provider_thread_id: message.provider_thread_id.clone(),
                thread_db_id: message.thread_db_id,
                subject: message.subject.clone(),
                to: contacts(&message.to),
                cc: contacts(&message.cc),
                bcc: contacts(&message.bcc),
                body_text: message.body_text.clone(),
                body_html: message.body_html.clone(),
                body_macro: message.body_macro.clone(),
                headers_json: message.headers_json.clone(),
                include_signature: message.include_signature,
            },
            attachment_ids: snapshot.attachment_ids.clone(),
            forwarded_attachment_ids: snapshot.forwarded_attachment_ids.clone(),
            restore_body_html: snapshot.restore_body_html.clone(),
            restore_body_text: snapshot.restore_body_text.clone(),
            restore_body_macro: snapshot.restore_body_macro.clone(),
        }
    }
}

impl ApprovalV1 {
    fn digest(mut self) -> Result<String, serde_json::Error> {
        self.attachment_ids.sort_unstable();
        self.forwarded_attachment_ids.sort_unstable();
        let mut canonical = serde_json::to_value(self)?;
        // Object insertion order can vary with Cargo features, including headers.
        canonical.sort_all_objects();
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&canonical)?)
        ))
    }
}

impl SendSnapshot {
    fn approval_v2_digest(&self) -> Result<String, serde_json::Error> {
        let mut canonical = serde_json::json!({
            "content": ApprovalV1::from(self).digest()?,
            "draft_generation": self.message.draft_generation,
            "send_time": self.message.send_time,
            "signature_html": self.message.frozen_signature_html,
        });
        canonical.sort_all_objects();
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&canonical)?)
        ))
    }
    /// Retain the delivery snapshot and a stable identity for replay comparison.
    pub(crate) fn persisted_request(&self) -> Result<Value, serde_json::Error> {
        let mut request = serde_json::to_value(self)?;
        request[FINGERPRINT_FIELD] = serde_json::to_value(Fingerprint {
            version: APPROVAL_VERSION,
            digest: self.approval_v2_digest()?,
        })?;
        Ok(request)
    }

    /// Compare approved fields, supporting pre-versioned snapshots and rejecting
    /// unknown versions without granting another delivery attempt.
    pub(crate) fn matches_approved_request(
        &self,
        request: &Value,
    ) -> Result<bool, serde_json::Error> {
        if let Some(fingerprint) = request.get(FINGERPRINT_FIELD) {
            let fingerprint: Fingerprint = serde_json::from_value(fingerprint.clone())?;
            return match fingerprint.version {
                2 => Ok(fingerprint.digest == self.approval_v2_digest()?),
                1 if self.message.draft_generation == 0
                    && self.message.send_time.is_none()
                    && self.message.frozen_signature_html.is_none() =>
                {
                    Ok(fingerprint.digest == ApprovalV1::from(self).digest()?)
                }
                _ => Ok(false),
            };
        }
        if self.message.draft_generation != 0
            || self.message.send_time.is_some()
            || self.message.frozen_signature_html.is_some()
        {
            return Ok(false);
        }
        let expected = ApprovalV1::from(self).digest()?;
        let legacy: ApprovalV1 = serde_json::from_value(request.clone())?;
        Ok(legacy.digest()? == expected)
    }
}

#[cfg(test)]
mod test;
