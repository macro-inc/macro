//! ZIP extraction into a confined upload directory.

use lambda_runtime::{Error, tracing};
use std::{
    fs,
    path::{Path, PathBuf},
};
use zip::read::root_dir_common_filter;

// returns the root folder name
pub(crate) fn extract_zip_file(
    zip_path: &Path,
    extract_dir: &Path,
    zip_name: Option<&str>,
) -> Result<String, Error> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    let extract_to: PathBuf;
    let root_dir_name = match archive
        .root_dir(root_dir_common_filter)?
        .and_then(|root| root.file_name().map(|f| f.to_string_lossy().to_string()))
    {
        Some(root_dir_name) => {
            extract_to = extract_dir.join(&root_dir_name);
            root_dir_name
        }
        None => {
            tracing::error!("No root directory found, using provided root folder name");
            let extract_folder = match zip_name {
                Some(zip_name) => zip_name.to_string(),
                None => {
                    let default_extract_folder = "Folder Upload".to_string();
                    tracing::error!(
                        "No zip name provided, using default extract folder {}",
                        default_extract_folder
                    );
                    default_extract_folder
                }
            };
            extract_to = extract_dir.join(&extract_folder);
            extract_folder
        }
    };
    fs::create_dir_all(&extract_to)?;

    tracing::debug!("Extracting to: {:?}", extract_to);
    archive.extract_unwrapped_root_dir(&extract_to, root_dir_common_filter)?;

    Ok(root_dir_name)
}

#[cfg(test)]
mod test;
