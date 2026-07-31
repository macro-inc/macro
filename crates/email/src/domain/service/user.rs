use crate::domain::{
    models::{EmailErr, LinkLabel, UserEmailLink},
    ports::{EmailUserRepo, EmailUserService},
};
use macro_user_id::user_id::MacroUserIdStr;

use super::EmailServiceImpl;

#[cfg(test)]
mod test;

impl<T, U, E, CS, Eam, B> EmailUserService for EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailUserRepo,
    U: Send + Sync + 'static,
    E: Send + Sync + 'static,
    CS: Send + Sync + 'static,
    Eam: Send + Sync + 'static,
    B: Send + Sync + 'static,
{
    async fn get_user_email_labels(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<LinkLabel>, EmailErr> {
        let inboxes = self.email_repo.user_accessible_inboxes(macro_id).await?;
        let mut labels = Vec::new();

        // Preserve the REST analog's stable inbox order and each inbox's
        // repository-defined label order while aggregating owned and delegated
        // inboxes in the domain service.
        for inbox in inboxes {
            labels.extend(self.email_repo.user_labels_for_link(inbox.id).await?);
        }

        Ok(labels)
    }

    async fn get_user_email_links(
        &self,
        macro_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<UserEmailLink>, EmailErr> {
        Ok(self
            .email_repo
            .user_inbox_details(macro_id)
            .await?
            .into_iter()
            .map(UserEmailLink::from)
            .collect())
    }
}
