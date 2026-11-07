use uuid::Uuid;

use super::super::models::{ChangeBatch, EmailApiError, InboxChanges, SyncCursor};
use super::super::ports::{MailboxSyncClient, ProviderRequestGate, ProviderTokenSource};
use super::{ApiOperationKind, EmailApiClientServiceImpl};

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    R: MailboxSyncClient,
    T: ProviderTokenSource,
    L: ProviderRequestGate,
{
    /// Returns the number of threads reported by a linked mailbox.
    #[tracing::instrument(skip(self), fields(retry_count = 0, gate_in_flight = tracing::field::Empty, gate_cap = tracing::field::Empty))]
    pub async fn get_thread_count(&self, link_id: Uuid) -> Result<u64, EmailApiError> {
        self.read_with_token(link_id, ApiOperationKind::GetProfile, |token| async move {
            self.repository.get_thread_count(&token).await
        })
        .await
    }

    /// Lists mailbox changes following `cursor`.
    ///
    /// Each page is its own admission, so it takes a permit, is charged to the
    /// mailbox's window and waits out a cooldown. A refusal or failure on any
    /// page fails the whole read; callers redeliver it from `cursor`.
    #[tracing::instrument(
        skip(self),
        fields(
            retry_count = 0,
            pages = tracing::field::Empty,
            gate_in_flight = tracing::field::Empty,
            gate_cap = tracing::field::Empty
        )
    )]
    pub async fn list_changes(
        &self,
        link_id: Uuid,
        cursor: &SyncCursor,
    ) -> Result<ChangeBatch, EmailApiError> {
        let mut changes = InboxChanges::default();
        let mut next_cursor = None;
        let mut page_token: Option<String> = None;
        let mut pages = 0;
        loop {
            let page_token_ref = page_token.as_deref();
            let page = self
                .read_with_token(link_id, ApiOperationKind::ListChanges, |token| async move {
                    self.repository
                        .list_changes_page(&token, cursor, page_token_ref)
                        .await
                })
                .await?;
            pages += 1;
            changes.append_later(page.changes);
            next_cursor = page.cursor.or(next_cursor);
            page_token = page.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
        tracing::Span::current().record("pages", pages);
        Ok(ChangeBatch::new(
            changes,
            next_cursor.unwrap_or_else(|| cursor.clone()),
        ))
    }
}

#[cfg(test)]
mod test;
