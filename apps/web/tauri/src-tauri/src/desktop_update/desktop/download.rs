//! The native update download, kept in app data so a quit before it finishes
//! resumes on the next launch instead of starting over.
//!
//! Bytes stream into `download.partial` and move to `download.bin` once the
//! response ends. `download.json` names the update they belong to; a
//! different update discards them. Nothing on disk is trusted: the whole file
//! is verified before the update becomes ready and again before it installs.

use base64::Engine;
use reqwest::StatusCode;
use reqwest::header::{ACCEPT, CONTENT_RANGE, HeaderValue, RANGE};
use serde::{Deserialize, Serialize};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tauri_plugin_updater::{Error, Update};
use tokio::io::AsyncWriteExt;

pub(super) const RECORD: &str = "download.json";
pub(super) const PARTIAL: &str = "download.partial";
pub(super) const COMPLETE: &str = "download.bin";

/// The update the saved bytes belong to.
#[derive(Debug, PartialEq, Deserialize, Serialize)]
struct Record {
    version: String,
    signature: String,
}

/// A finished download, verified.
pub struct Downloaded {
    /// The update's size.
    pub bytes: u64,
    /// Bytes an earlier launch or attempt had already saved.
    pub resumed_bytes: u64,
}

/// Where the download is kept, and the updater key that verifies it.
#[derive(Clone)]
pub struct Store {
    directory: PathBuf,
    pubkey: String,
}

impl Store {
    pub fn new(directory: PathBuf, pubkey: String) -> Self {
        Self { directory, pubkey }
    }

    /// Downloads `update` and verifies it, continuing from whatever an earlier
    /// launch or attempt saved for the same update.
    pub async fn download(&self, update: &Update) -> Result<Downloaded, Error> {
        let record = Record {
            version: update.version.clone(),
            signature: update.signature.clone(),
        };
        if self.record().as_ref() != Some(&record) {
            // A newer update supersedes the saved one.
            self.remove()?;
            std::fs::create_dir_all(&self.directory)?;
            std::fs::write(self.directory.join(RECORD), serde_json::to_vec(&record)?)?;
        }

        let resumed_bytes = match tokio::fs::metadata(self.directory.join(COMPLETE)).await {
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == ErrorKind::NotFound => self.fetch(update).await?,
            Err(error) => return Err(error.into()),
        };

        let store = self.clone();
        let signature = update.signature.clone();
        let bytes = tokio::task::spawn_blocking(move || store.read_verified(&signature))
            .await
            .map_err(std::io::Error::other)??;
        Ok(Downloaded {
            bytes: bytes.len().try_into().unwrap_or(u64::MAX),
            resumed_bytes,
        })
    }

    /// Reads the finished download and checks its signature, so only verified
    /// bytes are installed. Saved bytes that fail are removed, and the next
    /// check downloads the update again.
    pub fn read_verified(&self, signature: &str) -> Result<Vec<u8>, Error> {
        let bytes = std::fs::read(self.directory.join(COMPLETE))?;
        if let Err(error) = verify(&bytes, signature, &self.pubkey) {
            self.remove()
                .inspect_err(|error| tracing::warn!(error = ?error.kind(), "could not remove an unverified native update download"))
                .ok();
            return Err(error);
        }
        Ok(bytes)
    }

    /// Deletes the saved download, once it is installed or no longer offered.
    pub fn remove(&self) -> std::io::Result<()> {
        for name in [COMPLETE, PARTIAL, RECORD] {
            remove_file(&self.directory.join(name))?;
        }
        Ok(())
    }

    fn record(&self) -> Option<Record> {
        let bytes = match std::fs::read(self.directory.join(RECORD)) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => return None,
            Err(error) => {
                tracing::warn!(error = ?error.kind(), "could not read the saved native update download");
                return None;
            }
        };
        serde_json::from_slice(&bytes)
            .inspect_err(|error| tracing::warn!(error = %error, "saved native update download record is unreadable"))
            .ok()
    }

    /// Streams the rest of the update into the partial file, asking for only
    /// the bytes it lacks, then marks the file complete. Returns how many
    /// bytes were already saved and kept.
    async fn fetch(&self, update: &Update) -> Result<u64, Error> {
        let partial = self.directory.join(PARTIAL);
        let saved = match tokio::fs::metadata(&partial).await {
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == ErrorKind::NotFound => 0,
            Err(error) => return Err(error.into()),
        };

        let mut headers = update.headers.clone();
        headers
            .entry(ACCEPT)
            .or_insert(HeaderValue::from_static("application/octet-stream"));
        if saved > 0 {
            headers.insert(RANGE, HeaderValue::try_from(format!("bytes={saved}-"))?);
        }
        // The same client settings the updater's own download applies.
        let mut client = reqwest::Client::builder()
            .user_agent(format!("macro-desktop/{}", update.current_version));
        if let Some(timeout) = update.timeout {
            client = client.timeout(timeout);
        }
        if update.no_proxy {
            client = client.no_proxy();
        } else if let Some(proxy) = &update.proxy {
            client = client.proxy(reqwest::Proxy::all(proxy.as_str())?);
        }
        let mut response = client
            .build()?
            .get(update.download_url.clone())
            .headers(headers)
            .send()
            .await?;

        let status = response.status();
        if status == StatusCode::RANGE_NOT_SATISFIABLE && saved > 0 {
            // Nothing follows the saved bytes: the app stopped after the last
            // chunk but before marking the file complete, or the bytes are of
            // another file. Verification tells which, and removes them if so.
            tokio::fs::rename(&partial, self.directory.join(COMPLETE)).await?;
            return Ok(saved);
        }
        if !status.is_success() {
            // The updater's own wording, which telemetry reads the status from.
            return Err(Error::Network(format!(
                "Download request failed with status: {status}"
            )));
        }

        // A server that ignores the range sends the whole file again.
        let resumed = status == StatusCode::PARTIAL_CONTENT;
        if resumed && range_start(&response) != Some(saved) {
            remove_file(&partial)?;
            return Err(Error::Network(
                "Download resumed at a different offset".into(),
            ));
        }
        let mut options = tokio::fs::OpenOptions::new();
        if resumed {
            options.append(true);
        } else {
            options.create(true).write(true).truncate(true);
        }
        let mut file = options.open(&partial).await?;

        // Each chunk is written as it arrives, so a quit keeps what came.
        while let Some(chunk) = response.chunk().await? {
            file.write_all(&chunk).await?;
        }
        file.sync_all().await?;
        drop(file);
        tokio::fs::rename(&partial, self.directory.join(COMPLETE)).await?;
        Ok(if resumed { saved } else { 0 })
    }
}

/// The first byte of a `Content-Range: bytes START-END/TOTAL` response.
fn range_start(response: &reqwest::Response) -> Option<u64> {
    let range = response.headers().get(CONTENT_RANGE)?.to_str().ok()?;
    let (start, _) = range.strip_prefix("bytes ")?.split_once('-')?;
    start.parse().ok()
}

/// The pinned updater's own signature check, which it doesn't export.
fn verify(bytes: &[u8], signature: &str, pubkey: &str) -> Result<(), Error> {
    let public_key = minisign_verify::PublicKey::decode(&decode_base64(pubkey)?)?;
    let signature = minisign_verify::Signature::decode(&decode_base64(signature)?)?;
    public_key.verify(bytes, &signature, true)?;
    Ok(())
}

fn decode_base64(value: &str) -> Result<String, Error> {
    let decoded = base64::engine::general_purpose::STANDARD.decode(value)?;
    String::from_utf8(decoded).map_err(|_| Error::SignatureUtf8(value.into()))
}

fn remove_file(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        result => result,
    }
}
