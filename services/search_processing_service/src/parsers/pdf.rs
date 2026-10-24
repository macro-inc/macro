use pdfium_render::prelude::{Pdfium, PdfiumError, PdfiumInternalError};

/// Parses the pdf into individual pages of content, or `None` when pdfium
/// cannot open it: a password-protected, corrupt, or unsupported file fails
/// the same way on every attempt.
pub fn parse_pdf_pages(content: Vec<u8>) -> anyhow::Result<Option<Vec<String>>> {
    tracing::trace!("parsing pdf");

    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(
            "./pdfium-lib/linux",
        ))
        .map_err(|err| {
            tracing::error!(error=?err, "unable to bind to pdfium library");
            err
        })?,
    );
    tracing::trace!("initialized pdfium");

    let document = match pdfium.load_pdf_from_byte_vec(content, None) {
        Ok(document) => document,
        Err(PdfiumError::PdfiumLibraryInternalError(
            error @ (PdfiumInternalError::PasswordError
            | PdfiumInternalError::FormatError
            | PdfiumInternalError::SecurityError),
        )) => {
            tracing::warn!(error = ?error, "pdfium cannot open the pdf");
            return Ok(None);
        }
        Err(error) => return Err(error.into()),
    };

    tracing::trace!("pdf loaded into pdfium");

    let content = document
        .pages()
        .iter()
        .filter_map(|page| {
            if let Ok(page_text) = page.text() {
                Some(page_text.to_string())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    Ok(Some(content))
}

#[cfg(test)]
mod test;
