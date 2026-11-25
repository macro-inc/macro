//! Staging guest images: download each file (zstd-compressed), decompress
//! it sparsely while hashing it, check it against the request, and only
//! then rename the whole image into `images_dir/<image>`. The digests are
//! kept beside it in `<image>.sha256.json`, so a repeated request for an
//! installed image is checked without hashing 16 GiB again. An image put in
//! place by hand has no digests file; the first request for it hashes it.
//!
//! An image version is immutable: one in place with other contents is
//! reported as a conflict and left alone.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use firecracker_host_api::{
    GuestImage, ImageFileDigest, ImageFileName, ImageFileSource, ImageState, Sha256Digest,
    StageImage, StagedImage,
};
use futures::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio_util::task::TaskTracker;
use tracing::Instrument;

use crate::outbound::layout::Layout;

#[cfg(test)]
mod test;

/// Where downloads land before an image is complete: a name no image can
/// have (`+` is not allowed in one), on the images' own filesystem so the
/// finished image is renamed into place.
const STAGING: &str = "+staging";

/// Every file of an image, in the order they are fetched.
const FILES: [ImageFileName; 3] = [
    ImageFileName::BootArgs,
    ImageFileName::Vmlinux,
    ImageFileName::RootfsExt4,
];

/// Bytes decompressed and hashed at a time; a block of zeros is a hole.
const BLOCK: usize = 1 << 20;

/// Why staging failed.
#[derive(Debug, thiserror::Error)]
pub enum StagingError {
    /// A file operation.
    #[error("{action} {path}: {source}")]
    Io {
        /// What.
        action: &'static str,
        /// Where.
        path: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// The download failed. The URL is not part of the message: it may be
    /// a presigned credential.
    #[error("downloading {name}: {source}")]
    Download {
        /// Which file.
        name: ImageFileName,
        /// Why.
        #[source]
        source: reqwest::Error,
    },
    /// The download is larger than its file could compress to.
    #[error("{name}: the download is larger than {limit} bytes")]
    TooLarge {
        /// Which file.
        name: ImageFileName,
        /// The most it could be.
        limit: u64,
    },
    /// The decompressed file is not what the request said.
    #[error(
        "{name}: expected {expected_bytes} bytes with SHA-256 {expected}, got {bytes} bytes with {actual}"
    )]
    Mismatch {
        /// Which file.
        name: ImageFileName,
        /// What the request said.
        expected: Sha256Digest,
        /// Its size.
        expected_bytes: u64,
        /// What arrived.
        actual: Sha256Digest,
        /// Its size.
        bytes: u64,
    },
    /// The request does not name each file exactly once.
    #[error("the request must name vmlinux, rootfs.ext4 and boot_args once each")]
    Files,
}

fn io(action: &'static str, path: &Path) -> impl FnOnce(std::io::Error) -> StagingError {
    let path = path.to_owned();
    move |source| StagingError::Io {
        action,
        path,
        source,
    }
}

/// Images being staged or checked since the agent started.
#[derive(Debug, Clone)]
pub struct ImageStaging {
    layout: Layout,
    http: reqwest::Client,
    states: Arc<Mutex<HashMap<GuestImage, ImageState>>>,
    tasks: TaskTracker,
}

impl ImageStaging {
    /// Staging into `layout`'s images directory with `http`; work runs in
    /// `tasks`. Drops downloads a dead agent left behind.
    pub fn new(layout: Layout, http: reqwest::Client, tasks: TaskTracker) -> Self {
        let leftovers = layout.images().join(STAGING);
        if let Err(error) = std::fs::remove_dir_all(&leftovers)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(error = %error, path = %leftovers.display(), "could not remove leftover image downloads");
        }
        Self {
            layout,
            http,
            states: Arc::default(),
            tasks,
        }
    }

    fn states(&self) -> std::sync::MutexGuard<'_, HashMap<GuestImage, ImageState>> {
        self.states.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Start staging `request` unless it is staging now; answers where it
    /// stands.
    pub fn stage(&self, request: StageImage) -> StagedImage {
        let image = request.image.clone();
        {
            let mut states = self.states();
            match states.get(&image) {
                Some(ImageState::Staging) => {
                    return StagedImage {
                        image,
                        state: ImageState::Staging,
                    };
                }
                Some(ImageState::Ready { files: Some(files) })
                    if holds_request(files, &request) =>
                {
                    return StagedImage {
                        image,
                        state: ImageState::Ready {
                            files: Some(files.clone()),
                        },
                    };
                }
                _ => {}
            }
            states.insert(image.clone(), ImageState::Staging);
        }
        let this = self.clone();
        let span = tracing::info_span!("firecracker_host.image_stage", image = %image);
        self.tasks.spawn(
            async move {
                let state = this.stage_now(&request).await;
                if let ImageState::Failed { reason } = &state {
                    tracing::error!(image = %request.image, reason, "staging an image failed");
                }
                this.states().insert(request.image, state);
            }
            .instrument(span),
        );
        StagedImage {
            image,
            state: ImageState::Staging,
        }
    }

    /// Every image in place, and every one staging or failed.
    pub fn list(&self) -> Vec<StagedImage> {
        let mut images: HashMap<GuestImage, ImageState> = HashMap::new();
        for image in installed(&self.layout.images()) {
            let files = read_digests(&self.digests_path(&image));
            images.insert(image, ImageState::Ready { files });
        }
        for (image, state) in self.states().iter() {
            images.insert(image.clone(), state.clone());
        }
        let mut images: Vec<StagedImage> = images
            .into_iter()
            .map(|(image, state)| StagedImage { image, state })
            .collect();
        images.sort_by(|left, right| left.image.cmp(&right.image));
        images
    }

    fn digests_path(&self, image: &GuestImage) -> PathBuf {
        self.layout
            .images()
            .join(format!("{}.sha256.json", image.as_str()))
    }

    async fn stage_now(&self, request: &StageImage) -> ImageState {
        let target = self.layout.image(&request.image);
        let result = if target.join(ImageFileName::RootfsExt4.to_string()).is_file() {
            self.check_installed(request, &target).await
        } else {
            self.download(request, &target).await
        };
        result.unwrap_or_else(|error| ImageState::Failed {
            reason: error.to_string(),
        })
    }

    /// Compare an installed image with the request, hashing it once.
    async fn check_installed(
        &self,
        request: &StageImage,
        target: &Path,
    ) -> Result<ImageState, StagingError> {
        let digests_path = self.digests_path(&request.image);
        let files = match read_digests(&digests_path) {
            Some(files) => files,
            None => {
                let target = target.to_owned();
                let files = tokio::task::spawn_blocking(move || hash_installed(&target))
                    .await
                    .map_err(|error| StagingError::Io {
                        action: "hash",
                        path: PathBuf::new(),
                        source: std::io::Error::other(error),
                    })??;
                write_digests(&digests_path, &files)?;
                files
            }
        };
        Ok(if holds_request(&files, request) {
            ImageState::Ready { files: Some(files) }
        } else {
            ImageState::Conflict { files }
        })
    }

    /// Download every file into a fresh staging directory, check each, then
    /// rename the directory into place.
    async fn download(
        &self,
        request: &StageImage,
        target: &Path,
    ) -> Result<ImageState, StagingError> {
        let staging = self
            .layout
            .images()
            .join(STAGING)
            .join(uuid::Uuid::now_v7().simple().to_string());
        std::fs::create_dir_all(&staging).map_err(io("create", &staging))?;
        let result = self.download_into(request, &staging, target).await;
        if result.is_err() {
            // Up to 16 GiB of files: off the async workers.
            let _ = tokio::task::spawn_blocking(move || std::fs::remove_dir_all(staging)).await;
        }
        result
    }

    async fn download_into(
        &self,
        request: &StageImage,
        staging: &Path,
        target: &Path,
    ) -> Result<ImageState, StagingError> {
        let mut files = Vec::new();
        for name in FILES {
            let source = request
                .files
                .iter()
                .find(|file| file.name == name)
                .ok_or(StagingError::Files)?;
            let compressed = staging.join(format!("{name}.zst"));
            self.fetch(source, &compressed)
                .instrument(tracing::info_span!("firecracker_host.image_download", file = %name))
                .await?;
            let output = staging.join(name.to_string());
            let expected = source.clone();
            let digest = tokio::task::spawn_blocking(move || {
                let digest = decompress(&compressed, &output, expected.bytes)?;
                std::fs::remove_file(&compressed).map_err(io("remove", &compressed))?;
                Ok::<_, StagingError>(digest)
            })
            .instrument(tracing::info_span!("firecracker_host.image_decompress", file = %name))
            .await
            .map_err(|error| StagingError::Io {
                action: "decompress",
                path: staging.to_owned(),
                source: std::io::Error::other(error),
            })??;
            if digest.sha256 != source.sha256 || digest.bytes != source.bytes {
                return Err(StagingError::Mismatch {
                    name,
                    expected: source.sha256.clone(),
                    expected_bytes: source.bytes,
                    actual: digest.sha256,
                    bytes: digest.bytes,
                });
            }
            files.push(ImageFileDigest {
                name,
                sha256: digest.sha256,
                bytes: digest.bytes,
            });
        }
        for file in &files {
            let path = staging.join(file.name.to_string());
            read_only(&path)?;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(io("create", parent))?;
        }
        // Never over an image someone put there meanwhile: rename refuses a
        // non-empty target directory.
        std::fs::rename(staging, target).map_err(io("install", target))?;
        // Only once the checked files are in place: a digests file never
        // vouches for files it did not check. Without one (a crash here),
        // the next request hashes the image.
        write_digests(&self.digests_path(&request.image), &files)?;
        tracing::info!(image = %request.image, "image staged");
        Ok(ImageState::Ready { files: Some(files) })
    }

    async fn fetch(&self, source: &ImageFileSource, path: &Path) -> Result<(), StagingError> {
        let download = |error| StagingError::Download {
            name: source.name,
            source: error,
        };
        let response = self
            .http
            .get(&source.url.0)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(download)?;
        // zstd never grows data by more than a small fraction.
        let limit = source.bytes + source.bytes / 64 + (1 << 20);
        let mut file = tokio::fs::File::create(path)
            .await
            .map_err(io("create", path))?;
        let mut written: u64 = 0;
        let mut body = response.bytes_stream();
        while let Some(chunk) = body.next().await {
            let chunk = chunk.map_err(download)?;
            written += chunk.len() as u64;
            if written > limit {
                return Err(StagingError::TooLarge {
                    name: source.name,
                    limit,
                });
            }
            file.write_all(&chunk).await.map_err(io("write", path))?;
        }
        file.sync_all().await.map_err(io("sync", path))
    }
}

/// A file's size and SHA-256.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileDigest {
    /// SHA-256 of its contents.
    pub sha256: Sha256Digest,
    /// Its size.
    pub bytes: u64,
}

fn finish(hasher: Sha256, bytes: u64) -> FileDigest {
    FileDigest {
        sha256: Sha256Digest::from_bytes(hasher.finalize().into()),
        bytes,
    }
}

/// Decompress the zstd file `compressed` into `output`, leaving holes for
/// blocks of zeros, and hash what it holds. Stops past `limit` bytes.
pub fn decompress(
    compressed: &Path,
    output: &Path,
    limit: u64,
) -> Result<FileDigest, StagingError> {
    let input = std::fs::File::open(compressed).map_err(io("open", compressed))?;
    let mut decoder = zstd::Decoder::new(input).map_err(io("decompress", compressed))?;
    let mut file = std::fs::File::create(output).map_err(io("create", output))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; BLOCK];
    let mut bytes: u64 = 0;
    loop {
        let read = read_block(&mut decoder, &mut buffer).map_err(io("decompress", compressed))?;
        if read == 0 {
            break;
        }
        let block = &buffer[..read];
        hasher.update(block);
        bytes += read as u64;
        if bytes > limit {
            // The size check reports it; no need to fill the disk first.
            break;
        }
        if block.iter().all(|&byte| byte == 0) {
            file.seek(SeekFrom::Current(read as i64))
                .map_err(io("seek", output))?;
        } else {
            file.write_all(block).map_err(io("write", output))?;
        }
    }
    // A trailing hole is a seek past the end: the length makes it real.
    file.set_len(bytes).map_err(io("truncate", output))?;
    file.sync_all().map_err(io("sync", output))?;
    Ok(finish(hasher, bytes))
}

/// Fill `buffer` unless the stream ends first; how much was read.
fn read_block(reader: &mut impl Read, buffer: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..])? {
            0 => break,
            read => filled += read,
        }
    }
    Ok(filled)
}

/// The SHA-256 of each file of an installed image.
fn hash_installed(directory: &Path) -> Result<Vec<ImageFileDigest>, StagingError> {
    FILES
        .iter()
        .map(|&name| {
            let path = directory.join(name.to_string());
            let mut file = std::fs::File::open(&path).map_err(io("open", &path))?;
            let mut hasher = Sha256::new();
            let mut buffer = vec![0; BLOCK];
            let mut bytes: u64 = 0;
            loop {
                let read = read_block(&mut file, &mut buffer).map_err(io("read", &path))?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
                bytes += read as u64;
            }
            let digest = finish(hasher, bytes);
            Ok(ImageFileDigest {
                name,
                sha256: digest.sha256,
                bytes: digest.bytes,
            })
        })
        .collect()
}

/// Whether `files` are exactly what `request` asks for.
fn holds_request(files: &[ImageFileDigest], request: &StageImage) -> bool {
    files.len() == request.files.len()
        && request.files.iter().all(|wanted| {
            files.iter().any(|file| {
                file.name == wanted.name
                    && file.sha256 == wanted.sha256
                    && file.bytes == wanted.bytes
            })
        })
}

fn read_digests(path: &Path) -> Option<Vec<ImageFileDigest>> {
    let text = std::fs::read(path).ok()?;
    serde_json::from_slice(&text).ok()
}

fn write_digests(path: &Path, files: &[ImageFileDigest]) -> Result<(), StagingError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io("create", parent))?;
    }
    let staged = path.with_extension("json.new");
    let text = serde_json::to_vec_pretty(files).map_err(|error| StagingError::Io {
        action: "encode",
        path: path.to_owned(),
        source: std::io::Error::other(error),
    })?;
    std::fs::write(&staged, text).map_err(io("write", &staged))?;
    std::fs::rename(&staged, path).map_err(io("replace", path))
}

fn read_only(path: &Path) -> Result<(), StagingError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o444))
        .map_err(io("chmod", path))
}

/// Images in place under `directory`: every directory holding all three
/// files whose path is an image name.
fn installed(directory: &Path) -> Vec<GuestImage> {
    let mut found = Vec::new();
    let mut pending = vec![(directory.to_owned(), String::new())];
    while let Some((path, name)) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&path) else {
            continue;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            if !child.is_dir() {
                continue;
            }
            let child_name = entry.file_name().to_string_lossy().into_owned();
            let image = if name.is_empty() {
                child_name
            } else {
                format!("{name}/{child_name}")
            };
            if FILES
                .iter()
                .all(|file| child.join(file.to_string()).is_file())
                && let Ok(image) = GuestImage::try_new(&image)
                && crate::domain::service::image_name_is_safe(image.as_str())
            {
                found.push(image);
                continue;
            }
            pending.push((child, image));
        }
    }
    found
}
