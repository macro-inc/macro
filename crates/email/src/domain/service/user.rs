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
        let details = self.email_repo.user_inbox_details(macro_id).await?;
        let mut links = Vec::with_capacity(details.len());
        for details in details {
            let filters = self.email_repo.user_sender_filters(details.id).await?;
            let draft_is_signal =
                draft_sender_is_signal(details.email_address.0.as_ref(), &filters);
            links.push(UserEmailLink::from_details(details, draft_is_signal));
        }
        Ok(links)
    }
}

/// Mirror the sender override precedence used by thread importance: an exact
/// address rule wins over a domain rule, and unclassified drafts are Signal.
fn draft_sender_is_signal(address: &str, filters: &[crate::domain::models::EmailFilter]) -> bool {
    let domain = address
        .rsplit_once('@')
        .map(|(_, domain)| domain)
        .unwrap_or("");
    let by_address = |filter: &crate::domain::models::EmailFilter| {
        filter
            .email_address
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case(address))
    };
    let by_domain = |filter: &crate::domain::models::EmailFilter| {
        filter
            .email_domain
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case(domain))
    };
    if filters.iter().any(by_address) {
        return filters
            .iter()
            .filter(|filter| by_address(filter))
            .any(|filter| filter.is_important);
    }
    !filters.iter().any(by_domain)
        || filters
            .iter()
            .filter(|filter| by_domain(filter))
            .any(|filter| filter.is_important)
}
