use crate::domain::{
    asset_service::{BundleAssetPath, BundleAssetReadError},
    completion::BundleFile,
    models::{UnzipError, UnzipRequest},
    ports::{BundleAssetRepo, FsRepo},
};
use digest::Digest;
use sha2::Sha256;
use std::path::PathBuf;
use zip::{read::root_dir_common_filter, result::ZipError};

#[cfg(target_os = "ios")]
use objc2_foundation::{NSNumber, NSString, NSURL, NSURLIsExcludedFromBackupKey};

/// Keep the re-downloadable OTA store out of iCloud backups.
#[cfg(target_os = "ios")]
pub(crate) fn exclude_from_backup(path: &std::path::Path) -> std::io::Result<()> {
    let ns_path = NSString::from_str(&path.to_string_lossy());
    objc2::rc::autoreleasepool(|_| {
        // SAFETY: `ns_path` is alive for the call and produces a retained file URL.
        let url = unsafe { NSURL::fileURLWithPath_isDirectory(&ns_path, true) };
        let excluded = NSNumber::numberWithBool(true);
        // SAFETY: both Objective-C objects remain alive for the resource write.
        unsafe {
            url.setResourceValue_forKey_error(Some(excluded.as_ref()), NSURLIsExcludedFromBackupKey)
        }
    })
    .map_err(|error| {
        std::io::Error::other(format!(
            "failed to exclude {} from backup: {error}",
            path.display()
        ))
    })
}

#[cfg(test)]
mod test;

/// Real filesystem implementation of [`FsRepo`](crate::domain::ports::FsRepo).
#[derive(Clone)]
pub struct FileSystem;

impl BundleAssetRepo for FileSystem {
    async fn read_asset(
        &self,
        root: &std::path::Path,
        path: &BundleAssetPath,
    ) -> Result<Option<Vec<u8>>, BundleAssetReadError> {
        let canonical_root = tokio::fs::canonicalize(root).await?;
        let canonical_file = match tokio::fs::canonicalize(root.join(path.as_path())).await {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if !canonical_file.starts_with(&canonical_root) {
            return Err(BundleAssetReadError::OutsideBundleRoot);
        }
        Ok(Some(tokio::fs::read(canonical_file).await?))
    }
}

fn map_zip_err(err: ZipError) -> UnzipError {
    match err {
        ZipError::Io(error) => UnzipError::IoErr(error),
        x => UnzipError::Other {
            report: rootcause::Report::from(x),
        },
    }
}

impl FsRepo for FileSystem {
    async fn verify_checksum<P: AsRef<std::path::Path> + Send>(
        &self,
        path: P,
        expected: &str,
    ) -> Result<(), UnzipError> {
        let path = path.as_ref().to_path_buf();
        let expected = expected.to_owned();
        let mut file = tokio::fs::File::open(&path).await?.into_std().await;
        tokio::task::spawn_blocking(move || {
            let mut hasher = Sha256::new();
            std::io::copy(&mut file, &mut hasher)?;
            let actual = format!("{:x}", hasher.finalize());
            if actual != expected {
                return Err(UnzipError::ChecksumMismatch { expected, actual });
            }
            Ok(())
        })
        .await
        .map_err(rootcause::Report::from)?
    }

    async fn unzip(
        &self,
        request: UnzipRequest,
    ) -> Result<std::path::PathBuf, crate::domain::models::UnzipError> {
        let UnzipRequest {
            archive_path,
            archive_target,
            on_progress,
        } = request;

        let target = archive_target.clone();
        tokio::task::spawn_blocking(move || -> Result<PathBuf, UnzipError> {
            let file = std::fs::File::open(archive_path)?;

            let mut archive = zip::ZipArchive::new(file).map_err(map_zip_err)?;

            let () = archive
                .extract_unwrapped_root_dir(&archive_target, root_dir_common_filter)
                .map_err(map_zip_err)?;

            Ok(archive_target)
        })
        .await
        .map_err(rootcause::Report::from)??;

        let _ = on_progress
            .send(crate::domain::models::ProgressPercentage::complete())
            .await;

        Ok(target)
    }

    fn create_dir_all<P: AsRef<std::path::Path> + Send>(
        &self,
        path: P,
    ) -> impl Future<Output = Result<(), std::io::Error>> + Send {
        tokio::fs::create_dir_all(path)
    }

    async fn list_dir_names(&self, dir: &std::path::Path) -> Vec<String> {
        let mut names = Vec::new();
        let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
            return names;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Ok(name) = entry.file_name().into_string() {
                names.push(name);
            }
        }
        names
    }

    async fn remove_dir_all(&self, dir: &std::path::Path) -> Result<(), std::io::Error> {
        tokio::fs::remove_dir_all(dir).await
    }

    async fn read_to_string(&self, path: &std::path::Path) -> Result<String, std::io::Error> {
        tokio::fs::read_to_string(path).await
    }

    async fn write(&self, path: &std::path::Path, contents: &[u8]) -> Result<(), std::io::Error> {
        tokio::fs::write(path, contents).await
    }

    async fn remove_file(&self, path: &std::path::Path) -> Result<(), std::io::Error> {
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }

    async fn list_files(&self, dir: &std::path::Path) -> Result<Vec<BundleFile>, std::io::Error> {
        let dir = dir.to_path_buf();
        tokio::task::spawn_blocking(move || {
            let mut files = Vec::new();
            let mut pending = vec![dir.clone()];
            while let Some(current) = pending.pop() {
                for entry in std::fs::read_dir(&current)? {
                    let entry = entry?;
                    let file_type = entry.file_type()?;
                    if file_type.is_dir() {
                        pending.push(entry.path());
                    } else if file_type.is_file() {
                        let path = entry.path();
                        let relative = path.strip_prefix(&dir).map_err(std::io::Error::other)?;
                        files.push(BundleFile {
                            path: relative.to_path_buf(),
                            size: entry.metadata()?.len(),
                        });
                    }
                }
            }
            Ok(files)
        })
        .await
        .map_err(std::io::Error::other)?
    }

    async fn file_sizes(
        &self,
        root: &std::path::Path,
        paths: Vec<PathBuf>,
    ) -> Vec<Result<u64, std::io::ErrorKind>> {
        let root = root.to_path_buf();
        // One blocking task for the whole list: a bundle holds about a
        // thousand files, and a task per file would multiply the overhead.
        let count = paths.len();
        tokio::task::spawn_blocking(move || {
            paths
                .iter()
                .map(|path| {
                    std::fs::metadata(root.join(path))
                        .map(|metadata| metadata.len())
                        .map_err(|error| error.kind())
                })
                .collect()
        })
        .await
        .unwrap_or_else(|_| vec![Err(std::io::ErrorKind::Other); count])
    }
}
