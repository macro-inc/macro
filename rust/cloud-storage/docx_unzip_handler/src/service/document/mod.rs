mod bom_parts;
mod notify_docx_upload_job;
mod process_document;
mod unzip;

pub use bom_parts::*;
pub use notify_docx_upload_job::*;
pub use process_document::*;
pub use unzip::*;

#[cfg(test)]
/// Used in testing to load a file into bytes
pub(in crate::service::document) fn load_file_into_vec(filename: &str) -> std::io::Result<Vec<u8>> {
    std::fs::read(filename)
}
