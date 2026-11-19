//! The inboxes an owner receives mail in, as the email domain lists them: the
//! links they own and those delegated to them.

use email::domain::ports::EmailRepo;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use crate::domain::ports::OwnerInboxes;

#[cfg(test)]
mod test;

/// [`OwnerInboxes`] through the email domain's [`EmailRepo`]: the same list
/// the app shows a person as their inboxes, so they can pick only from it.
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
        fields(inboxes = tracing::field::Empty),
        err
    )]
    async fn inboxes(&self, owner: &MacroUserIdStr<'_>) -> anyhow::Result<Vec<Uuid>> {
        let inboxes: Vec<Uuid> = self
            .0
            .inboxes_for_macro_id(owner.clone())
            .await?
            .into_iter()
            .map(|link| link.id)
            .collect();
        tracing::Span::current().record("inboxes", inboxes.len());
        Ok(inboxes)
    }
}
