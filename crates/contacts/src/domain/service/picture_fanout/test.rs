use super::*;
use crate::domain::models::listed::ListedContact;
use crate::domain::models::page::{ContactIdEntry, ContactIdPage};
use crate::domain::models::people::{PeopleSearchLimit, PersonMatch};
use crate::domain::models::query::ContactLookup;
use std::sync::{Arc, Mutex};

type Sent = Arc<Mutex<Vec<(String, Vec<String>)>>>;
type Cursors = Arc<Mutex<Vec<Option<String>>>>;

fn user(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

fn entry(value: &str) -> ContactIdEntry {
    ContactIdEntry::parse(value.to_string()).expect("valid entry")
}

/// Serves canned legacy and list-aware audience pages in order and records
/// the cursors each was asked for.
struct PagedRepo {
    pages: Mutex<Vec<ContactIdPage>>,
    cursors: Cursors,
    audience_pages: Mutex<Vec<ContactIdPage>>,
    audience_cursors: Cursors,
}

impl ContactsPageRepository for PagedRepo {
    async fn lookup_contact_ids(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        unreachable!("fan-out only pages")
    }

    async fn contact_id_page(
        &self,
        _viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        assert_eq!(limit, ContactPageSize::MAX);
        self.cursors
            .lock()
            .unwrap()
            .push(after.map(|c| c.position().to_string()));
        Ok(self.pages.lock().unwrap().remove(0))
    }
}

impl ContactListReader for PagedRepo {
    async fn list_directory_page(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        unreachable!("fan-out reads the audience")
    }

    async fn lookup_listed_contacts(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        unreachable!("fan-out only pages")
    }

    async fn contact_lists(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _lookup: &ContactLookup,
    ) -> Result<Vec<ListedContact>, Report> {
        unreachable!("fan-out reads no lists")
    }

    async fn audience_page(
        &self,
        _subject: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        assert_eq!(limit, ContactPageSize::MAX);
        self.audience_cursors
            .lock()
            .unwrap()
            .push(after.map(|c| c.position().to_string()));
        Ok(self.audience_pages.lock().unwrap().remove(0))
    }

    async fn search_listed_people(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _needle: &str,
        _limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        unreachable!("fan-out does not search")
    }

    async fn name_listed_people(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _query: &crate::domain::models::people::NamedPeopleQuery,
        _limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        unreachable!("fan-out does not name people")
    }

    async fn inbox_contacts(
        &self,
        _viewer: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        unreachable!("fan-out reads the audience")
    }

    async fn list_members(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _list: crate::domain::models::list::ContactList,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        unreachable!("fan-out reads the audience")
    }
}

#[derive(Default, Clone)]
struct RecordingNotifier {
    sent: Sent,
    fail: bool,
}

impl UserPictureNotifier for RecordingNotifier {
    async fn notify_picture_changed(
        &self,
        user_id: &MacroUserIdStr<'_>,
        recipients: &[MacroUserIdStr<'static>],
    ) -> Result<(), Report> {
        if self.fail {
            return Err(report!("gateway down"));
        }
        self.sent.lock().unwrap().push((
            user_id.as_ref().to_string(),
            recipients.iter().map(|r| r.as_ref().to_string()).collect(),
        ));
        Ok(())
    }
}

fn page(ids: &[&str], next: Option<&str>) -> ContactIdPage {
    ContactIdPage {
        contacts: ids.iter().map(|id| entry(id)).collect(),
        next_cursor: next.and_then(|n| ContactCursor::from_position(n.to_string())),
    }
}

/// A fan-out over `pages` of legacy neighbors and an empty list-aware
/// audience.
fn fanout(
    pages: Vec<ContactIdPage>,
    notifier: RecordingNotifier,
) -> (UserPictureFanout<PagedRepo, RecordingNotifier>, Cursors) {
    let (service, cursors, _) = fanout_both(pages, vec![page(&[], None)], notifier);
    (service, cursors)
}

fn fanout_both(
    pages: Vec<ContactIdPage>,
    audience_pages: Vec<ContactIdPage>,
    notifier: RecordingNotifier,
) -> (
    UserPictureFanout<PagedRepo, RecordingNotifier>,
    Cursors,
    Cursors,
) {
    let cursors = Arc::new(Mutex::new(Vec::new()));
    let audience_cursors = Arc::new(Mutex::new(Vec::new()));
    let repo = PagedRepo {
        pages: Mutex::new(pages),
        cursors: cursors.clone(),
        audience_pages: Mutex::new(audience_pages),
        audience_cursors: audience_cursors.clone(),
    };
    (
        UserPictureFanout::new(repo, notifier),
        cursors,
        audience_cursors,
    )
}

#[tokio::test]
async fn pages_through_all_contacts_one_message_per_page() {
    let notifier = RecordingNotifier::default();
    let (service, cursors) = fanout(
        vec![
            page(
                &["macro|a@example.com", "macro|b@example.com"],
                Some("macro|b@example.com"),
            ),
            page(&["macro|c@example.com"], None),
        ],
        notifier.clone(),
    );

    let summary = service.fan_out(&user("macro|a@example.com")).await.unwrap();

    assert_eq!(
        summary,
        FanoutSummary {
            pages: 3,
            recipients: 3
        }
    );
    let sent = notifier.sent.lock().unwrap();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].0, "macro|a@example.com");
    assert_eq!(sent[0].1, ["macro|a@example.com", "macro|b@example.com"]);
    assert_eq!(sent[1].1, ["macro|c@example.com"]);
    assert_eq!(
        *cursors.lock().unwrap(),
        [None, Some("macro|b@example.com".to_string())]
    );
}

#[tokio::test]
async fn notifies_the_legacy_and_list_aware_audiences() {
    let notifier = RecordingNotifier::default();
    let (service, cursors, audience_cursors) = fanout_both(
        vec![page(&["macro|a@example.com", "macro|b@example.com"], None)],
        vec![
            page(
                &["macro|a@example.com", "macro|c@example.com"],
                Some("macro|c@example.com"),
            ),
            page(&["macro|d@example.com"], None),
        ],
        notifier.clone(),
    );

    let summary = service.fan_out(&user("macro|a@example.com")).await.unwrap();

    assert_eq!(
        summary,
        FanoutSummary {
            pages: 3,
            recipients: 5
        }
    );
    let sent = notifier.sent.lock().unwrap();
    let recipients: Vec<_> = sent
        .iter()
        .map(|(_, recipients)| recipients.clone())
        .collect();
    assert_eq!(
        recipients,
        [
            vec!["macro|a@example.com", "macro|b@example.com"],
            vec!["macro|a@example.com", "macro|c@example.com"],
            vec!["macro|d@example.com"],
        ]
    );
    assert_eq!(*cursors.lock().unwrap(), [None]);
    assert_eq!(
        *audience_cursors.lock().unwrap(),
        [None, Some("macro|c@example.com".to_string())]
    );
}

#[tokio::test]
async fn empty_contacts_send_nothing() {
    let notifier = RecordingNotifier::default();
    let (service, _) = fanout(vec![page(&[], None)], notifier.clone());

    let summary = service.fan_out(&user("macro|a@example.com")).await.unwrap();

    assert_eq!(
        summary,
        FanoutSummary {
            pages: 2,
            recipients: 0
        }
    );
    assert!(notifier.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn empty_page_with_continuation_keeps_paging() {
    let notifier = RecordingNotifier::default();
    let (service, _) = fanout(
        vec![
            page(&[], Some("macro|skipped")),
            page(&["macro|b@example.com"], None),
        ],
        notifier.clone(),
    );

    let summary = service.fan_out(&user("macro|a@example.com")).await.unwrap();

    assert_eq!(
        summary,
        FanoutSummary {
            pages: 3,
            recipients: 1
        }
    );
    assert_eq!(notifier.sent.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn stuck_cursor_is_an_error() {
    let (service, _) = fanout(
        vec![
            page(&["macro|b@example.com"], Some("macro|b@example.com")),
            page(&["macro|b@example.com"], Some("macro|b@example.com")),
        ],
        RecordingNotifier::default(),
    );

    assert!(service.fan_out(&user("macro|a@example.com")).await.is_err());
}

#[tokio::test]
async fn notifier_failure_fails_the_fan_out() {
    let notifier = RecordingNotifier {
        fail: true,
        ..Default::default()
    };
    let (service, _) = fanout(vec![page(&["macro|a@example.com"], None)], notifier);

    assert!(service.fan_out(&user("macro|a@example.com")).await.is_err());
}

#[test]
fn coalesce_keeps_one_per_user_in_first_seen_order() {
    let users = coalesce_users([
        user("macro|a@example.com"),
        user("macro|b@example.com"),
        user("macro|a@example.com"),
    ]);
    assert_eq!(
        users,
        [user("macro|a@example.com"), user("macro|b@example.com")]
    );
    assert!(coalesce_users([]).is_empty());
}
