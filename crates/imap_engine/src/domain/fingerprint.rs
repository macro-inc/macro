//! Canonical cross-folder message identity, independent from storage encoding.
use super::models::Error;
use chrono::{DateTime, SubsecRound, Utc};
use sha2::{Digest, Sha256};

/// A SHA-256 identity for headers, normalized INTERNALDATE and RFC822.SIZE.
#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, PartialOrd, Ord,
)]
pub struct MessageFingerprint([u8; 32]);
impl MessageFingerprint {
    /// Hash the established concatenation, normalizing dates to Postgres precision.
    pub fn new(mime: &[u8], received_at: DateTime<Utc>, size: u32) -> Self {
        let date = received_at.trunc_subsecs(6).to_rfc3339();
        let size = size.to_string();
        let mut hash = Sha256::new();
        hash.update(mime);
        hash.update(date.as_bytes());
        hash.update(size.as_bytes());
        Self(hash.finalize().into())
    }
    /// Validate a digest read from the dedicated Postgres bytea column.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, Error> {
        bytes
            .try_into()
            .map(Self)
            .map_err(|_| Error::ConnectionUnavailable)
    }
    /// The exact 32 bytes stored and used by the indexed lookup.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// Maximum number of distinct fingerprints in one database lookup.
pub const FINGERPRINT_LOOKUP_BATCH: usize = 500;

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn location_without_a_fingerprint_is_rejected() {
        let document = serde_json::json!({
            "folder_id": "inbox", "uid_validity": 1, "uid": 1, "message_id": "message"
        });
        assert!(serde_json::from_value::<crate::domain::models::Location>(document).is_err());
    }

    #[test]
    fn fingerprint_pins_the_established_sha256_input() {
        let date = DateTime::parse_from_rfc3339("2023-11-14T22:13:20+00:00")
            .unwrap()
            .with_timezone(&Utc);
        let fingerprint = MessageFingerprint::new(
            b"From: sender@example.net\r\nMessage-ID: <fingerprint@example.net>\r\n\r\n",
            date,
            200,
        );
        let hex = fingerprint
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(
            hex,
            "ed8ce42b0263ec87a4269c3892928a0c02fcacf41811ed59f0687b8b68e7dd2b"
        );
    }

    #[test]
    fn fingerprint_normalizes_offset_and_postgres_microseconds() {
        let wire = DateTime::parse_from_rfc3339("2023-11-15T03:43:20.123456789+05:30")
            .unwrap()
            .with_timezone(&Utc);
        let stored = DateTime::parse_from_rfc3339("2023-11-14T22:13:20.123456+00:00")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            MessageFingerprint::new(b"headers", wire, 200),
            MessageFingerprint::new(b"headers", stored, 200)
        );
    }
}
