use std::path::PathBuf;

use zip::{read::root_dir_common_filter, result::ZipError};

use crate::domain::{
    models::{UnzipError, UnzipRequest},
    ports::FsRepo,
};

struct FileSystem;

fn map_zip_err(err: ZipError) -> UnzipError {
    match err {
        ZipError::Io(error) => UnzipError::IoErr(error),
        x => UnzipError::Other { report: rootcause::Report::from(x) },
    }
}

impl FsRepo for FileSystem {
    async fn unzip(
        &self,
        request: UnzipRequest,
    ) -> Result<std::path::PathBuf, crate::domain::models::UnzipError> {
        Ok(
            tokio::task::spawn_blocking(move || -> Result<PathBuf, UnzipError> {
                let UnzipRequest {
                    archive_path,
                    archive_target,
                    ..
                } = request;

                let file = std::fs::File::open(archive_path)?;

                let mut archive = zip::ZipArchive::new(file).map_err(map_zip_err)?;

                let () = archive
                    .extract_unwrapped_root_dir(&archive_target, root_dir_common_filter)
                    .map_err(map_zip_err)?;

                Ok(archive_target)
            })
            .await
            .map_err(rootcause::Report::from)??,
        )
    }

    fn create_dir_all<P: AsRef<std::path::Path> + Send>(
        &self,
        path: P,
    ) -> impl Future<Output = Result<(), std::io::Error>> + Send {
        tokio::fs::create_dir_all(path)
    }
}
