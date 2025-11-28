/// extract text from a pdf
/// insert references
/// store rectangles and text
use pdfium_render::prelude::{PdfDocument, PdfRect, PdfiumError, PdfiumInternalError};
use std::{rc::Rc, sync::Arc};
use uuid::Uuid;

use crate::{
    model::key::DocumentKeyParts,
    service::{self},
};

use anyhow::{Context, Result};
use lambda_runtime::{
    Error,
    tracing::{self},
};

use model::citations::{DocumentReference, TextReference, UserPdfRect};
const DELIMETER: char = '\n';
const NPARTS_PER_ID: i32 = 4;
struct TextPart {
    pub ph: f32,
    pub pw: f32,
    pub id: String,
    pub text: String,
    pub bounds: PdfRect,
    pub page_index: u32,
}

// transform from page to user space
pub fn get_user_pdf_rect(rect: &PdfRect, page_index: u32, ph: f32, pw: f32) -> UserPdfRect {
    let width = (rect.right().value - rect.left().value) * 100.0 / pw;
    let height = (rect.top().value - rect.bottom().value) * 100.0 / ph;
    let left = rect.left().value * 100.0 / pw;
    let top = (ph - rect.top().value) * 100.0 / ph;
    let page_index = page_index + 1;
    UserPdfRect {
        page_index,
        left,
        top,
        width,
        height,
    }
}

fn unzip_text_parts(parts: Vec<TextPart>) -> (Vec<TextReference>, String) {
    let text_with_refs = parts.iter().fold(String::new(), |text, part| {
        format!("{}{}[[{}]]{}", text, part.text, part.id, DELIMETER)
    });
    let ids = parts
        .into_iter()
        .map(|part| TextReference {
            reference: DocumentReference::Pdf(get_user_pdf_rect(
                &part.bounds,
                part.page_index,
                part.ph,
                part.pw,
            )),
            id: part.id,
        })
        .collect();
    (ids, text_with_refs)
}

// simple single rect is used for citations
// expand the rectangle to encompass an entire sentence
fn expand_bounds(a: Option<PdfRect>, b: Result<PdfRect, PdfiumError>) -> Option<PdfRect> {
    match (a, b) {
        (Some(a), Ok(b)) => {
            if b.left().value < a.left().value {
                a.left().value = b.left().value;
            }
            if b.right().value > a.right().value {
                a.right().value = b.right().value;
            }
            if b.top().value > a.top().value {
                a.top().value = b.top().value;
            }
            if b.bottom().value < a.bottom().value {
                a.bottom().value = b.bottom().value
            }
            Some(a)
        }
        (None, Ok(b)) => Some(b),
        _ => a,
    }
}

pub fn ref_id_extract_text(document: &PdfDocument) -> (Vec<TextReference>, String) {
    let mut sentences: Vec<TextPart> = Vec::new();
    for (page_index, page) in document.pages().iter().enumerate() {
        let (ph, pw) = (page.height().value, page.width().value);
        if let Ok(page_text) = page.text() {
            let mut part = String::new();
            let mut page_parts: Vec<TextPart> = Vec::new();
            let mut part_bounds = None::<PdfRect>;
            let mut count = 0;
            for c in page_text.chars().iter() {
                match c.unicode_char() {
                    None => (),
                    Some('\0') => (),
                    Some(DELIMETER) if count >= NPARTS_PER_ID => {
                        part_bounds = expand_bounds(part_bounds, c.loose_bounds());
                        part.push(DELIMETER);
                        page_parts.push(TextPart {
                            ph,
                            pw,
                            page_index: page_index as u32,
                            bounds: part_bounds.unwrap_or(PdfRect::zero()),
                            id: Uuid::new_v4().to_string(),
                            text: part,
                        });
                        part = String::new();
                        part_bounds = None;
                        count = 0;
                    }
                    Some(DELIMETER) => {
                        part.push(DELIMETER);
                        count += 1;
                    }
                    Some(content) if !content.is_whitespace() => {
                        part.push(content);
                        part_bounds = expand_bounds(part_bounds, c.loose_bounds());
                    }
                    Some(content) => part.push(content),
                }
            }
            if !part.is_empty() {
                page_parts.push(TextPart {
                    ph,
                    pw,
                    page_index: page_index as u32,
                    bounds: part_bounds.unwrap_or(PdfRect::zero()),
                    id: Uuid::new_v4().to_string(),
                    text: part,
                });
            }
            sentences.extend(page_parts);
        }
    }
    unzip_text_parts(sentences)
}

#[tracing::instrument(skip(pdfium, s3_client, db) fields(key = key, bucket = bucket))]
pub async fn extract_text_from_document(
    key: &str,
    bucket: &str,
    pdfium: Rc<pdfium_render::prelude::Pdfium>,
    s3_client: Arc<service::s3::S3>,
    db: Arc<service::db::DB>,
) -> Result<Option<DocumentKeyParts>, Error> {
    // If the key does not end with .pdf, we don't care about it
    // No need to error out, since this is the expected behavior
    if !key.ends_with(".pdf") {
        tracing::info!("skipping non-pdf file for extraction");
        return Ok(None);
    }

    let document_key_parts = DocumentKeyParts::from_s3_key(key).map_err(|e| {
        tracing::error!(error=?e, "invalid key format");
        Error::from("invalid key format")
    })?;

    let document_id = &document_key_parts.document_id;
    tracing::info!(document_id=%document_id, "starting extracting text process for document");

    let raw_file = match s3_client
        .get_document_bytes(bucket, &document_key_parts.to_key())
        .await
    {
        Ok(bytes) => bytes,
        Err(e) => {
            // If we can't get the document from s3, then most likely the document was deleted
            // this shouldn't cause an error, but mostly we want to know about it
            tracing::warn!(error=?e, "unable to retrieve document from s3");
            return Ok(None);
        }
    };

    let file = match pdfium.load_pdf_from_byte_vec(raw_file, None) {
        Ok(file) => file,
        // there are still some lingering encrypted pdfs what we don't care about
        Err(PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError)) => {
            tracing::warn!("ran into encrypted pdf, skipping");
            return Ok(None);
        }
        Err(e) => {
            tracing::error!(error=?e, "pdfium failed to load pdf from bytes");
            return Err(Error::from(e));
        }
    };

    let (references, extracted_text) = ref_id_extract_text(&file);
    let token_count = ai::tokens::count_tokens(&extracted_text).map_err(|e| {
        tracing::error!(error=?e, "unable to count tokens");
        Error::from(e)
    })?;

    db.create_document_text(document_id, &extracted_text, token_count)
        .await
        .context("unable to store extracted text in db")?;

    db.insert_references(&references, document_id)
        .await
        .context("coult not insert sentences")?;
    tracing::info!(document_id=%document_id, "extraction complete");
    Ok(Some(document_key_parts))
}

// locally run extraction
#[cfg(test)]
#[cfg(feature = "local-extract")]
mod test {
    use pdfium_render::prelude::*;
    use sqlx::PgPool;
    use std::fs::File;
    use std::io::Read;

    use crate::handler::extract_text_citations::ref_id_extract_text;
    use crate::service::db::DBClient;

    #[ignore = "this test requires a very specific system environment which is hard to replicate in CI"]
    #[tokio::test]
    pub async fn test_local_extract() {
        let db_url = std::env::var("DATABASE_URL").unwrap();
        let pool = PgPool::connect(db_url.as_str()).await.unwrap();
        let db = DBClient::new(pool);
        let pdfium_path = "./pdfium-lib/macos";
        let pdfium = Pdfium::new(
            Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(pdfium_path))
                .unwrap(),
        );
        let test_file = "deepseek.pdf";
        let mut f = File::open(test_file).unwrap();
        let mut data: Vec<u8> = vec![];
        f.read_to_end(&mut data).unwrap();
        let pdf_file = pdfium.load_pdf_from_byte_vec(data, None).unwrap();
        let (refs, text) = ref_id_extract_text(&pdf_file);
        println!("{}", text);
        // println!("__REFERENCES__\n{:?}", refs);
        // println!("__TEXT__\n{:?}", text);
        db.create_document_text("test", text.as_str(), 0)
            .await
            .unwrap();
        db.insert_references(&refs, "test").await.unwrap();
        println!("pdfium initialized");
    }
}
