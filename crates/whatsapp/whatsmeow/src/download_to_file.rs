// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow download-to-file.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Like `download.rs`, the `Client` methods are free functions taking the
// media HTTP client and a refreshed media connection. File I/O is blocking,
// as in Go. Go preallocates `*os.File` outputs with `fallocate`; the port
// doesn't.

//! Downloading and decrypting attachments into a file.

use std::io::{self, Read, SeekFrom};

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::download::{
    DownloadError, DownloadableMessage, MEDIA_HMAC_LENGTH, MediaHttpClient, MediaType,
    do_media_download_request, get_media_keys, get_media_type, retry_duration,
    should_retry_media_download,
};
use crate::mediaconn::MediaConn;
use crate::proto::wa_media_transport::wa_media_transport::Integral;
use crate::util::cbcutil;

/// A file that can be downloaded into: Go's `File` interface (`io.Reader`,
/// `io.Writer`, `io.Seeker`, `io.ReaderAt`, `io.WriterAt`, `Truncate`,
/// `Stat`), expressed with seeking.
pub use crate::util::cbcutil::File;

fn io_error(context: &'static str) -> impl FnOnce(io::Error) -> DownloadError {
    move |source| DownloadError::Io { context, source }
}

/// Downloads the attachment from the given protobuf message into `file`.
///
/// This is otherwise identical to [`crate::download::download`].
pub async fn download_to_file<F: File>(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    msg: &(dyn DownloadableMessage + Sync),
    file: &mut F,
) -> Result<(), DownloadError> {
    let media_type = get_media_type(msg);
    if msg.get_direct_path().is_empty() {
        return Err(DownloadError::NoUrlPresent);
    }
    let enc_sha256 = msg.get_file_enc_sha256();
    let mut media_key = msg.get_media_key();
    // TODO more proper check for unencrypted media? (also Download) (from Go)
    if enc_sha256.is_none() && media_key.is_some() {
        media_key = None;
    }
    download_media_with_path_to_file(
        http,
        media_conn,
        msg.get_direct_path(),
        enc_sha256,
        msg.get_file_sha256(),
        media_key,
        Some(media_type),
        media_type.mms_type(),
        false,
        file,
    )
    .await
}

/// Downloads the attachment of a Messenger media transport into `file`.
pub async fn download_fb_to_file<F: File>(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    transport: &Integral,
    media_type: MediaType,
    file: &mut F,
) -> Result<(), DownloadError> {
    download_media_with_path_to_file(
        http,
        media_conn,
        transport.direct_path.as_deref().unwrap_or_default(),
        transport.file_enc_sha256.as_deref(),
        transport.file_sha256.as_deref(),
        transport.media_key.as_deref(),
        Some(media_type),
        media_type.mms_type(),
        false,
        file,
    )
    .await
}

/// Downloads unencrypted media by its path alone into `file`, without
/// checking a hash.
pub async fn download_media_with_only_path_to_file<F: File>(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    direct_path: &str,
    file: &mut F,
) -> Result<(), DownloadError> {
    download_media_with_path_to_file(
        http,
        media_conn,
        direct_path,
        None,
        None,
        None,
        None,
        "",
        true,
        file,
    )
    .await
}

/// Like [`crate::download::download_media_with_path`], but writes into
/// `file`. Each host's download is written from the file's current position,
/// as Go does: a host that fails after writing leaves its bytes in front of
/// the next host's.
#[expect(
    clippy::too_many_arguments,
    reason = "mirrors Go's DownloadMediaWithPathToFile"
)]
pub async fn download_media_with_path_to_file<F: File>(
    http: &MediaHttpClient,
    media_conn: &MediaConn,
    direct_path: &str,
    enc_file_hash: Option<&[u8]>,
    file_hash: Option<&[u8]>,
    media_key: Option<&[u8]>,
    media_type: Option<MediaType>,
    mms_type: &str,
    allow_no_hash: bool,
    file: &mut F,
) -> Result<(), DownloadError> {
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
    for (index, host) in media_conn.hosts.iter().enumerate() {
        let media_url =
            http.media_download_url(&host.hostname, direct_path, enc_file_hash, mms_type);
        match download_and_decrypt_to_file(
            http,
            &media_url,
            media_key,
            media_type,
            enc_file_hash,
            file_hash,
            file,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(error) if error.stops_host_loop() => return Err(error),
            Err(error) if index >= media_conn.hosts.len() - 1 => {
                return Err(DownloadError::LastHost(Box::new(error)));
            }
            Err(error) => {
                tracing::warn!(%error, "failed to download media, trying with next host");
            }
        }
    }
    Ok(())
}

async fn download_and_decrypt_to_file<F: File>(
    http: &MediaHttpClient,
    url: &str,
    media_key: Option<&[u8]>,
    app_info: Option<MediaType>,
    file_enc_sha256: Option<&[u8]>,
    file_sha256: Option<&[u8]>,
    file: &mut F,
) -> Result<(), DownloadError> {
    let keys = get_media_keys(media_key.unwrap_or_default(), app_info);
    let mac =
        download_possibly_encrypted_media_with_retries_to_file(http, url, file_enc_sha256, file)
            .await?;
    if media_key.is_none() && file_enc_sha256.is_none() && mac.is_none() {
        // Unencrypted media, just check the hash and return
        let Some(file_sha256) = file_sha256 else {
            return Ok(());
        };
        file.seek(SeekFrom::Start(0))
            .map_err(io_error("failed to seek to start of file"))?;
        let hash = hash_file(file).map_err(io_error("failed to hash file"))?;
        if !constant_time_eq::constant_time_eq(file_sha256, &hash) {
            return Err(DownloadError::InvalidUnencryptedMediaSha256);
        }
        return Ok(());
    }
    validate_media_file(
        file,
        &keys.iv,
        &keys.mac_key,
        mac.as_deref().unwrap_or_default(),
    )?;
    file.seek(SeekFrom::Start(0)).map_err(io_error(
        "failed to seek to start of file after validating mac",
    ))?;
    cbcutil::decrypt_file(&keys.cipher_key, &keys.iv, file).map_err(DownloadError::Decrypt)?;
    file.seek(SeekFrom::Start(0))
        .map_err(io_error("failed to seek to start of file after decrypting"))?;
    let hash = hash_file(file).map_err(io_error("failed to hash file"))?;
    if !constant_time_eq::constant_time_eq(file_sha256.unwrap_or_default(), &hash) {
        return Err(DownloadError::InvalidMediaSha256);
    }
    Ok(())
}

async fn download_possibly_encrypted_media_with_retries_to_file<F: File>(
    http: &MediaHttpClient,
    url: &str,
    checksum: Option<&[u8]>,
    file: &mut F,
) -> Result<Option<Vec<u8>>, DownloadError> {
    let mut retry_num = 0;
    loop {
        let result = match checksum {
            None => download_media_to_file(http, url, file).await.map(|_| None),
            Some(checksum) => download_encrypted_media_to_file(http, url, checksum, file)
                .await
                .map(Some),
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
        file.seek(SeekFrom::Start(0)).map_err(io_error(
            "failed to seek to start of file to retry download",
        ))?;
        tokio::time::sleep(retry_duration).await;
        retry_num += 1;
        if retry_num == 5 {
            return Err(error);
        }
    }
}

/// Streams the download into `file` from its current position, returning the
/// byte count and SHA-256.
async fn download_media_to_file<F: File>(
    http: &MediaHttpClient,
    url: &str,
    file: &mut F,
) -> Result<(u64, [u8; 32]), DownloadError> {
    let mut response = do_media_download_request(http, url).await?;
    let mut hasher = Sha256::new();
    let mut size = 0;
    while let Some(chunk) = response.chunk().await.map_err(DownloadError::Transport)? {
        file.write_all(&chunk)
            .map_err(io_error("failed to write file"))?;
        hasher.update(&chunk);
        size += chunk.len() as u64;
    }
    Ok((size, hasher.finalize().into()))
}

async fn download_encrypted_media_to_file<F: File>(
    http: &MediaHttpClient,
    url: &str,
    checksum: &[u8],
    file: &mut F,
) -> Result<Vec<u8>, DownloadError> {
    if checksum.len() != 32 {
        return Err(DownloadError::InvalidChecksumLength(checksum.len()));
    }
    let (size, hash) = download_media_to_file(http, url, file).await?;
    if size <= MEDIA_HMAC_LENGTH as u64 {
        return Err(DownloadError::TooShortFile);
    }
    if !constant_time_eq::constant_time_eq(checksum, &hash) {
        return Err(DownloadError::InvalidMediaEncSha256);
    }
    // Go's ReadAt: an absolute offset, wherever this download started.
    let mut mac = vec![0; MEDIA_HMAC_LENGTH];
    let mac_offset = size - MEDIA_HMAC_LENGTH as u64;
    file.seek(SeekFrom::Start(mac_offset))
        .and_then(|_| file.read_exact(&mut mac))
        .map_err(io_error("failed to read MAC from file"))?;
    file.truncate(mac_offset)
        .map_err(io_error("failed to truncate file to remove MAC"))?;
    Ok(mac)
}

/// Like [`crate::download::validate_media`], reading the ciphertext from
/// the start of `file`.
pub fn validate_media_file(
    file: &mut impl File,
    iv: &[u8],
    mac_key: &[u8],
    mac: &[u8],
) -> Result<(), DownloadError> {
    let mut hmac = <Hmac<Sha256> as Mac>::new_from_slice(mac_key)
        .expect("HMAC-SHA256 accepts keys of any length");
    hmac.update(iv);
    file.seek(SeekFrom::Start(0))
        .map_err(io_error("failed to seek to start of file"))?;
    read_chunks(file, |chunk| hmac.update(chunk)).map_err(io_error("failed to hash file"))?;
    let sum = hmac.finalize().into_bytes();
    if !constant_time_eq::constant_time_eq(&sum[..MEDIA_HMAC_LENGTH], mac) {
        return Err(DownloadError::InvalidMediaHmac);
    }
    Ok(())
}

fn hash_file(file: &mut impl Read) -> io::Result<[u8; 32]> {
    let mut hasher = Sha256::new();
    read_chunks(file, |chunk| hasher.update(chunk))?;
    Ok(hasher.finalize().into())
}

/// Go's `io.Copy` into a hash: feeds everything left in `reader` to `sink`.
fn read_chunks(reader: &mut impl Read, mut sink: impl FnMut(&[u8])) -> io::Result<()> {
    let mut buffer = vec![0; 32 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(read) => sink(&buffer[..read]),
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
}
