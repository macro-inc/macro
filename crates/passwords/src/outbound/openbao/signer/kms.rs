use super::{JwtSigner, SignError, der_to_raw};
use async_trait::async_trait;
use aws_sdk_kms::{
    error::ProvideErrorMetadata,
    primitives::Blob,
    types::{MessageType, SigningAlgorithmSpec},
};
use sha2::{Digest, Sha256};

/// A KMS key reference: a key ARN, or (local stacks only) an alias name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KmsKeyId(String);

/// Why a configured key reference was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum KmsKeyIdError {
    /// Not a KMS key ARN (`arn:aws:kms:<region>:<account>:key/<id>`).
    #[error("PASSWORDS_JWT_KMS_KEY_ID must be a KMS key ARN")]
    NotKeyArn,
}

impl KmsKeyId {
    /// Accepts a key ARN anywhere. An `alias/...` name is accepted only when
    /// `allow_alias` is set (local stacks, whose LocalStack key id changes
    /// every run); deployed services must name the key itself.
    pub fn parse(value: &str, allow_alias: bool) -> Result<Self, KmsKeyIdError> {
        let key_arn = lazy_regex::regex_is_match!(
            r"^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[A-Za-z0-9-]+$",
            value
        );
        let alias = allow_alias && lazy_regex::regex_is_match!(r"^alias/[A-Za-z0-9/_-]+$", value);
        if key_arn || alias {
            Ok(Self(value.to_owned()))
        } else {
            Err(KmsKeyIdError::NotKeyArn)
        }
    }

    /// The value passed to KMS as `KeyId`.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Signs through an asymmetric `ECC_NIST_P256` KMS key with `ECDSA_SHA_256`.
/// The digest is computed locally and only those 32 bytes reach KMS.
pub struct KmsJwtSigner {
    client: aws_sdk_kms::Client,
    key: KmsKeyId,
}

impl KmsJwtSigner {
    /// A signer for `key` through `client`.
    pub fn new(client: aws_sdk_kms::Client, key: KmsKeyId) -> Self {
        Self { client, key }
    }
}

#[async_trait]
impl JwtSigner for KmsJwtSigner {
    fn kind(&self) -> &'static str {
        "kms"
    }

    async fn sign(&self, signing_input: &[u8]) -> Result<[u8; 64], SignError> {
        let digest = Sha256::digest(signing_input);
        let response = self
            .client
            .sign()
            .key_id(self.key.as_str())
            .message(Blob::new(digest.to_vec()))
            .message_type(MessageType::Digest)
            .signing_algorithm(SigningAlgorithmSpec::EcdsaSha256)
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(
                    code = error.code(),
                    "KMS refused to sign the OpenBao login JWT"
                );
                SignError::Unavailable
            })?;
        let signature = response.signature().ok_or(SignError::InvalidSignature)?;
        der_to_raw(signature.as_ref())
    }
}
