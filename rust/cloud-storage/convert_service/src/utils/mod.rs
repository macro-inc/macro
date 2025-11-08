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

pub fn get_lok_filter_from_file_types(
    from_file_type: &FileType,
    to_file_type: &FileType,
) -> anyhow::Result<String> {
    match from_file_type {
        FileType::Docx => match to_file_type {
            FileType::Pdf => Ok("writer_pdf_Export".to_string()),
            _ => Err(anyhow::anyhow!(
                "unsupported conversion of {from_file_type} to {to_file_type}"
            )),
        },
        FileType::Xlsx => match to_file_type {
            FileType::Html => Ok("calc_HTML_WebQuery".to_string()),
            _ => Err(anyhow::anyhow!(
                "unsupported conversion of {from_file_type} to {to_file_type}"
            )),
        },
        FileType::Pptx => match to_file_type {
            FileType::Pdf => Ok("impress_pdf_Export".to_string()),
            _ => Err(anyhow::anyhow!(
                "unsupported conversion of {from_file_type} to {to_file_type}"
            )),
        },
        _ => Err(anyhow::anyhow!(
            "unsupported conversion of {from_file_type} for conversion"
        )),
    }
}
