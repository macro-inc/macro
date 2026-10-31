//! Which inbox a composed email goes out from.
//!
//! A transport that carries the inbox out of band - the `X-Email-Link-Id`
//! header, a GraphQL save's `link_id` - already knows. An AI-composed email
//! does not: the model writes recipients and prose, and the inbox has to be
//! derived. Getting it wrong is not cosmetic. The sender is what the
//! recipient sees and replies to, and a reply can only join the provider
//! thread of the account that received the original - so a reply sent from
//! the wrong inbox both misrepresents the user and starts a new thread.

use crate::domain::{
    models::{EmailErr, Link, ResolvedSendingInbox, SendingInboxRequest},
    ports::EmailRepo,
};
use macro_user_id::user_id::MacroUserIdStr;

use super::EmailServiceImpl;

#[cfg(test)]
mod test;

impl<T, U, E, CS, Eam, B> EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo,
    anyhow::Error: From<T::Err>,
{
    pub(crate) async fn resolve_sending_inbox_impl(
        &self,
        macro_id: MacroUserIdStr<'_>,
        request: SendingInboxRequest<'_>,
    ) -> Result<ResolvedSendingInbox, EmailErr> {
        let accessible_inboxes = self
            .email_repo
            .inboxes_for_macro_id(macro_id.clone())
            .await
            .map_err(anyhow::Error::from)?;

        let chosen =
            match requested_address(request.requested_address) {
                // An explicit choice is honoured or refused, never quietly
                // replaced: silently sending from a different address than the
                // one the caller named is the bug this whole module exists for.
                Some(address) => inbox_by_address(&accessible_inboxes, &macro_id, address)
                    .ok_or_else(|| EmailErr::UnknownSendingInbox {
                        requested: address.to_owned(),
                        available: accessible_inboxes
                            .iter()
                            .map(|inbox| inbox.email_address.0.as_ref().to_owned())
                            .collect(),
                    })?,
                None => {
                    let from_reply_target = match request.replying_to_id {
                        Some(replying_to_id) => {
                            self.inbox_holding_message(&accessible_inboxes, replying_to_id)
                                .await?
                        }
                        None => None,
                    };
                    from_reply_target
                        .or_else(|| default_inbox(&accessible_inboxes, &macro_id))
                        .ok_or(EmailErr::InboxNotFound)?
                }
            };

        Ok(ResolvedSendingInbox {
            link: accessible_inboxes[chosen].clone(),
            accessible_inboxes,
        })
    }

    /// The accessible inbox `message_id` lives in. `None` when the caller
    /// cannot reach the message at all, which is left to the send to report
    /// against the inbox it ends up using rather than pre-empted here.
    async fn inbox_holding_message(
        &self,
        accessible_inboxes: &[Link],
        message_id: uuid::Uuid,
    ) -> Result<Option<usize>, EmailErr> {
        let accessible_link_ids: Vec<uuid::Uuid> =
            accessible_inboxes.iter().map(|inbox| inbox.id).collect();
        let Some(message) = self
            .email_repo
            .get_simple_message(message_id, &accessible_link_ids)
            .await
            .map_err(anyhow::Error::from)?
        else {
            return Ok(None);
        };
        Ok(accessible_inboxes
            .iter()
            .position(|inbox| inbox.id == message.link_id))
    }
}

/// An address the caller actually supplied, as opposed to a present-but-blank
/// field - models and form state both produce those.
fn requested_address(requested: Option<&str>) -> Option<&str> {
    requested
        .map(str::trim)
        .filter(|address| !address.is_empty())
}

/// The accessible inbox at `address`, matched the case-insensitive way mail
/// domains treat addresses. An inbox the caller owns wins over one delegated
/// to them, so an address reachable through two accounts resolves to the
/// same one every time instead of by row order.
fn inbox_by_address(inboxes: &[Link], caller: &MacroUserIdStr<'_>, address: &str) -> Option<usize> {
    let at_address = |inbox: &&Link| inbox.email_address.0.as_ref().eq_ignore_ascii_case(address);
    inboxes
        .iter()
        .position(|inbox| at_address(&inbox) && inbox.macro_id.as_ref() == caller.as_ref())
        .or_else(|| inboxes.iter().position(|inbox| at_address(&inbox)))
}

/// Where a new email goes out from when nothing else picks an inbox: the
/// caller's primary inbox, else any inbox they own, else any inbox they can
/// reach. A delegated inbox is `is_primary` for *its* owner, so the macro-id
/// guard is what keeps a teammate's mailbox from becoming the caller's
/// default sender.
fn default_inbox(inboxes: &[Link], caller: &MacroUserIdStr<'_>) -> Option<usize> {
    let owned = |inbox: &Link| inbox.macro_id.as_ref() == caller.as_ref();
    inboxes
        .iter()
        .position(|inbox| inbox.is_primary && owned(inbox))
        .or_else(|| inboxes.iter().position(owned))
        .or_else(|| (!inboxes.is_empty()).then_some(0))
}
