// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow download.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// The work happens in free functions taking the media HTTP client
// ([`MediaHttpClient`]) and an already refreshed [`MediaConn`], so it is
// testable against local hosts; the `Client` methods at the bottom refresh
// the media connection (after checking the path, as Go does) and call them.
// Not wrapped on `Client` yet: `DownloadAny`, `DownloadThumbnail`,
// `DownloadFB`, `DownloadMediaWithPathToFile` (call the free functions). Not ported: `FetchStickerPack` and the `types.StickerPackItem`
// implementation (the sticker pack types aren't ported yet). Go's
// `ErrUnknownMediaType` can't happen: only types with a media type implement
// the traits. The `DownloadHTTPError` and `Download` sentinels from Go's
// `errors.go` are [`DownloadError`] variants.

//! Downloading and decrypting attachments.

use std::io;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE;
use chrono::{NaiveDateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::mediaconn::MediaConn;
use crate::proto::wa_e2e::{
    AudioMessage, DocumentMessage, ExtendedTextMessage, HistorySyncNotification, ImageMessage,
    Message, StickerMessage, StickerPackMessage, VideoMessage,
};
use crate::proto::wa_history_sync::StickerMetadata;
use crate::proto::wa_media_transport::wa_media_transport::Integral;
use crate::proto::wa_server_sync::ExternalBlobReference;
use crate::socket::ORIGIN;
use crate::util::cbcutil::{self, CbcError};
use crate::util::hkdfutil;

/// How many bytes of the HMAC WhatsApp appends to encrypted media.
pub(crate) const MEDIA_HMAC_LENGTH: usize = 10;

/// A type of uploaded file on WhatsApp. Its string ([`MediaType::app_info`])
/// is the HKDF info used to expand the media key.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MediaType {
    /// Go's `MediaImage`.
    Image,
    /// Go's `MediaVideo`.
    Video,
    /// Go's `MediaAudio`.
    Audio,
    /// Go's `MediaDocument`.
    Document,
    /// Go's `MediaHistory`.
    History,
    /// Go's `MediaAppState`.
    AppState,
    /// Go's `MediaStickerPack`.
    StickerPack,
    /// Go's `MediaLinkThumbnail`.
    LinkThumbnail,
}

impl MediaType {
    /// The Go string value, used to generate the encryption keys.
    pub const fn app_info(self) -> &'static str {
        match self {
            MediaType::Image => "WhatsApp Image Keys",
            MediaType::Video => "WhatsApp Video Keys",
            MediaType::Audio => "WhatsApp Audio Keys",
            MediaType::Document => "WhatsApp Document Keys",
            MediaType::History => "WhatsApp History Keys",
            MediaType::AppState => "WhatsApp App State Keys",
            MediaType::StickerPack => "WhatsApp Sticker Pack Keys",
            MediaType::LinkThumbnail => "WhatsApp Link Thumbnail Keys",
        }
    }

    /// The media type's name in upload and download URLs (Go's
    /// `mediaTypeToMMSType`).
    pub const fn mms_type(self) -> &'static str {
        match self {
            MediaType::Image => "image",
            MediaType::Audio => "audio",
            MediaType::Video => "video",
            MediaType::Document => "document",
            MediaType::History => "md-msg-hist",
            MediaType::AppState => "md-app-state",
            MediaType::StickerPack => "sticker-pack",
            MediaType::LinkThumbnail => "thumbnail-link",
        }
    }
}

impl std::fmt::Display for MediaType {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.app_info())
    }
}

/// A protobuf message that contains attachment info.
///
/// All of the downloadable messages inside a [`Message`] implement this
/// ([`ImageMessage`], [`VideoMessage`], [`AudioMessage`], [`DocumentMessage`],
/// [`StickerMessage`]). Go's `MediaTypeable` and its `classToMediaType` lookup
/// are folded into [`DownloadableMessage::get_media_type`]. Unset fields are
/// `None`, as Go's getters return `nil`. `Sync` so downloads are `Send`
/// futures.
pub trait DownloadableMessage: Sync {
    /// The path of the attachment on the media hosts.
    fn get_direct_path(&self) -> &str;
    /// The key the attachment is encrypted with.
    fn get_media_key(&self) -> Option<&[u8]>;
    /// SHA-256 of the plaintext.
    fn get_file_sha256(&self) -> Option<&[u8]>;
    /// SHA-256 of the ciphertext and its MAC.
    fn get_file_enc_sha256(&self) -> Option<&[u8]>;
    /// The media type the keys are expanded with.
    fn get_media_type(&self) -> MediaType;
}

/// A protobuf message that contains a thumbnail attachment.
///
/// This is primarily meant for link preview thumbnails in
/// [`ExtendedTextMessage`]. Go's `classToThumbnailMediaType` lookup is
/// [`DownloadableThumbnail::get_thumbnail_media_type`].
pub trait DownloadableThumbnail {
    /// The path of the thumbnail on the media hosts.
    fn get_thumbnail_direct_path(&self) -> &str;
    /// SHA-256 of the thumbnail plaintext.
    fn get_thumbnail_sha256(&self) -> Option<&[u8]>;
    /// SHA-256 of the thumbnail ciphertext and its MAC.
    fn get_thumbnail_enc_sha256(&self) -> Option<&[u8]>;
    /// The key the thumbnail is encrypted with.
    fn get_media_key(&self) -> Option<&[u8]>;
    /// The media type the keys are expanded with.
    fn get_thumbnail_media_type(&self) -> MediaType;
}

macro_rules! downloadable_message {
    ($($message:ty => $media_type:expr),* $(,)?) => {$(
        impl DownloadableMessage for $message {
            fn get_direct_path(&self) -> &str {
                self.direct_path.as_deref().unwrap_or_default()
            }

            fn get_media_key(&self) -> Option<&[u8]> {
                self.media_key.as_deref()
            }

            fn get_file_sha256(&self) -> Option<&[u8]> {
                self.file_sha256.as_deref()
            }

            fn get_file_enc_sha256(&self) -> Option<&[u8]> {
                self.file_enc_sha256.as_deref()
            }

            fn get_media_type(&self) -> MediaType {
                $media_type
            }
        }
    )*};
}

downloadable_message! {
    ImageMessage => MediaType::Image,
    AudioMessage => MediaType::Audio,
    VideoMessage => MediaType::Video,
    DocumentMessage => MediaType::Document,
    StickerMessage => MediaType::Image,
    StickerMetadata => MediaType::Image,
    StickerPackMessage => MediaType::StickerPack,
    HistorySyncNotification => MediaType::History,
    ExternalBlobReference => MediaType::AppState,
}

impl DownloadableThumbnail for ExtendedTextMessage {
    fn get_thumbnail_direct_path(&self) -> &str {
        self.thumbnail_direct_path.as_deref().unwrap_or_default()
    }

    fn get_thumbnail_sha256(&self) -> Option<&[u8]> {
        self.thumbnail_sha256.as_deref()
    }

    fn get_thumbnail_enc_sha256(&self) -> Option<&[u8]> {
        self.thumbnail_enc_sha256.as_deref()
    }

    fn get_media_key(&self) -> Option<&[u8]> {
        self.media_key.as_deref()
    }

    fn get_thumbnail_media_type(&self) -> MediaType {
        MediaType::LinkThumbnail
    }
}

/// The media type corresponding to the given protobuf message.
pub fn get_media_type(msg: &dyn DownloadableMessage) -> MediaType {
    msg.get_media_type()
}

/// A media download, upload or delete failure.
#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    /// The host answered with a status other than 200 (Go's
    /// `DownloadHTTPError`; `ErrMediaDownloadFailedWith403`/`404`/`410` are
    /// this with those codes).
    #[error("download failed with status code {status_code}")]
    Http {
        /// The HTTP status code.
        status_code: u16,
        /// The `Retry-After` header, if any.
        retry_after: Option<String>,
    },
    /// The message has no direct path.
    #[error("no url present")]
    NoUrlPresent,
    /// The download is no longer than the MAC.
    #[error("file too short")]
    TooShortFile,
    /// The MAC doesn't match.
    #[error("invalid media hmac")]
    InvalidMediaHmac,
    /// The ciphertext hash doesn't match.
    #[error("hash of media ciphertext doesn't match")]
    InvalidMediaEncSha256,
    /// The plaintext hash doesn't match.
    #[error("hash of media plaintext doesn't match")]
    InvalidMediaSha256,
    /// The hash of unencrypted media doesn't match.
    #[error("hash of unencrypted media doesn't match")]
    InvalidUnencryptedMediaSha256,
    /// [`download_any`] found no attachment.
    #[error("didn't find any attachments in message")]
    NothingDownloadableFound,
    /// The direct path isn't absolute.
    #[error("media download path does not start with slash: {0}")]
    PathWithoutSlash(String),
    /// The expected ciphertext hash isn't 32 bytes.
    #[error("invalid checksum length: expected 32, got {0}")]
    InvalidChecksumLength(usize),
    /// Sending the request or reading the response failed. Go returns the
    /// `net/http` error as is, and retries it.
    #[error(transparent)]
    Transport(reqwest::Error),
    /// Decrypting failed.
    #[error("failed to decrypt file: {0}")]
    Decrypt(#[source] CbcError),
    /// Reading or writing the output file failed.
    #[error("{context}: {source}")]
    Io {
        /// What was being done.
        context: &'static str,
        /// The underlying failure.
        source: io::Error,
    },
    /// Every host failed; this is the last host's error.
    #[error("failed to download media from last host: {0}")]
    LastHost(#[source] Box<DownloadError>),
}

impl DownloadError {
    /// Whether this is, or wraps, a [`DownloadError::Http`] with the status
    /// code: Go's `errors.Is(err, ErrMediaDownloadFailedWith404)`.
    pub fn is_http_status(&self, code: u16) -> bool {
        match self {
            DownloadError::Http { status_code, .. } => *status_code == code,
            DownloadError::LastHost(inner) => inner.is_http_status(code),
            _ => false,
        }
    }

    /// Whether the download loop stops at this error instead of trying the
    /// next host.
    pub(crate) fn stops_host_loop(&self) -> bool {
        matches!(self, DownloadError::InvalidMediaSha256)
            || self.is_http_status(403)
            || self.is_http_status(404)
            || self.is_http_status(410)
    }
}

/// The HTTP side of the client's media handling: Go's `Client.mediaHTTP` and
/// the user agent from `Client.getUserAgent`.
#[derive(Clone, Debug)]
pub struct MediaHttpClient {
    /// The HTTP client.
    pub client: reqwest::Client,
    /// The `User-Agent` for downloads; empty sends none.
    pub user_agent: String,
    /// Whether the client is a Messenger client (Go's
    /// `Client.MessengerConfig != nil`); changes the upload URL.
    pub messenger: bool,
    /// The URL scheme. Always `https` (Go hardcodes it), unless
    /// [`MediaHttpClient::with_base_url`] points media at a local server.
    pub(crate) scheme: String,
    /// Replaces every media host when set (`host[:port]`), for tests.
    pub(crate) host_override: Option<String>,
}

impl MediaHttpClient {
    /// A media HTTP client using `https`.
    pub fn new(client: reqwest::Client, user_agent: String, messenger: bool) -> Self {
        MediaHttpClient {
            client,
            user_agent,
            messenger,
            scheme: "https".to_owned(),
            host_override: None,
        }
    }

    /// Sends every media request to `base_url` (`scheme://host[:port]`)
    /// instead of the hosts of the media connection, e.g. a local fake media
    /// server in tests. Not in whatsmeow.
    pub fn with_base_url(mut self, base_url: &str) -> Self {
        match base_url.split_once("://") {
            Some((scheme, host)) => {
                self.scheme = scheme.to_owned();
                self.host_override = Some(host.trim_end_matches('/').to_owned());
            }
            None => self.host_override = Some(base_url.trim_end_matches('/').to_owned()),
        }
        self
    }

    /// The host to contact instead of a media connection host.
    pub(crate) fn host<'host>(&'host self, hostname: &'host str) -> &'host str {
        self.host_override.as_deref().unwrap_or(hostname)
    }

    /// The download URL of `direct_path` on one host.
    pub fn media_download_url(
        &self,
        hostname: &str,
        direct_path: &str,
        enc_file_hash: Option<&[u8]>,
        mms_type: &str,
    ) -> String {
        // TODO omit hash for unencrypted media? (from Go)
        format!(
            "{}://{}{direct_path}&hash={}&mms-type={mms_type}&__wa-mms=",
            self.scheme,
            self.host(hostname),
            URL_SAFE.encode(enc_file_hash.unwrap_or_default()),
        )
    }
}

/// Downloads the first non-empty attachment of the message: the image,
/// video, audio, document or sticker.
#[deprecated(
    note = "find the specific message type you want to download manually and use download instead"
)]
pub async fn download_any(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    msg: Option<&Message>,
) -> Result<Vec<u8>, DownloadError> {
    let Some(msg) = msg else {
        return Err(DownloadError::NothingDownloadableFound);
    };
    let downloadable: &(dyn DownloadableMessage + Sync) = if let Some(image) = &msg.image_message {
        image.as_ref()
    } else if let Some(video) = &msg.video_message {
        video.as_ref()
    } else if let Some(audio) = &msg.audio_message {
        audio.as_ref()
    } else if let Some(document) = &msg.document_message {
        document.as_ref()
    } else if let Some(sticker) = &msg.sticker_message {
        sticker.as_ref()
    } else {
        return Err(DownloadError::NothingDownloadableFound);
    };
    download(http, media_conn, downloadable).await
}

/// Downloads a thumbnail from a message, primarily link preview thumbnails
/// in [`ExtendedTextMessage`].
pub async fn download_thumbnail(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    msg: &dyn DownloadableThumbnail,
) -> Result<Vec<u8>, DownloadError> {
    let media_type = msg.get_thumbnail_media_type();
    if msg.get_thumbnail_direct_path().is_empty() {
        return Err(DownloadError::NoUrlPresent);
    }
    let enc_sha256 = msg.get_thumbnail_enc_sha256();
    let mut media_key = msg.get_media_key();
    // TODO more proper check for unencrypted media? (also Download and DownloadToFile) (from Go)
    if enc_sha256.is_none() && media_key.is_some() {
        media_key = None;
    }
    download_media_with_path(
        http,
        media_conn,
        msg.get_thumbnail_direct_path(),
        enc_sha256,
        msg.get_thumbnail_sha256(),
        media_key,
        Some(media_type),
        media_type.mms_type(),
        false,
    )
    .await
}

/// Downloads the attachment from the given protobuf message, which is a part
/// of a [`Message`] (e.g. its `image_message`), not the message itself.
pub async fn download(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    msg: &(dyn DownloadableMessage + Sync),
) -> Result<Vec<u8>, DownloadError> {
    let media_type = get_media_type(msg);
    if msg.get_direct_path().is_empty() {
        return Err(DownloadError::NoUrlPresent);
    }
    let enc_sha256 = msg.get_file_enc_sha256();
    let mut media_key = msg.get_media_key();
    // TODO more proper check for unencrypted media? (also DownloadToFile) (from Go)
    if enc_sha256.is_none() && media_key.is_some() {
        media_key = None;
    }
    download_media_with_path(
        http,
        media_conn,
        msg.get_direct_path(),
        enc_sha256,
        msg.get_file_sha256(),
        media_key,
        Some(media_type),
        media_type.mms_type(),
        false,
    )
    .await
}

/// Downloads the attachment of a Messenger media transport.
pub async fn download_fb(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    transport: &Integral,
    media_type: MediaType,
) -> Result<Vec<u8>, DownloadError> {
    download_media_with_path(
        http,
        media_conn,
        transport.direct_path.as_deref().unwrap_or_default(),
        transport.file_enc_sha256.as_deref(),
        transport.file_sha256.as_deref(),
        transport.media_key.as_deref(),
        Some(media_type),
        media_type.mms_type(),
        false,
    )
    .await
}

/// Downloads unencrypted media by its path alone, without checking a hash.
pub async fn download_media_with_only_path(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    direct_path: &str,
) -> Result<Vec<u8>, DownloadError> {
    download_media_with_path(
        http,
        media_conn,
        direct_path,
        None,
        None,
        None,
        None,
        "",
        true,
    )
    .await
}

/// Downloads an attachment by manually specifying the path and encryption
/// details. Each media host is tried in turn until one succeeds or fails
/// with a permanent error. `media_type: None` is Go's empty `MediaType`
/// (only usable for unencrypted media); an empty `mms_type` uses the media
/// type's. With no hosts this returns an empty download, as Go does.
#[expect(
    clippy::too_many_arguments,
    reason = "mirrors Go's DownloadMediaWithPath"
)]
pub async fn download_media_with_path(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    direct_path: &str,
    enc_file_hash: Option<&[u8]>,
    file_hash: Option<&[u8]>,
    media_key: Option<&[u8]>,
    media_type: Option<MediaType>,
    mms_type: &str,
    allow_no_hash: bool,
) -> Result<Vec<u8>, DownloadError> {
    let zero_hash = [0; 32];
    let file_hash = match file_hash {
        None if !allow_no_hash => Some(zero_hash.as_slice()),
        file_hash => file_hash,
    };
    if !direct_path.starts_with('/') {
        return Err(DownloadError::PathWithoutSlash(direct_path.to_owned()));
    }
    let mms_type = match (mms_type, media_type) {
        ("", Some(media_type)) => media_type.mms_type(),
        (mms_type, _) => mms_type,
    };
    let mut data = Vec::new();
    for (index, host) in media_conn.hosts.iter().enumerate() {
        let media_url =
            http.media_download_url(&host.hostname, direct_path, enc_file_hash, mms_type);
        match download_and_decrypt(
            http,
            &media_url,
            media_key,
            media_type,
            enc_file_hash,
            file_hash,
        )
        .await
        {
            Ok(downloaded) => {
                data = downloaded;
                break;
            }
            Err(error) if error.stops_host_loop() => return Err(error),
            Err(error) if index >= media_conn.hosts.len() - 1 => {
                return Err(DownloadError::LastHost(Box::new(error)));
            }
            Err(error) => {
                tracing::warn!(%error, "failed to download media, trying with next host");
            }
        }
    }
    Ok(data)
}

async fn download_and_decrypt(
    http: &MediaHttpClient,
    url: &str,
    media_key: Option<&[u8]>,
    app_info: Option<MediaType>,
    file_enc_sha256: Option<&[u8]>,
    file_sha256: Option<&[u8]>,
) -> Result<Vec<u8>, DownloadError> {
    let keys = get_media_keys(media_key.unwrap_or_default(), app_info);
    let (ciphertext, mac) =
        download_possibly_encrypted_media_with_retries(http, url, file_enc_sha256).await?;
    if media_key.is_none() && file_enc_sha256.is_none() && mac.is_none() {
        // Unencrypted media, just check the hash and return
        if let Some(file_sha256) = file_sha256
            && Sha256::digest(&ciphertext)[..] != *file_sha256
        {
            return Err(DownloadError::InvalidUnencryptedMediaSha256);
        }
        return Ok(ciphertext);
    }
    validate_media(
        &keys.iv,
        &ciphertext,
        &keys.mac_key,
        mac.as_deref().unwrap_or_default(),
    )?;
    let data = cbcutil::decrypt(&keys.cipher_key, &keys.iv, &ciphertext)
        .map_err(DownloadError::Decrypt)?;
    if file_sha256 != Some(&Sha256::digest(&data)[..]) {
        return Err(DownloadError::InvalidMediaSha256);
    }
    Ok(data)
}

/// The keys expanded from a media key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediaKeys {
    /// The AES-CBC IV.
    pub iv: [u8; 16],
    /// The AES-256 key.
    pub cipher_key: [u8; 32],
    /// The HMAC-SHA256 key.
    pub mac_key: [u8; 32],
    /// The remaining 32 bytes, unused.
    pub ref_key: [u8; 32],
}

/// Expands a media key with HKDF-SHA256 into 112 bytes: the IV, cipher key,
/// MAC key and ref key. `None` is Go's empty `MediaType`.
pub fn get_media_keys(media_key: &[u8], app_info: Option<MediaType>) -> MediaKeys {
    let info = app_info.map(MediaType::app_info).unwrap_or_default();
    let expanded = hkdfutil::sha256(media_key, &[], info.as_bytes(), 112);
    let mut keys = MediaKeys {
        iv: [0; 16],
        cipher_key: [0; 32],
        mac_key: [0; 32],
        ref_key: [0; 32],
    };
    keys.iv.copy_from_slice(&expanded[..16]);
    keys.cipher_key.copy_from_slice(&expanded[16..48]);
    keys.mac_key.copy_from_slice(&expanded[48..80]);
    keys.ref_key.copy_from_slice(&expanded[80..]);
    keys
}

/// Whether a failed download is retried on the same host: network errors
/// and 502, 503, 504 and 429 responses.
pub(crate) fn should_retry_media_download(error: &DownloadError) -> bool {
    match error {
        DownloadError::Transport(_) => true,
        DownloadError::Http { status_code, .. } => retry_after_should(*status_code, true),
        _ => false,
    }
}

/// How long to wait before retry `retry_num` (0-based): `Retry-After` if the
/// error carries a valid one, else `retry_num + 1` seconds.
pub(crate) fn retry_duration(error: &DownloadError, retry_num: u32) -> Duration {
    let fallback = Duration::from_secs(u64::from(retry_num) + 1);
    match error {
        DownloadError::Http {
            retry_after: Some(retry_after),
            ..
        } => retry_after_parse(retry_after, fallback),
        _ => fallback,
    }
}

async fn download_possibly_encrypted_media_with_retries(
    http: &MediaHttpClient,
    url: &str,
    checksum: Option<&[u8]>,
) -> Result<(Vec<u8>, Option<Vec<u8>>), DownloadError> {
    let mut retry_num = 0;
    loop {
        let result = match checksum {
            None => download_media(http, url).await.map(|file| (file, None)),
            Some(checksum) => download_encrypted_media(http, url, checksum)
                .await
                .map(|(file, mac)| (file, Some(mac))),
        };
        let error = match result {
            Err(error) if should_retry_media_download(&error) => error,
            result => return result,
        };
        let retry_duration = retry_duration(&error, retry_num);
        tracing::warn!(
            %error,
            ?retry_duration,
            "failed to download media due to network error, retrying"
        );
        tokio::time::sleep(retry_duration).await;
        retry_num += 1;
        if retry_num == 5 {
            return Err(error);
        }
    }
}

/// Sends the GET for a media download and fails on a non-200 status.
pub(crate) async fn do_media_download_request(
    http: &MediaHttpClient,
    url: &str,
) -> Result<reqwest::Response, DownloadError> {
    let mut request = http
        .client
        .get(url)
        .header("Origin", ORIGIN)
        .header("Referer", format!("{ORIGIN}/"));
    if !http.user_agent.is_empty() {
        request = request.header("User-Agent", &http.user_agent);
    }
    let response = request.send().await.map_err(DownloadError::Transport)?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(DownloadError::Http {
            status_code: response.status().as_u16(),
            retry_after: response
                .headers()
                .get("Retry-After")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned),
        });
    }
    Ok(response)
}

async fn download_media(http: &MediaHttpClient, url: &str) -> Result<Vec<u8>, DownloadError> {
    let response = do_media_download_request(http, url).await?;
    let data = response.bytes().await.map_err(DownloadError::Transport)?;
    Ok(data.to_vec())
}

async fn download_encrypted_media(
    http: &MediaHttpClient,
    url: &str,
    checksum: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), DownloadError> {
    if checksum.len() != 32 {
        return Err(DownloadError::InvalidChecksumLength(checksum.len()));
    }
    let mut data = download_media(http, url).await?;
    if data.len() <= MEDIA_HMAC_LENGTH {
        return Err(DownloadError::TooShortFile);
    }
    if Sha256::digest(&data)[..] != *checksum {
        return Err(DownloadError::InvalidMediaEncSha256);
    }
    let mac = data.split_off(data.len() - MEDIA_HMAC_LENGTH);
    Ok((data, mac))
}

/// Checks the media MAC: the first 10 bytes of HMAC-SHA256(iv || file).
pub fn validate_media(
    iv: &[u8],
    file: &[u8],
    mac_key: &[u8],
    mac: &[u8],
) -> Result<(), DownloadError> {
    let mut hmac = <Hmac<Sha256> as Mac>::new_from_slice(mac_key)
        .expect("HMAC-SHA256 accepts keys of any length");
    hmac.update(iv);
    hmac.update(file);
    let sum = hmac.finalize().into_bytes();
    if !constant_time_eq::constant_time_eq(&sum[..MEDIA_HMAC_LENGTH], mac) {
        return Err(DownloadError::InvalidMediaHmac);
    }
    Ok(())
}

// go.mau.fi/util/retryafter (MPL-2.0), which download.go uses.

/// Whether a request that got this status should be retried.
fn retry_after_should(status_code: u16, retry_on_rate_limit: bool) -> bool {
    match status_code {
        502..=504 => true,
        429 => retry_on_rate_limit,
        _ => false,
    }
}

/// Parses a `Retry-After` header: an HTTP date or a number of seconds. A
/// date in the past or a negative number is no wait (Go's negative duration
/// makes the timer fire at once).
fn retry_after_parse(retry_after: &str, fallback: Duration) -> Duration {
    if retry_after.is_empty() {
        return fallback;
    }
    if let Ok(date) = NaiveDateTime::parse_from_str(retry_after, "%a, %d %b %Y %H:%M:%S GMT") {
        return (date.and_utc() - Utc::now()).to_std().unwrap_or_default();
    }
    if let Ok(seconds) = retry_after.parse::<i64>() {
        return Duration::from_secs(u64::try_from(seconds).unwrap_or_default());
    }
    fallback
}

impl crate::client::Client {
    /// Downloads and decrypts the attachment of a message part (e.g. its
    /// `image_message`), checking its hashes (`Download`).
    #[tracing::instrument(name = "whatsmeow.download", skip_all, err)]
    pub async fn download(
        &self,
        msg: &(dyn DownloadableMessage + Sync),
    ) -> Result<Vec<u8>, crate::errors::ClientError> {
        if msg.get_direct_path().is_empty() {
            return Err(DownloadError::NoUrlPresent.into());
        }
        let media_conn = self.media_conn_for_transfer().await?;
        Ok(download(&self.media_http(), &media_conn, msg).await?)
    }

    /// Downloads media by direct path and keys (`DownloadMediaWithPath`).
    #[expect(
        clippy::too_many_arguments,
        reason = "mirrors Go's DownloadMediaWithPath"
    )]
    pub async fn download_media_with_path(
        &self,
        direct_path: &str,
        enc_file_hash: Option<&[u8]>,
        file_hash: Option<&[u8]>,
        media_key: Option<&[u8]>,
        media_type: Option<MediaType>,
        mms_type: &str,
        allow_no_hash: bool,
    ) -> Result<Vec<u8>, crate::errors::ClientError> {
        if !direct_path.starts_with('/') {
            return Err(DownloadError::PathWithoutSlash(direct_path.to_owned()).into());
        }
        let media_conn = self.media_conn_for_transfer().await?;
        Ok(download_media_with_path(
            &self.media_http(),
            &media_conn,
            direct_path,
            enc_file_hash,
            file_hash,
            media_key,
            media_type,
            mms_type,
            allow_no_hash,
        )
        .await?)
    }
}

#[cfg(test)]
pub(crate) mod test;
