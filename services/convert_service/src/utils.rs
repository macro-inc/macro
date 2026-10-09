use std::str::FromStr;
use std::time::Duration;

use anyhow::Context;
use model::document::FileType;

/// Cleanup the folder of the job
pub fn cleanup_folder(job_id: &str) -> anyhow::Result<()> {
    if cfg!(feature = "disable_cleanup") {
        tracing::info!("cleanup disabled");
        return Ok(());
    }
    tracing::trace!(job_id=%job_id, "cleaning up job");
    std::fs::remove_dir_all(job_id).context("unable to remove directory")?;
    Ok(())
}

/// LibreOfficeKit filter options for a supported conversion.
///
/// LOK picks the export filter from the target format (`save_as`'s format
/// argument); this returns the options string passed alongside it.
pub fn get_lok_filter_from_file_types(
    from_file_type: &FileType,
    to_file_type: &FileType,
) -> anyhow::Result<String> {
    match (from_file_type, to_file_type) {
        (FileType::Docx, FileType::Pdf) => Ok("writer_pdf_Export".to_string()),
        (FileType::Xlsx, FileType::Html) => Ok("calc_HTML_WebQuery".to_string()),
        (FileType::Pptx, FileType::Pdf) => Ok("impress_pdf_Export".to_string()),
        // Legacy binary Office upgrades. The OOXML export filters
        // ("MS Word 2007 XML", "Calc MS Excel 2007 XML",
        // "Impress MS PowerPoint 2007 XML") need no options.
        (FileType::Doc, FileType::Docx)
        | (FileType::Xls, FileType::Xlsx)
        | (FileType::Ppt, FileType::Pptx) => Ok(String::new()),
        _ => Err(anyhow::anyhow!(
            "unsupported conversion of {from_file_type} to {to_file_type}"
        )),
    }
}

/// How long a conversion may run before its child process is killed.
///
/// Upgrading a legacy deck or workbook re-encodes every embedded image and
/// sheet, so it gets more time than an export.
pub fn conversion_timeout(from_file_type: &FileType, to_file_type: &FileType) -> Duration {
    match (from_file_type, to_file_type) {
        (FileType::Doc, FileType::Docx)
        | (FileType::Xls, FileType::Xlsx)
        | (FileType::Ppt, FileType::Pptx) => Duration::from_secs(120),
        _ => Duration::from_secs(30),
    }
}

/// The file type of a conversion side: the explicit type when the message
/// carries one, else the key's extension.
///
/// Versioned document keys (`{owner}/{document_id}/{version_id}`) have no
/// extension, so jobs reading them name the type explicitly.
pub fn resolve_file_type(explicit: Option<FileType>, key: &str) -> anyhow::Result<FileType> {
    if let Some(file_type) = explicit {
        return Ok(file_type);
    }
    let file_name = key.rsplit('/').next().unwrap_or(key);
    let (_, extension) = file_name
        .rsplit_once('.')
        .context("expected key to contain a file type")?;
    Ok(FileType::from_str(extension)?)
}
