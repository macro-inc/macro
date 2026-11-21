use super::*;
use crate::domain::models::{
    contact::{Contact, ContactId},
    list::ContactList,
    listed::ListedContact,
    page::ContactIdEntry,
};
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
    /// When set, each load waits for a permit before answering.
    gate: Option<tokio::sync::Notify>,
}

impl Flags {
    fn new(answer: Result<Option<bool>, ()>) -> Self {
        Self {
            answer,
            on: Vec::new(),
            loads: AtomicUsize::new(0),
            gate: None,
        }
    }
}

impl FeatureFlags for &'static Flags {
    async fn load(&self, user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        if let Some(gate) = &self.gate {
            gate.notified().await;
        }
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

fn person(viewer: &str, email: &str) -> PersonMatch {
    PersonMatch {
        contact: Contact {
            id: ContactId::for_viewer(&user(viewer), &user(email)),
            user_id: user(email),
            name: None,
            lists: Vec::new(),
        },
        is_teammate: false,
        is_agent: false,
    }
}

impl PeopleSearchService for Legacy {
    async fn search_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        _query: &PeopleSearchQuery,
        _limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        Ok(vec![
            person(viewer.email_str(), "legacy@example.com"),
            person(viewer.email_str(), "listed@example.com"),
        ])
    }
}

impl CorrespondentsService for Legacy {
    async fn correspondents(
        &self,
        _user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(vec![user("legacy@example.com")])
    }
}

/// The list-aware directory, served as consecutive `pages`.
struct Lists {
    pages: Vec<ContactIdPage>,
    reads: Mutex<Vec<Option<String>>>,
    /// The size of each lookup.
    lookups: Mutex<Vec<usize>>,
}

impl Lists {
    fn new(pages: Vec<ContactIdPage>) -> Self {
        Self {
            pages,
            reads: Mutex::new(Vec::new()),
            lookups: Mutex::new(Vec::new()),
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
        lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.lookups.lock().unwrap().push(lookup.ids().len());
        // The directory holds everyone whose address starts with `listed`.
        Ok(lookup
            .ids()
            .iter()
            .filter(|id| id.email_str().starts_with("listed"))
            .cloned()
            .collect())
    }

    /// Everyone whose address starts with `listed` is in `interacted`.
    async fn contact_lists(
        &self,
        _viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<ListedContact>, Report> {
        Ok(lookup
            .ids()
            .iter()
            .filter(|id| id.email_str().starts_with("listed"))
            .map(|id| ListedContact {
                user_id: id.clone(),
                lists: vec![ContactList::Interacted],
            })
            .collect())
    }

    async fn audience_page(
        &self,
        _subject: MacroUserIdStr<'_>,
        _after: Option<&ContactCursor>,
        _limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        Err(rootcause::report!("the router never reads audiences"))
    }

    async fn search_listed_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        _needle: &str,
        _limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        let mut found = person(viewer.email_str(), "listed-search@example.com");
        found.contact.lists = vec![ContactList::Gmail];
        Ok(vec![found])
    }

    async fn inbox_contacts(
        &self,
        _viewer: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        Ok(vec![user("listed-inbox@example.com")])
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
                &ContactLookup::new(vec![user("listed@example.com")]).unwrap(),
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

#[tokio::test]
async fn requested_ids_are_looked_up_in_bounded_chunks_once_each() {
    let (reads, _) = router(Flags::new(Ok(Some(true))), Vec::new());
    let mut ids: Vec<_> = (0..1000)
        .map(|i| user(&format!("other{i}@example.com")))
        .collect();
    ids.push(user("listed1@example.com"));
    ids.push(user("listed1@example.com"));
    ids.push(user("listed2@example.com"));
    let found = reads
        .query_contacts_among(user("viewer@example.com"), &ids)
        .await
        .unwrap();
    assert_eq!(
        found.iter().map(|id| id.email_str()).collect::<Vec<_>>(),
        ["listed1@example.com", "listed2@example.com"]
    );
    assert_eq!(*reads.lists.lookups.lock().unwrap(), [500, 500, 2]);
    assert!(
        reads.lists.reads.lock().unwrap().is_empty(),
        "no directory pages"
    );
}

#[tokio::test]
async fn requested_ids_filter_the_legacy_listing_when_the_flag_is_off() {
    let (reads, _) = router(Flags::new(Ok(Some(false))), Vec::new());
    let found = reads
        .query_contacts_among(
            user("viewer@example.com"),
            &[user("viewer@example.com"), user("stranger@example.com")],
        )
        .await
        .unwrap();
    assert_eq!(found, [user("viewer@example.com")]);
    assert!(reads.lists.lookups.lock().unwrap().is_empty());
}

#[tokio::test]
async fn concurrent_reads_for_one_viewer_share_one_load() {
    let mut flags = Flags::new(Ok(Some(true)));
    flags.gate = Some(tokio::sync::Notify::new());
    let (reads, flags) = router(flags, Vec::new());
    let viewer = user("viewer@example.com");
    let (first, second, ()) = tokio::join!(
        reads.reads.source_for(&viewer),
        reads.reads.source_for(&viewer),
        async {
            if let Some(gate) = &flags.gate {
                gate.notify_one();
            }
        },
    );
    assert_eq!(
        (first, second),
        (DirectorySource::Lists, DirectorySource::Lists)
    );
    assert_eq!(flags.loads.load(Ordering::SeqCst), 1);
}

fn searched(people: &[PersonMatch]) -> Vec<(&str, Vec<ContactList>)> {
    people
        .iter()
        .map(|person| {
            (
                person.contact.user_id.email_str(),
                person.contact.lists.clone(),
            )
        })
        .collect()
}

#[tokio::test]
async fn people_search_follows_the_viewers_flag() {
    let query = PeopleSearchQuery::new("ex").unwrap();
    let (reads, _) = router(Flags::new(Ok(Some(true))), Vec::new());
    let people = reads
        .search_people(
            user("viewer@example.com"),
            &query,
            PeopleSearchLimit::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(
        searched(&people),
        [("listed-search@example.com", vec![ContactList::Gmail])]
    );

    let (reads, _) = router(Flags::new(Err(())), Vec::new());
    let people = reads
        .search_people(
            user("viewer@example.com"),
            &query,
            PeopleSearchLimit::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(
        searched(&people),
        [
            ("legacy@example.com", vec![]),
            ("listed@example.com", vec![ContactList::Interacted]),
        ],
        "legacy matches keep their order and get lists from the list-aware tables"
    );
}

#[tokio::test]
async fn a_list_aware_search_too_short_to_match_reads_nothing() {
    let (reads, _) = router(Flags::new(Ok(Some(true))), Vec::new());
    let people = reads
        .search_people(
            user("viewer@example.com"),
            &PeopleSearchQuery::new(" e ").unwrap(),
            PeopleSearchLimit::DEFAULT,
        )
        .await
        .unwrap();
    assert!(people.is_empty());
}

#[tokio::test]
async fn correspondents_follow_the_viewers_flag() {
    let (reads, _) = router(Flags::new(Ok(Some(true))), Vec::new());
    assert_eq!(
        reads
            .correspondents(user("viewer@example.com"))
            .await
            .unwrap(),
        [user("listed-inbox@example.com")]
    );
    let (reads, _) = router(Flags::new(Ok(Some(false))), Vec::new());
    assert_eq!(
        reads
            .correspondents(user("viewer@example.com"))
            .await
            .unwrap(),
        [user("legacy@example.com")]
    );
}

#[tokio::test]
async fn without_a_flag_provider_every_viewer_reads_legacy() {
    let reads: Router = FlaggedContactReads::new(
        Arc::new(Legacy),
        Arc::new(Lists::new(vec![page(&["macro|listed@example.com"], None)])),
        ContactListReads::optional(None),
    );
    assert_eq!(
        page_source(&reads, "viewer@example.com").await,
        "legacy@example.com"
    );
}
