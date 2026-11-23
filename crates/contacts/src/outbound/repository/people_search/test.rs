use super::*;
use crate::domain::{
    models::people::{NamedPeopleQuery, PeopleSearchQuery},
    ports::{PeopleNamingService, PeopleSearchService},
    service::ContactsDomainService,
};
use crate::outbound::gateway::ConnectionGatewayNotifier;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

const VIEWER: &str = "viewer@example.com";

fn service(
    pool: PgPool,
) -> ContactsDomainService<DbContactsRepository, Option<ConnectionGatewayNotifier>> {
    ContactsDomainService {
        repository: DbContactsRepository::new(pool),
        notifier: None,
    }
}

async fn search(pool: &PgPool, query: &str, limit: u32) -> Vec<(String, Option<String>, bool)> {
    service(pool.clone())
        .search_people(
            MacroUserIdStr::try_from_email(VIEWER).unwrap(),
            &PeopleSearchQuery::new(query).unwrap(),
            PeopleSearchLimit::new(limit).unwrap(),
        )
        .await
        .unwrap()
        .into_iter()
        .map(|person| {
            (
                person.contact.user_id.to_string(),
                person.contact.name,
                person.is_teammate,
            )
        })
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("people_search"))
)]
async fn teammates_rank_first_then_prefix_then_substring_matches(pool: PgPool) {
    let people = search(&pool, "  SAM ", 20).await;
    assert_eq!(
        people,
        vec![
            // Equal prefix match to "Sam Rivera", but on the viewer's team.
            (
                "macro|teammate@example.com".to_string(),
                Some("Sam Rivers".to_string()),
                true
            ),
            (
                "macro|contact@example.com".to_string(),
                Some("Sam Rivera".to_string()),
                false
            ),
            // Not a Macro user: matched by email, named by the viewer's own address book.
            (
                "macro|samantha.book@example.org".to_string(),
                Some("Book Sam".to_string()),
                false
            ),
            // Substring of the email only, so after every prefix match; N/A is not a name.
            (
                "macro|ossam@example.com".to_string(),
                Some("Zed".to_string()),
                false
            ),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("people_search"))
)]
async fn results_flag_agents_and_treat_non_macro_contacts_as_people(pool: PgPool) {
    let flags: Vec<_> = service(pool)
        .search_people(
            MacroUserIdStr::try_from_email(VIEWER).unwrap(),
            &PeopleSearchQuery::new("sam").unwrap(),
            PeopleSearchLimit::DEFAULT,
        )
        .await
        .unwrap()
        .into_iter()
        .map(|person| (person.contact.user_id.to_string(), person.is_agent))
        .collect();
    assert_eq!(
        flags,
        vec![
            ("macro|teammate@example.com".to_string(), false),
            ("macro|contact@example.com".to_string(), false),
            ("macro|samantha.book@example.org".to_string(), false),
            ("macro|ossam@example.com".to_string(), true),
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("people_search"))
)]
async fn search_is_scoped_to_the_viewers_contacts_self_and_team(pool: PgPool) {
    // Another user's contacts and teammates never appear, whether matched by
    // name ("Sam Other", "Sam Stranger") or by email ("samuel.private").
    let people = search(&pool, "sam", 50).await;
    for absent in [
        "macro|other@example.com",
        "macro|stranger@example.com",
        "macro|samuel.private@example.org",
    ] {
        assert!(
            people.iter().all(|(id, _, _)| id != absent),
            "{absent} leaked"
        );
    }
    assert!(search(&pool, "stranger", 50).await.is_empty());
    assert!(search(&pool, "samuel", 50).await.is_empty());
    assert!(search(&pool, "Stranger Label", 50).await.is_empty());
    // The viewer is part of their own directory and their own team.
    assert_eq!(
        search(&pool, "viewer per", 50).await,
        vec![(
            "macro|viewer@example.com".to_string(),
            Some("Viewer Person".to_string()),
            true
        )]
    );
    // A user with no edges and no team finds only themselves.
    let lonely = service(pool.clone())
        .search_people(
            MacroUserIdStr::try_from_email("nobody@example.com").unwrap(),
            &PeopleSearchQuery::new("example").unwrap(),
            PeopleSearchLimit::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(
        lonely
            .into_iter()
            .map(|person| (person.contact.user_id.to_string(), person.is_teammate))
            .collect::<Vec<_>>(),
        vec![("macro|nobody@example.com".to_string(), false)]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn limit_is_honoured_and_capped_at_fifty(pool: PgPool) {
    sqlx::query!(
        "INSERT INTO contacts_connections (user1, user2)
         SELECT 'macro|bulk' || lpad(g::text, 3, '0') || '@example.com', 'macro|viewer@example.com'
         FROM generate_series(1, 60) AS g"
    )
    .execute(&pool)
    .await
    .unwrap();
    let three = search(&pool, "bulk", 3).await;
    assert_eq!(
        three
            .iter()
            .map(|(id, _, _)| id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "macro|bulk001@example.com",
            "macro|bulk002@example.com",
            "macro|bulk003@example.com"
        ]
    );
    assert_eq!(search(&pool, "bulk", 50).await.len(), 50);
    assert_eq!(search(&pool, "bulk", 500).await.len(), 50);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("people_search"))
)]
async fn blank_and_one_character_queries_return_nobody(pool: PgPool) {
    for query in ["", "   ", "s", " e "] {
        assert!(search(&pool, query, 50).await.is_empty(), "{query:?}");
    }
}

async fn named(pool: &PgPool, text: &str, limit: u32) -> Vec<(String, Option<String>)> {
    service(pool.clone())
        .people_named(
            MacroUserIdStr::try_from_email(VIEWER).unwrap(),
            &NamedPeopleQuery::new(text).unwrap(),
            PeopleSearchLimit::new(limit).unwrap(),
        )
        .await
        .unwrap()
        .into_iter()
        .map(|person| (person.contact.user_id.to_string(), person.contact.name))
        .collect()
}

fn ids(people: &[(String, Option<String>)]) -> Vec<&str> {
    people.iter().map(|(id, _)| id.as_str()).collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("people_named"))
)]
async fn named_people_rank_teammates_then_exact_names_then_ids(pool: PgPool) {
    assert_eq!(
        ids(&named(&pool, "Tero", 50).await),
        [
            "macro|tero.t@example.com",
            // Exact first names.
            "macro|abbott@example.com",
            "macro|nyland@example.com",
            // Word starts: an address-book label, then two local parts.
            "macro|nameless@example.com",
            "macro|tero.case@example.org",
            "macro|tero.nolabel@example.org",
        ]
    );
    assert_eq!(
        ids(&named(&pool, "tero n", 50).await),
        ["macro|nyland@example.com", "macro|tero.nolabel@example.org"]
    );
    assert_eq!(
        ids(&named(&pool, "nyland tero", 50).await),
        ["macro|nyland@example.com"]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("people_named"))
)]
async fn named_people_start_a_word_of_the_name_they_are_shown_with(pool: PgPool) {
    assert_eq!(
        named(&pool, "te", 50).await,
        [
            (
                "macro|tero.t@example.com".to_string(),
                Some("Tero Teammate".to_string())
            ),
            (
                "macro|abbott@example.com".to_string(),
                Some("Tero Abbott".to_string())
            ),
            (
                "macro|nameless@example.com".to_string(),
                Some("Terodora Label".to_string())
            ),
            (
                "macro|nyland@example.com".to_string(),
                Some("Tero Nyland".to_string())
            ),
            (
                "macro|teague@example.com".to_string(),
                Some("Quinn Teague".to_string())
            ),
            ("macro|tero.case@example.org".to_string(), None),
            ("macro|tero.nolabel@example.org".to_string(), None),
            // Named by the first of the viewer's mailboxes that labels them.
            (
                "macro|tessa.book@example.org".to_string(),
                Some("Tessa Book".to_string())
            ),
        ],
        "Peter Stone only contains the text"
    );
    assert!(named(&pool, "other label", 50).await.is_empty());
    assert!(
        named(&pool, "ignored", 50).await.is_empty(),
        "a profile name wins over the viewer's label"
    );
    assert_eq!(ids(&named(&pool, "te", 2).await).len(), 2);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("people_named"))
)]
async fn named_people_are_scoped_to_the_viewers_directory(pool: PgPool) {
    assert!(
        named(&pool, "tero s", 50).await.is_empty(),
        "another user's contact"
    );
    assert!(
        named(&pool, "tero leak", 50).await.is_empty(),
        "another user's label"
    );
    assert_eq!(
        ids(&named(&pool, "viewer", 50).await),
        ["macro|viewer@example.com"]
    );
    assert!(named(&pool, "tero@example.com", 50).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("people_named"))
)]
async fn named_people_match_the_name_as_it_is_shown(pool: PgPool) {
    sqlx::query!(
        r#"INSERT INTO email_contacts (id, link_id, email_address, name) VALUES
        ('00000000-0000-4000-b000-000000000011', '00000000-0000-4000-a000-000000000001', 'aa.serrano@example.org', 'Serrano Pine'),
        ('00000000-0000-4000-b000-000000000012', '00000000-0000-4000-a000-000000000001', 'zz.tab@example.org', E'\tSerra'),
        ('00000000-0000-4000-b000-000000000013', '00000000-0000-4000-a000-000000000001', 'bb.na@example.org', 'N/A Jane'),
        ('00000000-0000-4000-b000-000000000014', '00000000-0000-4000-a000-000000000001', 'cc.nolan@example.org', 'Nolan Ash'),
        ('00000000-0000-4000-b000-000000000015', '00000000-0000-4000-a000-000000000001', 'dd.ipek@example.org', 'İpek Ada'),
        ('00000000-0000-4000-b000-000000000016', '00000000-0000-4000-a000-000000000001', 'ee.aron@example.org', 'A²ron Vale')"#
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO contacts_connections (user1, user2)
         SELECT least(contact COLLATE "C", 'macro|viewer@example.com'),
                greatest(contact COLLATE "C", 'macro|viewer@example.com')
         FROM unnest($1::text[]) AS contact"#,
        &[
            "macro|aa.serrano@example.org",
            "macro|zz.tab@example.org",
            "macro|bb.na@example.org",
            "macro|cc.nolan@example.org",
            "macro|dd.ipek@example.org",
            "macro|ee.aron@example.org",
        ] as &[&str]
    )
    .execute(&pool)
    .await
    .unwrap();

    // A label padded with a tab is still an exact name, ahead of a word start
    // with an earlier id.
    assert_eq!(
        named(&pool, "serra", 1).await,
        [(
            "macro|zz.tab@example.org".to_string(),
            Some("\tSerra".to_string())
        )]
    );
    // "N/A" is not part of the name the directory shows, so it takes no slot.
    assert_eq!(
        named(&pool, "n", 1).await,
        [(
            "macro|cc.nolan@example.org".to_string(),
            Some("Nolan Ash".to_string())
        )]
    );
    // The text and the names are lowercased by the same rules.
    assert_eq!(
        ids(&named(&pool, "İpek", 50).await),
        ["macro|dd.ipek@example.org"]
    );
    assert_eq!(
        ids(&named(&pool, "a²", 50).await),
        ["macro|ee.aron@example.org"]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("people_named"))
)]
async fn a_legacy_cased_roster_row_still_finds_the_team(pool: PgPool) {
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
        ('00000000-0000-4000-8000-000000000021', 'legacy', 'Legacy@example.com', 'cus_named_legacy');
        "#
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id)
        VALUES ('macro|Legacy@example.com', 'Legacy@example.com', '00000000-0000-4000-8000-000000000021')"#
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role)
         VALUES ('macro|Legacy@example.com', '00000000-0000-4000-9000-000000000001', 'member')"
    )
    .execute(&pool)
    .await
    .unwrap();

    let people = service(pool.clone())
        .people_named(
            MacroUserIdStr::try_from_email("legacy@example.com").unwrap(),
            &NamedPeopleQuery::new("tero").unwrap(),
            PeopleSearchLimit::DEFAULT,
        )
        .await
        .unwrap();
    assert_eq!(
        people
            .iter()
            .map(|person| (person.contact.user_id.to_string(), person.is_teammate))
            .collect::<Vec<_>>(),
        [("macro|tero.t@example.com".to_string(), true)]
    );
}
