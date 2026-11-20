use super::*;
use crate::domain::mailbox::{
    AFTER_PROVIDER_ATTEMPTS, AFTER_PROVIDER_RETRY_DELAY, DatabaseFailure,
};
use crate::domain::models::error::LOCK_NOT_AVAILABLE;
use email_api_client::domain::models::{
    MailFolderCatalog, MailboxChangePage, MailboxMessage, MailboxState, MessageWriteReceipt,
    RoundStart, StreamToken,
};
use std::sync::{Arc, Mutex};

#[test]
fn restoring_junk_chooses_drafts_for_drafts_and_inbox_for_received_mail() {
    let folders: Vec<_> = [("drafts", FolderRole::Drafts), ("inbox", FolderRole::Inbox)]
        .into_iter()
        .map(|(id, role)| MailFolder {
            id: ProviderId::try_from(id.to_string()).unwrap(),
            parent_id: None,
            name: id.into(),
            role,
            has_children: false,
            total_items: None,
        })
        .collect();
    for (is_draft, destination) in [(true, "drafts"), (false, "inbox")] {
        let current = MailboxOrganization {
            state: MailboxState {
                is_draft,
                in_junk: true,
                ..Default::default()
            },
            folder_id: None,
            tags: vec![],
            version: None,
            is_sent: false,
        };
        assert_eq!(
            provider_action(&MailboxAction::Junk(false), &current, &folders).unwrap(),
            Some(MessageAction::MoveToFolder(
                ProviderId::try_from(destination.to_string()).unwrap()
            ))
        );
    }
}

#[test]
fn restoring_a_conversation_leaves_its_drafts_in_drafts() {
    let folders = vec![MailFolder {
        id: ProviderId::try_from("inbox".to_string()).unwrap(),
        parent_id: None,
        name: "inbox".into(),
        role: FolderRole::Inbox,
        has_children: false,
        total_items: None,
    }];
    let organization = |is_draft| MailboxOrganization {
        state: MailboxState {
            is_draft,
            ..Default::default()
        },
        folder_id: None,
        tags: vec![],
        version: None,
        is_sent: false,
    };
    assert_eq!(
        provider_action(
            &MailboxAction::Archived(false),
            &organization(true),
            &folders
        )
        .unwrap(),
        None
    );
    assert_eq!(
        provider_action(
            &MailboxAction::Archived(false),
            &organization(false),
            &folders
        )
        .unwrap(),
        Some(MessageAction::MoveToFolder(folders[0].id.clone()))
    );
}

#[derive(Clone, Default)]
struct Harness(Arc<Mutex<State>>);
#[derive(Default)]
struct State {
    claimed: bool,
    applies: u32,
    /// Write-version records that time out on a busy mailbox.
    locked_records: u32,
    record_attempts: u32,
    recorded: Option<(String, String)>,
    released: Option<u32>,
}

fn mailbox() -> MailboxKey {
    MailboxKey {
        link_id: Uuid::nil(),
        sync_generation: 1,
        grant_generation: 1,
    }
}

impl MailboxCommandRepository for Harness {
    async fn claim_command(&self, lease_id: Uuid) -> Result<Option<CommandLease>, MailboxError> {
        if std::mem::replace(&mut self.0.lock().unwrap().claimed, true) {
            return Ok(None);
        }
        Ok(Some(CommandLease {
            id: Uuid::now_v7(),
            lease_id,
            mailbox: mailbox(),
            action: MailboxAction::Flagged(true),
            attempts: 1,
        }))
    }
    async fn renew_command(&self, _: &CommandLease) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn command_context(&self, _: &CommandLease) -> Result<CommandContext, MailboxError> {
        Ok(CommandContext {
            authorized: true,
            target: Some(CommandTarget {
                message_id: Uuid::nil(),
                provider_id: Some(ProviderId::try_from("draft".to_string()).unwrap()),
                pending: PendingMailboxState::default(),
                awaiting_draft: false,
                retired: false,
            }),
            folders: vec![],
            has_errors: false,
        })
    }
    async fn defer_for_draft(&self, _: &CommandLease) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn record_write_version(
        &self,
        _: &CommandLease,
        _: &CommandTarget,
        previous: &str,
        current: &str,
    ) -> Result<(), MailboxError> {
        let mut s = self.0.lock().unwrap();
        s.record_attempts += 1;
        if s.locked_records > 0 {
            s.locked_records -= 1;
            return Err(MailboxError::database(DatabaseFailure::Sqlstate(
                LOCK_NOT_AVAILABLE.into(),
            )));
        }
        s.recorded = Some((previous.into(), current.into()));
        Ok(())
    }
    async fn confirm_target(
        &self,
        _: &CommandLease,
        _: &CommandTarget,
        _: Option<&MailboxOrganization>,
    ) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn fail_target(
        &self,
        _: &CommandLease,
        _: &CommandTarget,
        _: bool,
    ) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn release_command(&self, _: &CommandLease, seconds: u32) -> Result<(), MailboxError> {
        self.0.lock().unwrap().released = Some(seconds);
        Ok(())
    }
    async fn finish_command(
        &self,
        _: &CommandLease,
        _: CommandCompletion,
    ) -> Result<(), MailboxError> {
        Ok(())
    }
}

impl MailboxGateway for Harness {
    async fn folders(&self, _: MailboxKey) -> Result<MailFolderCatalog, EmailApiError> {
        Ok(MailFolderCatalog::Folders(vec![]))
    }
    async fn changes(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: Option<&StreamToken>,
        _: RoundStart,
    ) -> Result<MailboxChangePage, EmailApiError> {
        Err(EmailApiError::NotFound)
    }
    async fn message(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        Ok(None)
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

/// A draft the command flags: `v1` until the write, `v2` after it.
impl MailboxCommandGateway for Harness {
    async fn organization(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<Option<MailboxOrganization>, EmailApiError> {
        let flagged = self.0.lock().unwrap().applies > 0;
        Ok(Some(MailboxOrganization {
            state: MailboxState {
                is_draft: true,
                is_flagged: flagged,
                ..Default::default()
            },
            folder_id: None,
            tags: vec![],
            version: Some(if flagged { "v2" } else { "v1" }.into()),
            is_sent: false,
        }))
    }
    async fn apply(
        &self,
        _: MailboxKey,
        message: &ProviderId,
        _: &MessageAction,
        _: Option<&str>,
    ) -> Result<MessageWriteReceipt, EmailApiError> {
        self.0.lock().unwrap().applies += 1;
        Ok(MessageWriteReceipt {
            id: message.clone(),
            version: Some("v2".into()),
        })
    }
}

#[tokio::test(start_paused = true)]
async fn an_organization_write_records_the_draft_baseline_once_its_mailbox_frees() {
    let h = Harness::default();
    h.0.lock().unwrap().locked_records = 2;
    let started = tokio::time::Instant::now();
    assert!(
        MailboxCommandService::new(h.clone(), h.clone())
            .execute_once()
            .await
            .unwrap()
    );
    assert_eq!(started.elapsed(), 2 * AFTER_PROVIDER_RETRY_DELAY);
    let s = h.0.lock().unwrap();
    assert_eq!(s.applies, 1);
    assert_eq!(s.recorded, Some(("v1".into(), "v2".into())));
    assert_eq!(s.released, Some(0));
}

#[tokio::test(start_paused = true)]
async fn a_write_version_that_stays_locked_gives_up_inside_the_lease() {
    let h = Harness::default();
    h.0.lock().unwrap().locked_records = u32::MAX;
    let started = tokio::time::Instant::now();
    let error = MailboxCommandService::new(h.clone(), h.clone())
        .execute_once()
        .await
        .unwrap_err();
    assert!(error.is_lock_timeout(), "{error:?}");
    assert!(started.elapsed() < std::time::Duration::from_secs(180));
    let s = h.0.lock().unwrap();
    assert_eq!(s.record_attempts, AFTER_PROVIDER_ATTEMPTS);
    assert_eq!(s.applies, 1);
    assert_eq!(s.recorded, None);
    assert_eq!(s.released, Some(30));
}
