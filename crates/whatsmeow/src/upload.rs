// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow upload.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Like `download.rs`, the work happens in free functions taking the media
// HTTP client and a refreshed media connection; the `Client` methods at the
// bottom wrap them. Not ported:
// `UploadReader` and `UploadNewsletterReader`, which stream from a reader
// (the port's reqwest has no streaming bodies); `util::cbcutil::encrypt_stream`
// is there for `UploadReader` when it is needed.

//! Encrypting and uploading attachments.

use base64::Engine;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::download::{MEDIA_HMAC_LENGTH, MediaHttpClient, MediaType, get_media_keys};
use crate::mediaconn::MediaConn;
use crate::socket::ORIGIN;
use crate::util::cbcutil::{self, CbcError};

/// The data from an attachment upload, which can be put into a message to
/// send the attachment: copy the fields to the corresponding fields of e.g.
/// an `ImageMessage` (`url`, `direct_path`, `media_key`, `file_enc_sha256`,
/// `file_sha256`, `file_length`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UploadResponse {
    /// The `url` from the server.
    pub url: String,
    /// The `direct_path` from the server.
    pub direct_path: String,
    /// The `handle` from the server; newsletter sends need it.
    pub handle: String,
    /// The `object_id` from the server.
    pub object_id: String,

    /// The random key the attachment is encrypted with; empty for newsletter
    /// media.
    pub media_key: Vec<u8>,
    /// SHA-256 of the uploaded ciphertext and MAC; empty for newsletter media.
    pub file_enc_sha256: Vec<u8>,
    /// SHA-256 of the plaintext.
    pub file_sha256: Vec<u8>,
    /// The plaintext length.
    pub file_length: u64,
}

/// The JSON fields of [`UploadResponse`]. Go decodes into the response, so a
/// missing or `null` field keeps the value it had.
#[derive(Deserialize)]
struct UploadResponseJson {
    url: Option<String>,
    direct_path: Option<String>,
    handle: Option<String>,
    object_id: Option<String>,
}

/// An upload or delete failure.
#[derive(Debug, thiserror::Error)]
pub enum UploadError {
    /// Encrypting failed.
    #[error("failed to encrypt file: {0}")]
    Encrypt(#[source] CbcError),
    /// The media connection has no hosts. Go panics on the empty slice.
    #[error("media connection has no hosts")]
    NoHosts,
    /// Sending the request failed.
    #[error("failed to execute request: {0}")]
    Request(#[source] reqwest::Error),
    /// The upload host answered with a status other than 200.
    #[error("upload failed with status code {0}")]
    Status(u16),
    /// The upload response body couldn't be read.
    #[error("failed to parse upload response: {0}")]
    ReadResponse(#[source] reqwest::Error),
    /// The upload response isn't the expected JSON.
    #[error("failed to parse upload response: {0}")]
    ParseResponse(#[source] serde_json::Error),
    /// The delete host answered with a non-2xx status.
    #[error("media delete failed with status code {0}")]
    DeleteStatus(u16),
}

/// Uploads the given attachment to WhatsApp servers, encrypted with a new
/// random media key.
///
/// Copy the fields in the response to the corresponding fields in a protobuf
/// message, e.g. an `ImageMessage`, then send it.
pub async fn upload(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    plaintext: &[u8],
    app_info: MediaType,
) -> Result<UploadResponse, UploadError> {
    let media_key: [u8; 32] = rand::random();
    let (mut resp, data_to_upload) = encrypt_media(plaintext, &media_key, app_info)?;
    let file_enc_sha256 = resp.file_enc_sha256.clone();
    raw_upload(
        http,
        media_conn,
        data_to_upload,
        &file_enc_sha256,
        app_info,
        false,
        &mut resp,
    )
    .await?;
    Ok(resp)
}

/// The encryption half of Go's `Upload`: AES-256-CBC under the expanded media
/// key, followed by the first 10 bytes of HMAC-SHA256(iv || ciphertext).
/// Returns the response with the key, hashes and length filled in, and the
/// bytes to upload.
pub(crate) fn encrypt_media(
    plaintext: &[u8],
    media_key: &[u8],
    app_info: MediaType,
) -> Result<(UploadResponse, Vec<u8>), UploadError> {
    let mut resp = UploadResponse {
        file_length: plaintext.len() as u64,
        media_key: media_key.to_vec(),
        file_sha256: Sha256::digest(plaintext).to_vec(),
        ..UploadResponse::default()
    };

    let keys = get_media_keys(media_key, Some(app_info));
    let mut data_to_upload = cbcutil::encrypt(&keys.cipher_key, Some(&keys.iv), plaintext)
        .map_err(UploadError::Encrypt)?;

    let mut hmac = <Hmac<Sha256> as Mac>::new_from_slice(&keys.mac_key)
        .expect("HMAC-SHA256 accepts keys of any length");
    hmac.update(&keys.iv);
    hmac.update(&data_to_upload);
    data_to_upload.extend_from_slice(&hmac.finalize().into_bytes()[..MEDIA_HMAC_LENGTH]);

    resp.file_enc_sha256 = Sha256::digest(&data_to_upload).to_vec();
    Ok((resp, data_to_upload))
}

/// Uploads the given attachment to WhatsApp servers without encrypting it
/// first, for newsletters.
///
/// The response has no media key or ciphertext hash, and its `handle` must
/// be passed along when sending the message.
pub async fn upload_newsletter(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    data: &[u8],
    app_info: MediaType,
) -> Result<UploadResponse, UploadError> {
    let mut resp = UploadResponse {
        file_length: data.len() as u64,
        file_sha256: Sha256::digest(data).to_vec(),
        ..UploadResponse::default()
    };
    let file_sha256 = resp.file_sha256.clone();
    raw_upload(
        http,
        media_conn,
        data.to_vec(),
        &file_sha256,
        app_info,
        true,
        &mut resp,
    )
    .await?;
    Ok(resp)
}

async fn raw_upload(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    data_to_upload: Vec<u8>,
    file_hash: &[u8],
    app_info: MediaType,
    newsletter: bool,
    resp: &mut UploadResponse,
) -> Result<(), UploadError> {
    let token = URL_SAFE.encode(file_hash);
    let query = encode_query(&[("auth", &media_conn.auth), ("token", &token)]);
    let mut mms_type = app_info.mms_type().to_owned();
    let mut upload_prefix = "mms";
    if http.messenger {
        upload_prefix = "wa-msgr/mms";
        // Messenger upload only allows voice messages, not audio files
        if mms_type == "audio" {
            "ptt".clone_into(&mut mms_type);
        }
    }
    if newsletter {
        mms_type = format!("newsletter-{mms_type}");
        upload_prefix = "newsletter";
    }
    // Hacky hack to prefer last option (rupload.facebook.com) for messenger uploads.
    // For some reason, the primary host doesn't work, even though it has the <upload/> tag.
    let host = if http.messenger {
        media_conn.hosts.last()
    } else {
        media_conn.hosts.first()
    }
    .ok_or(UploadError::NoHosts)?;
    // The path parts are base64url and fixed names, which Go's URL.String
    // leaves unescaped.
    let upload_url = format!(
        "{}://{}/{upload_prefix}/{mms_type}/{token}?{query}",
        http.scheme,
        http.host(&host.hostname),
    );

    let http_resp = http
        .client
        .post(upload_url)
        .header("Origin", ORIGIN)
        .header("Referer", format!("{ORIGIN}/"))
        .body(data_to_upload)
        .send()
        .await
        .map_err(UploadError::Request)?;
    if http_resp.status() != reqwest::StatusCode::OK {
        return Err(UploadError::Status(http_resp.status().as_u16()));
    }
    let body = http_resp.bytes().await.map_err(UploadError::ReadResponse)?;
    let json: UploadResponseJson =
        serde_json::from_slice(&body).map_err(UploadError::ParseResponse)?;
    let fields = [
        (json.url, &mut resp.url),
        (json.direct_path, &mut resp.direct_path),
        (json.handle, &mut resp.handle),
        (json.object_id, &mut resp.object_id),
    ];
    for (value, field) in fields {
        if let Some(value) = value {
            *field = value;
        }
    }
    Ok(())
}

/// Deletes the media at the given direct path from WhatsApp servers.
///
/// This is only used for things like history syncs, which should be deleted
/// after processing. `companion_meta_nonce` is Go's
/// `Client.Store.CompanionMetaNonce`.
pub async fn delete_media(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    app_info: MediaType,
    direct_path: &str,
    enc_file_hash: &[u8],
    enc_handle: &str,
    companion_meta_nonce: &str,
) -> Result<(), UploadError> {
    if direct_path.is_empty() {
        return Ok(());
    }
    let direct_path = match direct_path.find('?') {
        Some(query_start) if query_start > 0 => &direct_path[..query_start],
        _ => direct_path,
    };

    let token = URL_SAFE.encode(enc_file_hash);
    let d_md = URL_SAFE_NO_PAD.encode(direct_path);
    let mut query = vec![
        ("token", token.as_str()),
        ("d_md", d_md.as_str()),
        ("auth", media_conn.auth.as_str()),
    ];
    if !enc_handle.is_empty() {
        query.push(("e_handle", enc_handle));
    }
    let host = media_conn.hosts.first().ok_or(UploadError::NoHosts)?;
    let delete_url = format!(
        "{}://{}/mms/{}/{token}?{}",
        http.scheme,
        http.host(&host.hostname),
        app_info.mms_type(),
        encode_query(&query),
    );

    let mut request = http
        .client
        .delete(delete_url)
        .header("Origin", ORIGIN)
        .header("Referer", format!("{ORIGIN}/"));
    if !companion_meta_nonce.is_empty() && !enc_handle.is_empty() {
        request = request.header("Companion_User_Secret", companion_meta_nonce);
    }

    let http_resp = request.send().await.map_err(UploadError::Request)?;
    if !http_resp.status().is_success() {
        return Err(UploadError::DeleteStatus(http_resp.status().as_u16()));
    }
    Ok(())
}

/// Go's `url.Values.Encode` for single values: sorted by key, each side
/// escaped with `url.QueryEscape`.
fn encode_query(values: &[(&str, &str)]) -> String {
    let mut values = values.to_vec();
    values.sort_by_key(|(key, _)| *key);
    values
        .iter()
        .map(|(key, value)| format!("{}={}", query_escape(key), query_escape(value)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Go's `url.QueryEscape`: letters, digits and `-_.~` stay, a space becomes
/// `+`, everything else is percent-encoded with upper-case hex.
fn query_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                escaped.push(char::from(byte));
            }
            b' ' => escaped.push('+'),
            _ => escaped.push_str(&format!("%{byte:02X}")),
        }
    }
    escaped
}

impl crate::client::Client {
    /// Encrypts and uploads an attachment (`Upload`); copy the response into
    /// the message part (e.g. an `ImageMessage`) before sending it.
    #[tracing::instrument(
        name = "whatsmeow.upload",
        skip_all,
        fields(media_type = %app_info, size = plaintext.len()),
        err
    )]
    pub async fn upload(
        &self,
        plaintext: &[u8],
        app_info: MediaType,
    ) -> Result<UploadResponse, crate::errors::ClientError> {
        let media_conn = self.media_conn_for_transfer().await?;
        Ok(upload(&self.media_http(), &media_conn, plaintext, app_info).await?)
    }

    /// Deletes media from WhatsApp servers; used for history syncs once
    /// processed (`DeleteMedia`).
    pub async fn delete_media(
        &self,
        app_info: MediaType,
        direct_path: &str,
        enc_file_hash: &[u8],
        enc_handle: &str,
    ) -> Result<(), crate::errors::ClientError> {
        if direct_path.is_empty() {
            return Ok(());
        }
        let media_conn = self.media_conn_for_transfer().await?;
        let nonce = self.store.read().await.companion_meta_nonce.clone();
        Ok(delete_media(
            &self.media_http(),
            &media_conn,
            app_info,
            direct_path,
            enc_file_hash,
            enc_handle,
            &nonce,
        )
        .await?)
    }
}

#[cfg(test)]
mod test;
