//! The KMS JSON protocol (`X-Amz-Target: TrentService.<Action>`), the subset Macro uses.

use std::collections::BTreeMap;

use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use rand::RngCore as _;
use rootcause::Report;
use serde_json::{Value, json};
use std::time::Duration;

use crate::bao::{DecryptError, Transit};

const AMZ_JSON: &str = "application/x-amz-json-1.1";
const TARGET_PREFIX: &str = "TrentService.";
const ACCOUNT_ID: &str = "000000000000";
const REGION: &str = "us-east-1";
const BAD_REQUEST: &str = "ValidationException";
const BAD_CIPHERTEXT: &str = "InvalidCiphertextException";
const DATA_KEY_BYTES: usize = 32;
const SLOW_REQUEST: Duration = Duration::from_secs(2);
/// Separates the key name from transit's ciphertext inside a blob.
const BLOB_SEPARATOR: char = '\n';

pub fn router(transit: Transit) -> Router {
    Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .fallback(handle)
        .layer(MacroRequestIdAndTracingLayer::new(SLOW_REQUEST).into_inner())
        .with_state(transit)
}

enum ApiError {
    Client(&'static str, String),
    Internal(Report),
}

impl From<Report> for ApiError {
    fn from(report: Report) -> Self {
        Self::Internal(report)
    }
}

impl From<DecryptError> for ApiError {
    fn from(error: DecryptError) -> Self {
        match error {
            DecryptError::Rejected => {
                Self::Client(BAD_CIPHERTEXT, "the ciphertext is invalid".to_owned())
            }
            DecryptError::Failed(report) => Self::Internal(report),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, kind, message) = match self {
            Self::Client(kind, message) => (StatusCode::BAD_REQUEST, kind, message),
            Self::Internal(error) => {
                tracing::error!(?error, "kms request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "KMSInternalException",
                    "internal error".to_owned(),
                )
            }
        };
        amz_json(status, &json!({ "__type": kind, "message": message }))
    }
}

fn amz_json(status: StatusCode, body: &Value) -> Response {
    (status, [(header::CONTENT_TYPE, AMZ_JSON)], body.to_string()).into_response()
}

async fn handle(
    State(transit): State<Transit>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    let action = headers
        .get("x-amz-target")
        .and_then(|target| target.to_str().ok())
        .and_then(|target| target.strip_prefix(TARGET_PREFIX))
        .ok_or_else(|| ApiError::Client(BAD_REQUEST, "missing X-Amz-Target".to_owned()))?
        .to_owned();
    let request: Value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body)
            .map_err(|error| ApiError::Client(BAD_REQUEST, error.to_string()))?
    };
    let response = match action.as_str() {
        "Encrypt" => encrypt(&transit, &request).await?,
        "Decrypt" => decrypt(&transit, &request).await?,
        "GenerateDataKey" => generate_data_key(&transit, &request).await?,
        // Keys appear on first use, so provisioning has nothing to do.
        "CreateKey" => create_key(),
        "CreateAlias" => json!({}),
        "ListAliases" => json!({ "Aliases": [], "Truncated": false }),
        other => {
            return Err(ApiError::Client(
                "UnsupportedOperationException",
                format!("{other} is not supported"),
            ));
        }
    };
    Ok(amz_json(StatusCode::OK, &response))
}

fn create_key() -> Value {
    let id = uuid::Uuid::new_v4().to_string();
    json!({
        "KeyMetadata": {
            "KeyId": id,
            "Arn": format!("arn:aws:kms:{REGION}:{ACCOUNT_ID}:key/{id}"),
            "Enabled": true,
        }
    })
}

/// The transit key a KMS key id or alias maps to: names allow no slashes.
fn transit_key(key_id: &str) -> String {
    key_id.replace(['/', ':'], "-")
}

fn key_of(request: &Value) -> Result<String, ApiError> {
    request["KeyId"]
        .as_str()
        .filter(|key| !key.is_empty())
        .map(transit_key)
        .ok_or_else(|| ApiError::Client(BAD_REQUEST, "missing KeyId".to_owned()))
}

/// An encryption context as transit's associated data: base64 of its entries in a fixed
/// order, so the same context always gives the same bytes.
fn associated_data(request: &Value) -> String {
    let entries: BTreeMap<&str, &str> = request["EncryptionContext"]
        .as_object()
        .map(|context| {
            context
                .iter()
                .filter_map(|(key, value)| Some((key.as_str(), value.as_str()?)))
                .collect()
        })
        .unwrap_or_default();
    let canonical = serde_json::to_string(&entries).unwrap_or_default();
    STANDARD.encode(canonical)
}

fn encode_blob(key: &str, ciphertext: &str) -> String {
    STANDARD.encode(format!("{key}{BLOB_SEPARATOR}{ciphertext}"))
}

fn decode_blob(blob: &str) -> Option<(String, String)> {
    let bytes = STANDARD.decode(blob).ok()?;
    let text = String::from_utf8(bytes).ok()?;
    let (key, ciphertext) = text.split_once(BLOB_SEPARATOR)?;
    Some((key.to_owned(), ciphertext.to_owned()))
}

#[tracing::instrument(name = "kms.encrypt", skip_all, fields(key))]
async fn encrypt(transit: &Transit, request: &Value) -> Result<Value, ApiError> {
    let key = key_of(request)?;
    tracing::Span::current().record("key", key.as_str());
    let plaintext = request["Plaintext"]
        .as_str()
        .ok_or_else(|| ApiError::Client(BAD_REQUEST, "missing Plaintext".to_owned()))?;
    let ciphertext = transit
        .encrypt(&key, plaintext, &associated_data(request))
        .await?;
    Ok(json!({
        "CiphertextBlob": encode_blob(&key, &ciphertext),
        "KeyId": key,
        "EncryptionAlgorithm": "SYMMETRIC_DEFAULT",
    }))
}

#[tracing::instrument(name = "kms.decrypt", skip_all, fields(key))]
async fn decrypt(transit: &Transit, request: &Value) -> Result<Value, ApiError> {
    let invalid = || ApiError::Client(BAD_CIPHERTEXT, "the ciphertext is invalid".to_owned());
    let (key, ciphertext) = request["CiphertextBlob"]
        .as_str()
        .and_then(decode_blob)
        .ok_or_else(invalid)?;
    tracing::Span::current().record("key", key.as_str());
    // KMS refuses a ciphertext decrypted under a key other than the one named.
    if request["KeyId"]
        .as_str()
        .is_some_and(|named| transit_key(named) != key)
    {
        return Err(ApiError::Client(
            "IncorrectKeyException",
            "the ciphertext was encrypted under another key".to_owned(),
        ));
    }
    let plaintext = transit
        .decrypt(&key, &ciphertext, &associated_data(request))
        .await?;
    Ok(json!({
        "Plaintext": plaintext,
        "KeyId": key,
        "EncryptionAlgorithm": "SYMMETRIC_DEFAULT",
    }))
}

#[tracing::instrument(name = "kms.generate_data_key", skip_all, fields(key))]
async fn generate_data_key(transit: &Transit, request: &Value) -> Result<Value, ApiError> {
    let key = key_of(request)?;
    tracing::Span::current().record("key", key.as_str());
    let mut data_key = [0u8; DATA_KEY_BYTES];
    rand::rng().fill_bytes(&mut data_key);
    let plaintext = STANDARD.encode(data_key);
    let ciphertext = transit
        .encrypt(&key, &plaintext, &associated_data(request))
        .await?;
    Ok(json!({
        "CiphertextBlob": encode_blob(&key, &ciphertext),
        "Plaintext": plaintext,
        "KeyId": key,
    }))
}

#[cfg(test)]
mod test;
