//! Mobile push notification models.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Used to build up the data to construct a [`HashedCollapseKey`].
///
/// Uses SHA-256 internally for stable hashing across Rust compiler versions.
pub struct NotifCollapseKey(Sha256);

/// Contains the string representation of a notification collapse key.
/// This is used to uniquely identify notifications delivered to an iOS device.
#[derive(Debug, Clone)]
pub struct HashedCollapseKey(String);

impl AsRef<str> for HashedCollapseKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl HashedCollapseKey {
    /// Create from an already-hashed string.
    pub fn from_hashed(s: String) -> Self {
        Self(s)
    }

    /// Consume and return the inner string.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl NotifCollapseKey {
    /// Create a new collapse key seeded with the given string.
    pub fn new(s: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(s.as_bytes());
        NotifCollapseKey(hasher)
    }

    /// Append additional data to the collapse key.
    pub fn append(mut self, s: &str) -> Self {
        self.0.update(s.as_bytes());
        self
    }

    /// Finalize the key into a hex-encoded SHA-256 hash string.
    pub fn into_hashed(self) -> HashedCollapseKey {
        let hash = self.0.finalize();
        HashedCollapseKey(hex::encode(hash))
    }
}

/// APNS message attributes for SNS delivery.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageAttributes {
    /// The push notification type (alert or background).
    pub push_type: PushType,
    /// The collapse key for grouping/replacing notifications.
    pub collapse_key: String,
}

/// The type of push notification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PushType {
    /// Background/silent notification.
    Background,
    /// Alert notification with visible content.
    Alert,
}

/// A device endpoint for push notifications.
#[derive(Debug, Clone)]
pub enum DeviceEndpoint {
    /// Android device endpoint (FCM).
    Android(String),
    /// iOS device endpoint (APNS).
    Ios(String),
    /// iOS VoIP device endpoint (APNS_VOIP / PushKit).
    IosVoip(String),
}
