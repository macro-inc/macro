// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow types/passkey.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go's `jsonbytes.UnpaddedURLBytes` is [`UnpaddedUrlBytes`]; the JSON field
// names and order match Go's.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Bytes that are unpadded URL-safe base64 in JSON.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UnpaddedUrlBytes(pub Vec<u8>);

impl Serialize for UnpaddedUrlBytes {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&URL_SAFE_NO_PAD.encode(&self.0))
    }
}

impl<'de> Deserialize<'de> for UnpaddedUrlBytes {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        URL_SAFE_NO_PAD
            .decode(value)
            .map(UnpaddedUrlBytes)
            .map_err(serde::de::Error::custom)
    }
}

/// The WebAuthn request options the server sends when pairing needs a passkey.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct WebAuthnPublicKey {
    /// The challenge to sign.
    pub challenge: UnpaddedUrlBytes,
    /// The timeout in milliseconds.
    pub timeout: i64,
    /// The relying party ID.
    #[serde(rename = "rpId")]
    pub relying_party_id: String,
    /// The credentials that may answer.
    #[serde(rename = "allowCredentials")]
    pub allow_credentials: Vec<AllowedCredential>,
    /// The user verification requirement.
    #[serde(rename = "userVerification")]
    pub user_verification: String,
    /// Extensions, passed through as JSON.
    pub extensions: serde_json::Map<String, serde_json::Value>,
}

/// A credential allowed to answer a WebAuthn request.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AllowedCredential {
    /// The credential ID.
    pub id: UnpaddedUrlBytes,
    /// The credential type (`public-key`).
    #[serde(rename = "type")]
    pub r#type: String,
    /// The transports.
    pub transports: Vec<String>,
}

/// The authenticator's answer to a [`WebAuthnPublicKey`] request.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WebAuthnResponse {
    /// The credential ID as a string.
    pub id: String,
    /// The raw credential ID.
    #[serde(rename = "rawId")]
    pub raw_id: UnpaddedUrlBytes,
    /// The credential type.
    #[serde(rename = "type")]
    pub r#type: String,
    /// The assertion.
    pub response: WebAuthnResponseData,
}

/// The signed parts of a WebAuthn assertion.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WebAuthnResponseData {
    /// The client data JSON.
    #[serde(rename = "clientDataJSON")]
    pub client_data_json: UnpaddedUrlBytes,
    /// The authenticator data.
    #[serde(rename = "authenticatorData")]
    pub authenticator_data: UnpaddedUrlBytes,
    /// The signature.
    pub signature: UnpaddedUrlBytes,
    /// The user handle, if any.
    #[serde(rename = "userHandle")]
    pub user_handle: Option<UnpaddedUrlBytes>,
}
