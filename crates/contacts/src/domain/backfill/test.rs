use super::*;
use crate::domain::models::backfill::{
    ChannelMember, ChannelRecord, ChannelSnapshot, Inbox, InboxContact, InboxOwner, LegacyEdge,
    OrphanCheck,
};
use crate::domain::models::list::InboxProvider;
use std::sync::Mutex;

const INBOX: Uuid = Uuid::from_u128(7);

/// One owner with one Gmail inbox that knows `known` of `contacts` legacy
/// contacts, served in pages.
struct InboxOnlySource {
    contacts: usize,
    known: usize,
}

impl LegacyDirectorySource for InboxOnlySource {
    async fn channel_page(&self, _: Uuid, _: i64) -> Result<Vec<ChannelRecord>, Report> {
        Ok(Vec::new())
    }

    async fn channel_members(&self, _: &[Uuid]) -> Result<Vec<ChannelMember>, Report> {
        Ok(Vec::new())
    }

    async fn snapshot_page(&self, _: i32, _: i64) -> Result<Vec<ChannelSnapshot>, Report> {
        Ok(Vec::new())
    }

    async fn direct_messages_with_person_message(
        &self,
        _: &[Uuid],
        _: Option<DateTime<Utc>>,
    ) -> Result<Vec<Uuid>, Report> {
        Ok(Vec::new())
    }

    async fn inbox_owner_page(&self, after: &str, _: i64) -> Result<Vec<InboxOwner>, Report> {
        let owner = "macro|owner@example.com";
        if after >= owner {
            return Ok(Vec::new());
        }
        Ok(vec![InboxOwner {
            owner: owner.to_owned(),
            inboxes: vec![Inbox {
                link_id: INBOX,
                provider: InboxProvider::Gmail,
            }],
        }])
    }

    async fn inbox_contact_page(
        &self,
        _: &str,
        _: &[Uuid],
        after: &str,
        limit: i64,
    ) -> Result<Vec<InboxContact>, Report> {
        Ok((0..self.contacts)
            .map(|n| format!("macro|c{n:05}@example.com"))
            .filter(|peer| peer.as_str() > after)
            .take(limit as usize)
            .map(|peer| {
                let n: usize = peer[7..12].parse().unwrap();
                InboxContact {
                    link_ids: if n < self.known {
                        vec![INBOX]
                    } else {
                        Vec::new()
                    },
                    peer,
                }
            })
            .collect())
    }

    async fn legacy_edge_page(&self, _: i32, _: i64) -> Result<Vec<LegacyEdge>, Report> {
        Ok(Vec::new())
    }
}

impl OrphanedListRows for InboxOnlySource {
    async fn orphan_page(
        &self,
        _: OrphanKind,
        _: &str,
        _: i64,
    ) -> Result<Vec<OrphanCheck>, Report> {
        Ok(Vec::new())
    }

    async fn delete_orphan_rows(&self, _: OrphanKind, _: &str, _: i64) -> Result<u64, Report> {
        Ok(0)
    }
}

#[derive(Default)]
struct RecordingLists {
    inbox_writes: Mutex<Vec<usize>>,
}

impl ContactListRepository for RecordingLists {
    async fn record_interactions(
        &self,
        _: &[MacroUserIdStr<'static>],
        _: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>, Report> {
        Ok(Vec::new())
    }

    async fn record_inbox_contacts(
        &self,
        _: &InboxSource,
        contacts: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.inbox_writes.lock().unwrap().push(contacts.len());
        Ok(contacts.to_vec())
    }

    async fn record_invite(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &MacroUserIdStr<'static>,
    ) -> Result<bool, Report> {
        Ok(false)
    }

    async fn missing_profiles(
        &self,
        _: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(Vec::new())
    }

    async fn delete_user_lists(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(Vec::new())
    }
}

fn backfill(contacts: usize, known: usize) -> DirectoryBackfill<InboxOnlySource, RecordingLists> {
    DirectoryBackfill {
        source: InboxOnlySource { contacts, known },
        lists: RecordingLists::default(),
        settings: BackfillSettings {
            page_size: 500,
            edge_page_size: 2000,
            contact_page_size: 300,
            pause: Duration::ZERO,
            support_roster: HashSet::new(),
        },
    }
}

fn inbox_request(dry_run: bool) -> BackfillRequest {
    BackfillRequest {
        passes: BTreeSet::from([BackfillPass::Inbox]),
        dry_run,
        after: None,
    }
}

#[tokio::test]
async fn inbox_contacts_are_written_in_chunks_of_500_across_read_pages() {
    let backfill = backfill(1_500, 1_100);

    let report = backfill.backfill(&inbox_request(false)).await.unwrap();

    let inbox = report.inbox.unwrap();
    assert_eq!((inbox.owners, inbox.legacy_contacts), (1, 1_500));
    assert_eq!((inbox.written.writes, inbox.written.added_rows), (3, 1_100));
    assert_eq!(
        *backfill.lists.inbox_writes.lock().unwrap(),
        vec![500, 500, 100]
    );
    assert!(report.channels.is_none());
}

#[tokio::test]
async fn a_dry_run_counts_without_writing() {
    let backfill = backfill(600, 600);

    let report = backfill.backfill(&inbox_request(true)).await.unwrap();

    let written = report.inbox.unwrap().written;
    assert_eq!(
        (written.writes, written.attempted_rows, written.added_rows),
        (2, 600, 0)
    );
    assert!(backfill.lists.inbox_writes.lock().unwrap().is_empty());
}
