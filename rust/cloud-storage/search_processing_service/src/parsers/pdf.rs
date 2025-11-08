use pdfium_render::prelude::Pdfium;

/// Parses the pdf into individual pages of content
pub fn parse_pdf_pages(content: Vec<u8>) -> anyhow::Result<Vec<String>> {
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

    let document = pdfium.load_pdf_from_byte_vec(content, None)?;

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

    Ok(content)
}
