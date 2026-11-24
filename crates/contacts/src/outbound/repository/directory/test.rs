use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

mod people_named;
mod people_search;
mod plans;

fn mid(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).unwrap()
}

fn lookup(ids: &[&str]) -> ContactLookup {
    ContactLookup::new(ids.iter().map(|id| mid(id)).collect()).unwrap()
}

fn size(limit: u16) -> ContactPageSize {
    ContactPageSize::new(limit).unwrap()
}

fn ids(page: &ContactIdPage) -> Vec<String> {
    page.contacts
        .iter()
        .map(|entry| entry.user_id.to_string())
        .collect()
}

const VIEWER: &str = "macro|v@example.com";

const VIEWER_DIRECTORY: [&str; 8] = [
    "macro|a@example.com",
    "macro|b@example.com",
    "macro|c@example.com",
    "macro|d@example.com",
    "macro|e@example.com",
    "macro|legacy@example.com",
    "macro|t@example.com",
    VIEWER,
];

/// Read every page of `read` at `limit`, checking each page's bound.
async fn all_pages<F, Fut>(limit: u16, read: F) -> Vec<String>
where
    F: Fn(Option<ContactCursor>) -> Fut,
    Fut: Future<Output = Result<ContactIdPage, Report>>,
{
    let mut seen = Vec::new();
    let mut after = None;
    loop {
        let page = read(after).await.unwrap();
        assert!(page.contacts.len() <= usize::from(limit));
        seen.extend(ids(&page));
        after = page.next_cursor;
        if after.is_none() {
            return seen;
        }
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn the_directory_is_every_list_inbox_teammate_and_self_once(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    let page = repository
        .list_directory_page(mid(VIEWER), None, ContactPageSize::MAX)
        .await
        .unwrap();

    // Not s, z or g: rows that name the viewer, or another owner's rows, are
    // other directories.
    assert_eq!(ids(&page), VIEWER_DIRECTORY);
    assert_eq!(page.next_cursor, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn directory_pages_continue_without_repeats_or_gaps(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);
    for limit in [1, 2, 3] {
        let seen = all_pages(limit, |after| {
            let repository = &repository;
            async move {
                repository
                    .list_directory_page(mid(VIEWER), after.as_ref(), size(limit))
                    .await
            }
        })
        .await;
        assert_eq!(seen, VIEWER_DIRECTORY, "limit {limit}");
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn a_directory_holds_only_its_owners_rows(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);
    let directory = |user: &'static str| {
        let repository = &repository;
        async move {
            ids(&repository
                .list_directory_page(mid(user), None, ContactPageSize::MAX)
                .await
                .unwrap())
        }
    };

    // g's inbox knows v, so v is in g's directory; g is not in v's.
    assert_eq!(
        directory("macro|g@example.com").await,
        ["macro|g@example.com", VIEWER]
    );
    assert_eq!(
        directory("macro|nobody@example.com").await,
        ["macro|nobody@example.com"]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn lookup_keeps_only_directory_members_in_request_order(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    let found = repository
        .lookup_listed_contacts(
            mid(VIEWER),
            &lookup(&[
                "macro|s@example.com",
                "macro|t@example.com",
                "macro|e@example.com",
                "macro|g@example.com",
                VIEWER,
                "macro|legacy@example.com",
                "macro|z@example.com",
                "macro|a@example.com",
                "macro|x@example.com",
            ]),
        )
        .await
        .unwrap();

    assert_eq!(
        found,
        [
            mid("macro|t@example.com"),
            mid("macro|e@example.com"),
            mid(VIEWER),
            mid("macro|legacy@example.com"),
            mid("macro|a@example.com"),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn an_empty_lookup_reads_nothing(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);
    let empty = ContactLookup::new(Vec::new()).unwrap();

    assert_eq!(
        repository
            .lookup_listed_contacts(mid(VIEWER), &empty)
            .await
            .unwrap(),
        []
    );
    assert_eq!(
        repository.contact_lists(mid(VIEWER), &empty).await.unwrap(),
        []
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn lists_name_each_of_the_viewers_lists_once(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    let found = repository
        .contact_lists(
            mid(VIEWER),
            &lookup(&[
                "macro|t@example.com",
                "macro|s@example.com",
                VIEWER,
                "macro|d@example.com",
                "macro|a@example.com",
                "macro|legacy@example.com",
                "macro|b@example.com",
                "macro|c@example.com",
                "macro|e@example.com",
            ]),
        )
        .await
        .unwrap();

    let listed = |id: &str, lists: &[ContactList]| ListedContact {
        user_id: mid(id),
        lists: lists.to_vec(),
    };
    // The viewer is not their own teammate, s is not in the viewer's lists,
    // and b's unknown list key is skipped.
    assert_eq!(
        found,
        [
            listed(
                "macro|t@example.com",
                &[ContactList::Interacted, ContactList::Teammates]
            ),
            listed(
                "macro|d@example.com",
                &[ContactList::Gmail, ContactList::Outlook]
            ),
            listed(
                "macro|a@example.com",
                &[ContactList::Interacted, ContactList::Invited]
            ),
            listed("macro|legacy@example.com", &[ContactList::Teammates]),
            listed("macro|b@example.com", &[ContactList::Interacted]),
            listed("macro|c@example.com", &[ContactList::Gmail]),
            listed("macro|e@example.com", &[ContactList::Outlook]),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn the_audience_is_everyone_who_has_the_subject(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);
    let expected = [
        "macro|a@example.com",
        "macro|g@example.com",
        "macro|legacy@example.com",
        "macro|s@example.com",
        "macro|t@example.com",
        VIEWER,
    ];

    for limit in [1, 2, 500] {
        let seen = all_pages(limit, |after| {
            let repository = &repository;
            async move {
                repository
                    .audience_page(mid(VIEWER), after.as_ref(), size(limit))
                    .await
            }
        })
        .await;
        // Not b, c, d or e: the viewer has them, not the other way round.
        assert_eq!(seen, expected, "limit {limit}");
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn a_legacy_mixed_case_team_member_reads_their_team(pool: PgPool) {
    // team_user stores this user as `macro|Legacy@Example.com`.
    const LEGACY: &str = "macro|legacy@example.com";
    let repository = DbContactsRepository::new(pool);
    let team = [LEGACY, "macro|t@example.com", VIEWER];

    let page = repository
        .list_directory_page(mid(LEGACY), None, ContactPageSize::MAX)
        .await
        .unwrap();
    assert_eq!(ids(&page), team);

    let audience = repository
        .audience_page(mid(LEGACY), None, ContactPageSize::MAX)
        .await
        .unwrap();
    assert_eq!(ids(&audience), team);

    let requested = lookup(&[VIEWER, "macro|a@example.com", LEGACY]);
    assert_eq!(
        repository
            .lookup_listed_contacts(mid(LEGACY), &requested)
            .await
            .unwrap(),
        [mid(VIEWER), mid(LEGACY)]
    );
    assert_eq!(
        repository
            .contact_lists(mid(LEGACY), &requested)
            .await
            .unwrap(),
        [ListedContact {
            user_id: mid(VIEWER),
            lists: vec![ContactList::Teammates],
        }]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn inbox_contacts_are_the_owners_inbox_rows_once_each(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);

    let mut found = repository.inbox_contacts(mid(VIEWER)).await.unwrap();
    found.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));
    // d is known through both inboxes; a, b and t are in lists, not inboxes.
    assert_eq!(
        found,
        [
            mid("macro|c@example.com"),
            mid("macro|d@example.com"),
            mid("macro|e@example.com"),
        ]
    );
    // g's inbox knows the viewer; that is g's row, not the viewer's.
    assert_eq!(
        repository
            .inbox_contacts(mid("macro|g@example.com"))
            .await
            .unwrap(),
        [mid(VIEWER)]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn list_members_are_each_lists_own_members_paged_without_repeats(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);
    let cases = [
        // t is a teammate too, which does not move them out of interacted.
        (
            ContactList::Interacted,
            vec![
                "macro|a@example.com",
                "macro|b@example.com",
                "macro|t@example.com",
            ],
        ),
        (ContactList::Invited, vec!["macro|a@example.com"]),
        // d is known through both inboxes and is in both inbox lists once.
        (
            ContactList::Gmail,
            vec!["macro|c@example.com", "macro|d@example.com"],
        ),
        (
            ContactList::Outlook,
            vec!["macro|d@example.com", "macro|e@example.com"],
        ),
        // The legacy mixed-case teammate reads canonically; never the viewer.
        (
            ContactList::Teammates,
            vec!["macro|legacy@example.com", "macro|t@example.com"],
        ),
    ];
    for (list, expected) in cases {
        for limit in [1, 2, 500] {
            let members = all_pages(limit, |after| {
                let repository = &repository;
                async move {
                    repository
                        .list_members(mid(VIEWER), list, after.as_ref(), size(limit))
                        .await
                }
            })
            .await;
            assert_eq!(members, expected, "{list:?} at {limit}");
        }
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn list_members_hold_only_the_owners_rows(pool: PgPool) {
    let repository = DbContactsRepository::new(pool);
    let members = |viewer: &'static str, list| {
        let repository = &repository;
        async move {
            ids(&repository
                .list_members(mid(viewer), list, None, ContactPageSize::MAX)
                .await
                .unwrap())
        }
    };

    // s invited the viewer, and the viewer invited a: each sees only their own.
    assert_eq!(
        members("macro|s@example.com", ContactList::Invited).await,
        [VIEWER]
    );
    assert_eq!(
        members("macro|s@example.com", ContactList::Teammates).await,
        ["macro|x@example.com"]
    );
    // g's inbox knows the viewer; the viewer's gmail list does not hold g.
    assert_eq!(
        members("macro|g@example.com", ContactList::Gmail).await,
        [VIEWER]
    );
    assert!(
        members("macro|stranger@example.com", ContactList::Teammates)
            .await
            .is_empty()
    );
}
