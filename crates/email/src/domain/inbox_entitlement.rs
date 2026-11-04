//! The same connection limit applies across all mailbox providers.
pub const FREE_INBOX_LIMIT: i64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InboxConnectionFacts {
    pub professional: bool,
    pub accessible_inboxes: i64,
    /// Existing access, verified by the server, does not consume another slot.
    pub reconnecting: bool,
}

impl InboxConnectionFacts {
    pub fn permits_connection(self) -> bool {
        self.reconnecting || self.professional || self.accessible_inboxes < FREE_INBOX_LIMIT
    }
}

/// Admission checks use verified inbox access, including provider, for reconnects.
#[cfg(feature = "ports")]
pub struct InboxConnectionService<R>(pub R);

#[cfg(feature = "ports")]
impl<R: super::ports::EmailUserRepo> InboxConnectionService<R> {
    pub async fn permits_connection(
        &self,
        actor: macro_user_id::user_id::MacroUserIdStr<'static>,
        professional: bool,
        provider: super::models::UserProvider,
        reconnect: Option<uuid::Uuid>,
    ) -> Result<bool, super::models::EmailErr> {
        if professional {
            return Ok(true);
        }
        let inboxes = self.0.user_accessible_inboxes(actor).await?;
        Ok(InboxConnectionFacts {
            professional,
            accessible_inboxes: inboxes.len() as i64,
            reconnecting: inboxes
                .iter()
                .any(|link| Some(link.id) == reconnect && link.provider == provider),
        }
        .permits_connection())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn mixed_provider_limits_do_not_block_reconnect_or_incremental_consent() {
        let mut facts = InboxConnectionFacts {
            professional: false,
            accessible_inboxes: 2,
            reconnecting: false,
        };
        assert!(!facts.permits_connection());
        facts.reconnecting = true;
        assert!(facts.permits_connection());
        facts.reconnecting = false;
        facts.professional = true;
        assert!(facts.permits_connection());
        facts.professional = false;
        facts.accessible_inboxes = 1;
        assert!(facts.permits_connection());
    }
}
