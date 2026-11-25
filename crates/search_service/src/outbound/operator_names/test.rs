use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use readonly_pool::ReadOnlyPool;
use sqlx::PgPool;
use uuid::Uuid;

use super::OperatorNamesPgSource;
use crate::domain::operator_names::{OperatorNameSource, OperatorNamesService, TypedNames};

fn viewer() -> MacroUserId<Lowercase<'static>> {
    MacroUserId::parse_from_str("macro|viewer@example.com")
        .unwrap()
        .lowercase()
}

fn source(pool: PgPool) -> OperatorNamesPgSource {
    OperatorNamesPgSource {
        db: ReadOnlyPool(pool),
    }
}

fn ids(ids: &[&str]) -> Vec<Uuid> {
    ids.iter().map(|id| id.parse().unwrap()).collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("operator_names"))
)]
async fn a_channel_name_reaches_the_named_channels_the_viewer_is_in(pool: PgPool) {
    let mut found = source(pool)
        .channels_named(&viewer(), "LAUNCH", 20)
        .await
        .unwrap();
    found.sort();

    assert_eq!(
        found,
        ids(&[
            "d4000000-0000-0000-0000-000000000001",
            "d4000000-0000-0000-0000-000000000003",
        ]),
        "the whole name in either case, not Launch plan, Ana's Launch or the Launch the viewer left"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("operator_names"))
)]
async fn a_channel_name_is_the_whole_name_the_viewer_sees(pool: PgPool) {
    let found = source(pool)
        .channels_named(&viewer(), "ana lima", 20)
        .await
        .unwrap();

    assert_eq!(
        found,
        ids(&["d4000000-0000-0000-0000-000000000008"]),
        "the group named after Ana alone, not the DM with her or the group of Ana and Ben"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("operator_names"))
)]
async fn a_channel_name_is_matched_literally(pool: PgPool) {
    let found = source(pool)
        .channels_named(&viewer(), "launch.*", 20)
        .await
        .unwrap();

    assert!(
        found.is_empty(),
        "regex syntax in a name is escaped: {found:?}"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("operator_names"))
)]
async fn names_resolve_to_the_viewers_own_tags_and_inboxes(pool: PgPool) {
    let service = OperatorNamesService(source(pool));
    let names = TypedNames {
        tags: vec!["finance".to_string()],
        inboxes: vec![
            "viewer@example.com".to_string(),
            "ana@example.com".to_string(),
        ],
        channels: Vec::new(),
    };

    let named = service.resolve(&viewer(), &names).await.unwrap();

    assert_eq!(
        named.tag("Finance"),
        ids(&["d3000000-0000-0000-0000-000000000001"]),
        "the whole label, from the viewer's own tag set only"
    );
    assert_eq!(
        named.inbox("viewer@example.com"),
        ids(&["d1000000-0000-0000-0000-000000000001"])
    );
    assert!(
        named.inbox("ana@example.com").is_empty(),
        "an inbox the viewer doesn't read"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("operator_names", "operator_names_crowded")
    )
)]
async fn a_channel_name_reaches_past_newer_groups_named_otherwise(pool: PgPool) {
    let found = source(pool)
        .channels_named(&viewer(), "ana lima", 20)
        .await
        .unwrap();

    assert!(
        found.contains(&"d5000000-0000-0000-0000-0000000000ff".parse().unwrap()),
        "25 newer groups of Ana and someone else fill the first page: {found:?}"
    );
}
