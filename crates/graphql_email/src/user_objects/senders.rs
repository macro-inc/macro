use super::*;

/// A verified provider sender, embedded under the inbox that authorizes it.
/// An address alone is not a global identity: two inboxes may send as it.
#[derive(SimpleObject)]
pub struct GraphqlEmailSendAsAddress {
    /// Address to use in the outgoing From header.
    email_address: String,
    /// Provider-configured display name.
    display_name: Option<String>,
}

#[ComplexObject]
impl<S: EmailUserService> GraphqlEmailLink<S> {
    /// Verified sender addresses. Nullable so one unavailable grant does not
    /// hide the inbox or aliases belonging to other inboxes.
    #[tracing::instrument(skip_all, err(Debug))]
    async fn send_as(&self) -> async_graphql::Result<Option<Vec<GraphqlEmailSendAsAddress>>> {
        self.service.get_user_email_senders(self.viewer.clone(), self.link_id).await
            .map(|senders| Some(senders.into_iter().map(|sender| GraphqlEmailSendAsAddress {
                email_address: sender.email_address.0.as_ref().to_owned(),
                display_name: sender.display_name,
            }).collect()))
            .map_err(|error| {
                tracing::error!(error = ?error, link_id = %self.link_id, "failed to load email senders");
                let code = match error {
                    email::domain::models::EmailErr::SendAsPermissionRequired => "NEEDS_REAUTH",
                    email::domain::models::EmailErr::InboxNotFound => "INBOX_NOT_FOUND",
                    _ => "SEND_AS_UNAVAILABLE",
                };
                async_graphql::Error::new("email sender addresses are unavailable")
                    .extend_with(|_, extensions| extensions.set("code", code))
            })
    }
}
