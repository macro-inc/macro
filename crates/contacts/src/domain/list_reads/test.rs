use super::*;
use crate::domain::models::{listed::ListedContact, page::ContactIdEntry};
use feature_flags::{FlagSnapshot, FlagValue};
use macro_user_id::cowlike::CowLike;
use std::sync::atomic::{AtomicUsize, Ordering};

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn page(ids: &[&str], next: Option<&str>) -> ContactIdPage {
    ContactIdPage {
        contacts: ids
            .iter()
            .map(|id| ContactIdEntry::parse((*id).to_owned()).unwrap())
            .collect(),
        next_cursor: next.map(|next| ContactCursor::from_position(next.to_owned()).unwrap()),
    }
}

/// Answers every viewer's load with `answer`, except viewers listed in `on`,
/// and counts the loads.
struct Flags {
    answer: Result<Option<bool>, ()>,
    on: Vec<String>,
    loads: AtomicUsize,
}

impl Flags {
    fn new(answer: Result<Option<bool>, ()>) -> Self {
        Self {
            answer,
            on: Vec::new(),
            loads: AtomicUsize::new(0),
        }
    }
}

impl FeatureFlags for &'static Flags {
    async fn load(&self, user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        let answer = if self.on.iter().any(|on| on == user_id.as_ref()) {
            Ok(Some(true))
        } else {
            self.answer
        };
        match answer {
            Ok(Some(enabled)) => Ok(FlagSnapshot::new([(
                CONTACT_LIST_READS_FLAG.to_owned(),
                FlagValue::Boolean(enabled),
            )])),
            Ok(None) => Ok(FlagSnapshot::default()),
            Err(()) => Err(rootcause::report!("PostHog unavailable")),
        }
    }
}

/// The legacy graph: one fixed page and lookup, and a fixed full listing.
struct Legacy;

impl ContactsPageService for Legacy {
    async fn lookup_contact_ids(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(vec![user("legacy@example.com")])
    }

    async fn contact_id_page(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        Ok(page(&["macro|legacy@example.com"], None))
    }
}

impl ContactsService for Legacy {
    async fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(vec![user("legacy@example.com"), user_id.into_owned()])
    }

    async fn add_contact_nodes(&self, _nodes: ContactsNodes) -> Result<(), Report> {
        Ok(())
    }

    async fn invite_contact(
        &self,
        _inviter: MacroUserIdStr<'static>,
        _invitee: MacroUserIdStr<'static>,
    ) -> Result<(), Report> {
        Ok(())
    }
}

/// The list-aware directory, served as consecutive `pages`.
struct Lists {
    pages: Vec<ContactIdPage>,
    reads: Mutex<Vec<Option<String>>>,
}

impl Lists {
    fn new(pages: Vec<ContactIdPage>) -> Self {
        Self {
            pages,
            reads: Mutex::new(Vec::new()),
        }
    }
}

impl ContactListReader for Lists {
    async fn list_directory_page(
        &self,
        _viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        let mut reads = self.reads.lock().unwrap();
        reads.push(after.map(|cursor| cursor.position().to_owned()));
        self.pages
            .get(reads.len() - 1)
            .cloned()
            .ok_or_else(|| rootcause::report!("read past the last page"))
    }

    async fn lookup_listed_contacts(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(vec![user("listed@example.com")])
    }

    async fn contact_lists(
        &self,
        _viewer: MacroUserIdStr<'_>,
        _lookup: &ContactLookup,
    ) -> Result<Vec<ListedContact>, Report> {
        Err(rootcause::report!("the router never reads lists"))
    }

    async fn audience_page(
        &self,
        _subject: MacroUserIdStr<'_>,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        Err(rootcause::report!("the router never reads audiences"))
    }
}

type Router = FlaggedContactReads<Legacy, Lists, &'static Flags>;

fn router(flags: Flags, pages: Vec<ContactIdPage>) -> (Router, &'static Flags) {
    let flags: &'static Flags = Box::leak(Box::new(flags));
    (
        FlaggedContactReads::new(
            Arc::new(Legacy),
            Arc::new(Lists::new(pages)),
            ContactListReads::new(flags),
        ),
        flags,
    )
}

async fn page_source(reads: &Router, viewer: &str) -> String {
    let page = reads
        .contact_id_page(user(viewer), None, ContactPageSize::DEFAULT)
        .await
        .unwrap();
    page.contacts[0].user_id.email_str().to_owned()
}

#[tokio::test]
async fn each_read_follows_the_viewers_flag_and_reads_legacy_when_it_cannot_tell() {
    for (answer, expected) in [
        (Ok(Some(true)), "listed@example.com"),
        (Ok(Some(false)), "legacy@example.com"),
        (Ok(None), "legacy@example.com"),
        (Err(()), "legacy@example.com"),
    ] {
        let (reads, _) = router(
            Flags::new(answer),
            vec![page(&["macro|listed@example.com"], None)],
        );
        assert_eq!(
            page_source(&reads, "viewer@example.com").await,
            expected,
            "{answer:?}"
        );
        let lookup = reads
            .lookup_contact_ids(
                user("viewer@example.com"),
                &ContactLookup::new(vec![user("anyone@example.com")]).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(lookup[0].email_str(), expected, "{answer:?}");
    }
}

#[tokio::test]
async fn the_flag_is_per_viewer() {
    let mut flags = Flags::new(Ok(Some(false)));
    flags.on.push("macro|early@example.com".to_owned());
    let (reads, _) = router(flags, vec![page(&["macro|listed@example.com"], None)]);
    assert_eq!(
        page_source(&reads, "early@example.com").await,
        "listed@example.com"
    );
    assert_eq!(
        page_source(&reads, "late@example.com").await,
        "legacy@example.com"
    );
}

#[tokio::test(start_paused = true)]
async fn a_viewers_answer_is_reused_for_its_lifetime_then_read_again() {
    let (reads, flags) = router(Flags::new(Err(())), Vec::new());
    for _ in 0..3 {
        page_source(&reads, "viewer@example.com").await;
    }
    assert_eq!(
        flags.loads.load(Ordering::SeqCst),
        1,
        "a failed read is remembered too"
    );
    page_source(&reads, "other@example.com").await;
    assert_eq!(flags.loads.load(Ordering::SeqCst), 2);

    tokio::time::advance(DECISION_LIFETIME).await;
    page_source(&reads, "viewer@example.com").await;
    assert_eq!(flags.loads.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn the_full_listing_reads_every_list_page() {
    let (reads, _) = router(
        Flags::new(Ok(Some(true))),
        vec![
            page(
                &["macro|a@example.com", "macro|b@example.com"],
                Some("macro|b@example.com"),
            ),
            page(&["macro|viewer@example.com"], None),
        ],
    );
    let contacts = reads
        .query_contacts(user("viewer@example.com"))
        .await
        .unwrap();
    assert_eq!(
        contacts.iter().map(|id| id.email_str()).collect::<Vec<_>>(),
        ["a@example.com", "b@example.com", "viewer@example.com"]
    );
    assert_eq!(
        *reads.lists.reads.lock().unwrap(),
        [None, Some("macro|b@example.com".to_owned())]
    );
}

#[tokio::test]
async fn the_full_listing_fails_when_a_page_does_not_advance() {
    let stuck = page(&["macro|a@example.com"], Some("macro|a@example.com"));
    let (reads, _) = router(Flags::new(Ok(Some(true))), vec![stuck.clone(), stuck]);
    assert!(
        reads
            .query_contacts(user("viewer@example.com"))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn the_full_listing_reads_legacy_when_the_flag_is_off() {
    let (reads, _) = router(Flags::new(Ok(Some(false))), Vec::new());
    let contacts = reads
        .query_contacts(user("viewer@example.com"))
        .await
        .unwrap();
    assert_eq!(
        contacts.iter().map(|id| id.email_str()).collect::<Vec<_>>(),
        ["legacy@example.com", "viewer@example.com"]
    );
    assert!(reads.lists.reads.lock().unwrap().is_empty());
}
