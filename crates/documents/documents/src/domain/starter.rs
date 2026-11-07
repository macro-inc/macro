//! Retry-safe creation and tagging of starter documents.

use std::collections::HashSet;
use std::future::Future;

use uuid::Uuid;

use super::create::NewMarkdownTextDocument;
use super::models::DocumentError;

#[cfg(test)]
mod test;

/// Documents available after a seeding attempt, including prior creations.
#[derive(Default)]
pub struct StarterDocumentsOutcome {
    /// Documents inserted on this attempt, for non-idempotent follow-up work.
    pub created: HashSet<Uuid>,
    /// Documents that were created successfully or already existed.
    pub available: HashSet<Uuid>,
    /// At least one creation or tag operation failed and needs a retry.
    pub incomplete: bool,
}

/// Create documents in order, attempting each one's tag before the next create.
/// A tag or creation failure does not prevent independent documents from being
/// created. Conflicts only retry tagging; initial properties remain untouched.
/// Callers finalize available content before reporting incomplete seeding.
pub async fn seed_starter_documents<C, T, CF, TF>(
    documents: Vec<(Uuid, NewMarkdownTextDocument)>,
    mut create: C,
    mut tag: T,
) -> StarterDocumentsOutcome
where
    C: FnMut(NewMarkdownTextDocument) -> CF,
    CF: Future<Output = Result<(), DocumentError>>,
    T: FnMut(Uuid) -> TF,
    TF: Future<Output = Result<(), DocumentError>>,
{
    let mut outcome = StarterDocumentsOutcome::default();
    for (id, document) in documents {
        match create(document).await {
            Ok(()) => {
                outcome.created.insert(id);
            }
            Err(DocumentError::Conflict(_)) => {}
            Err(error) => {
                tracing::error!(error=?error, document_id=%id, "failed to create starter document");
                outcome.incomplete = true;
                continue;
            }
        }
        outcome.available.insert(id);
        if let Err(error) = tag(id).await {
            tracing::error!(error=?error, document_id=%id, "failed to tag starter document");
            outcome.incomplete = true;
        }
    }
    outcome
}
