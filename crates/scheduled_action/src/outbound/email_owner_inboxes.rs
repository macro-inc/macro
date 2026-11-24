//! The inboxes an owner receives mail in, as the email domain lists them: the
//! links they own and those delegated to them.

use email::domain::ports::EmailRepo;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use rootcause::Report;

use crate::domain::ports::{OwnerInboxes, OwnerInboxesError};

#[cfg(test)]
mod test;

/// [`OwnerInboxes`] through the email domain's [`EmailRepo`]: the same set
/// the app lists as a person's inboxes, so they can pick only from it.
pub struct EmailOwnerInboxes<R>(pub R);

#[async_trait::async_trait]
impl<R> OwnerInboxes for EmailOwnerInboxes<R>
where
    R: EmailRepo + Send + Sync + 'static,
    R::Err: std::error::Error + Send + Sync + 'static,
{
    // The owner is an email address: never a span field.
    #[tracing::instrument(
        name = "routine.owner_inboxes",
        skip_all,
        fields(asked = inboxes.len(), theirs = tracing::field::Empty),
        err
    )]
    async fn among(
        &self,
        owner: &MacroUserIdStr<'_>,
        inboxes: &[Uuid],
    ) -> Result<Vec<Uuid>, OwnerInboxesError> {
        let theirs = self
            .0
            .inbox_ids_among(owner.clone(), inboxes)
            .await
            .map_err(|error| OwnerInboxesError::Internal(Report::new(error).into_dynamic()))?;
        tracing::Span::current().record("theirs", theirs.len());
        Ok(theirs)
    }
}
