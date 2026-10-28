use std::sync::{Arc, Mutex};

use attachment::{AttachmentContent, Attachments, ResolutionError};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use super::*;

const ONE_BY_ONE_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0xC9, 0xFE, 0x92, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
];

#[derive(Clone, Copy)]
enum Outcome {
    Image,
    Denied,
    Unsupported,
    Failed,
    Text,
    Url,
    Mixed,
    Multiple,
}

type Calls = Arc<Mutex<Vec<(String, Entity<'static>)>>>;

struct Service {
    outcome: Outcome,
    calls: Calls,
}

impl AttachmentService for Service {
    async fn resolve_attachments<'a>(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&'a Entity<'a>]>,
    ) -> Attachments<'a> {
        let entity = ids[0];
        self.calls.lock().unwrap().push((
            user_id.to_string(),
            entity
                .entity_type
                .with_entity_string(entity.entity_id.to_string()),
        ));
        let error = match self.outcome {
            Outcome::Denied => Some(AttachmentError::PermissionDenied(Box::new(
                std::io::Error::new(std::io::ErrorKind::PermissionDenied, "not shared"),
            ))),
            Outcome::Unsupported => Some(AttachmentError::UnsupportedFileType("pdf".to_owned())),
            Outcome::Failed => Some(AttachmentError::Internal(anyhow::anyhow!("storage failed"))),
            _ => None,
        };
        if let Some(error) = error {
            return Attachments::one(Err(ResolutionError::new(
                entity
                    .entity_type
                    .with_entity_string(entity.entity_id.to_string()),
                error,
            )));
        }
        let image = || {
            AttachmentPart::Image(
                ImageData::try_from_bytes(ONE_BY_ONE_PNG.to_vec()).expect("valid PNG"),
            )
        };
        let parts = match self.outcome {
            Outcome::Text => vec![AttachmentPart::Content("not an image".to_owned())],
            Outcome::Url => vec![AttachmentPart::Image(ImageData::StaticUrl(
                "https://unresolved.example/photo.png".to_owned(),
            ))],
            Outcome::Mixed => vec![
                image(),
                AttachmentPart::Content("additional content".to_owned()),
            ],
            _ => vec![image()],
        };
        let content = AttachmentContent {
            reference: entity.clone(),
            name: None,
            content: NonEmpty::new(parts).expect("content"),
        };
        let resolved = Attachments::one(Ok(content));
        if matches!(self.outcome, Outcome::Multiple) {
            resolved.append(Ok(AttachmentContent {
                reference: entity.clone(),
                name: None,
                content: NonEmpty::one(image()),
            }))
        } else {
            resolved
        }
    }
}

fn principal() -> CreationPrincipal {
    CreationPrincipal::BotForUser {
        bot: bot_id::MACRO_AI_BOT_ID,
        user: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
    }
}

fn service(outcome: Outcome) -> (Service, Calls) {
    let calls = Arc::new(Mutex::new(Vec::new()));
    (
        Service {
            outcome,
            calls: Arc::clone(&calls),
        },
        calls,
    )
}

#[tokio::test]
async fn routes_references_to_the_owning_service_with_the_acting_user() {
    let (documents, document_calls) = service(Outcome::Image);
    let (static_files, static_calls) = service(Outcome::Image);
    let reader = AttachmentImageReferenceReader::new(documents, static_files);
    let document_id = Uuid::from_u128(1);
    let static_id = Uuid::from_u128(2);
    for reference in [
        ImageReference::Document(document_id),
        ImageReference::StaticFile(static_id),
    ] {
        let image = reader
            .read_image(&principal(), &reference)
            .await
            .expect("reference image");
        assert_eq!(image.mime_type, "image/webp");
        assert!(image.bytes.starts_with(b"RIFF"));
        assert_eq!(&image.bytes[8..12], b"WEBP");
    }
    assert_eq!(
        *document_calls.lock().unwrap(),
        vec![(
            "macro|owner@example.com".to_owned(),
            EntityType::Document.with_entity_string(document_id.to_string()),
        )]
    );
    assert_eq!(
        *static_calls.lock().unwrap(),
        vec![(
            "macro|owner@example.com".to_owned(),
            EntityType::StaticFile.with_entity_string(static_id.to_string()),
        )]
    );
}

#[tokio::test]
async fn denied_missing_or_failed_references_surface_errors() {
    for outcome in [Outcome::Denied, Outcome::Unsupported, Outcome::Failed] {
        let (documents, _) = service(outcome);
        let (static_files, _) = service(Outcome::Image);
        let reader = AttachmentImageReferenceReader::new(documents, static_files);
        let error = reader
            .read_image(&principal(), &ImageReference::Document(Uuid::from_u128(1)))
            .await
            .expect_err("reference rejected");
        match outcome {
            Outcome::Denied => assert!(matches!(error, ReadImageError::Unauthorized)),
            Outcome::Unsupported => assert!(matches!(error, ReadImageError::NotImage)),
            Outcome::Failed => assert!(matches!(error, ReadImageError::Internal(_))),
            _ => unreachable!(),
        }
    }
}

#[tokio::test]
async fn urls_text_and_ambiguous_results_are_never_forwarded_as_references() {
    for outcome in [
        Outcome::Url,
        Outcome::Text,
        Outcome::Mixed,
        Outcome::Multiple,
    ] {
        let (documents, _) = service(Outcome::Image);
        let (static_files, _) = service(outcome);
        let reader = AttachmentImageReferenceReader::new(documents, static_files);
        assert!(matches!(
            reader
                .read_image(
                    &principal(),
                    &ImageReference::StaticFile(Uuid::from_u128(1))
                )
                .await,
            Err(ReadImageError::NotImage)
        ));
    }
}

#[tokio::test]
async fn a_principal_without_an_acting_user_cannot_read_user_references() {
    let (documents, document_calls) = service(Outcome::Image);
    let (static_files, static_calls) = service(Outcome::Image);
    let reader = AttachmentImageReferenceReader::new(documents, static_files);
    let principal = CreationPrincipal::TeamBot {
        bot: bot_id::NonSystemBotId::new(bot_id::BotId::new_from_uuid(Uuid::from_u128(1)))
            .expect("non-system bot"),
        team: Uuid::from_u128(2),
    };
    assert!(matches!(
        reader
            .read_image(&principal, &ImageReference::Document(Uuid::from_u128(3)))
            .await,
        Err(ReadImageError::Unauthorized)
    ));
    assert!(document_calls.lock().unwrap().is_empty());
    assert!(static_calls.lock().unwrap().is_empty());
}
