use crate::domain::{
    models::{UnzipError, UnzipRequest},
    ports::FsRepo,
};
use digest::Digest;
use sha2::Sha256;
use std::path::PathBuf;
use zip::{read::root_dir_common_filter, result::ZipError};

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
}
