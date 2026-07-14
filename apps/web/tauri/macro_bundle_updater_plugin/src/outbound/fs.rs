use crate::domain::{
    models::{UnzipError, UnzipRequest},
    ports::FsRepo,
};
use digest::Digest;
use sha2::Sha256;
use std::path::PathBuf;
use zip::{read::root_dir_common_filter, result::ZipError};

/// Real filesystem implementation of [`FsRepo`](crate::domain::ports::FsRepo).
#[derive(Clone)]
pub struct FileSystem;

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
}
