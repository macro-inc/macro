//! Tests for channel name search.

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::*;

fn user(id: &str) -> MacroUserId<Lowercase<'_>> {
    MacroUserId::parse_from_str(id).unwrap().lowercase()
}

fn channel_ids() -> Vec<Uuid> {
    [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        "33333333-3333-3333-3333-333333333333",
        "44444444-4444-4444-4444-444444444444",
        "55555555-5555-5555-5555-555555555555",
        "66666666-6666-6666-6666-666666666666",
    ]
    .into_iter()
    .map(|id| id.parse().unwrap())
    .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn member_sees_matching_channels_but_non_member_does_not(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let member_results = search_channel_names(
        &pool,
        &user("macro|member@test.com"),
        &channel_ids(),
        "Macro".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert_eq!(member_results.items.len(), 2);
    assert!(member_results.items.iter().all(|hit| {
        hit.entity_type == SearchEntityType::Channels
            && hit.name.contains("<macro_em>Macro</macro_em>")
    }));

    let non_member_results = search_channel_names(
        &pool,
        &user("macro|nonmember@test.com"),
        &channel_ids(),
        "Macro".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert!(non_member_results.items.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn partial_matches_prefix_while_exact_requires_a_complete_token(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let partial = search_channel_names(
        &pool,
        &user("macro|member@test.com"),
        &channel_ids(),
        "Mac".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(partial.items.len(), 3);

    let non_prefix = search_channel_names(
        &pool,
        &user("macro|member@test.com"),
        &channel_ids(),
        "acro".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert!(non_prefix.items.is_empty());

    let exact = search_channel_names(
        &pool,
        &user("macro|member@test.com"),
        &channel_ids(),
        "Mac".to_string(),
        true,
        10,
        None,
    )
    .await?;
    assert!(exact.items.is_empty());

    let exact_macro = search_channel_names(
        &pool,
        &user("macro|member@test.com"),
        &channel_ids(),
        "Macro".to_string(),
        true,
        10,
        None,
    )
    .await?;
    assert_eq!(exact_macro.items.len(), 2);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn former_participant_cannot_find_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let results = search_channel_names(
        &pool,
        &user("macro|former@test.com"),
        &channel_ids(),
        "Macro".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert!(results.items.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn member_can_find_direct_message_by_resolved_name(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let results = search_channel_names(
        &pool,
        &user("macro|member@test.com"),
        &channel_ids(),
        "Gab".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert_eq!(results.items.len(), 1);
    assert_eq!(results.items[0].name, "<macro_em>gab</macro_em>riel");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn scans_past_non_matching_batches_and_preserves_result_cursor(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let first_page = search_channel_names_in_batches(
        &pool,
        &user("macro|member@test.com"),
        &channel_ids(),
        "Macro".to_string(),
        false,
        1,
        None,
        1,
    )
    .await?;

    assert_eq!(first_page.items.len(), 1);
    assert_eq!(
        first_page.items[0].entity_id,
        "22222222-2222-2222-2222-222222222222".parse::<Uuid>()?
    );
    let SearchCursorOption::NotDone(Some(cursor)) = first_page.cursor else {
        anyhow::bail!("expected another page");
    };

    let second_page = search_channel_names_in_batches(
        &pool,
        &user("macro|member@test.com"),
        &channel_ids(),
        "Macro".to_string(),
        false,
        1,
        Some(cursor),
        1,
    )
    .await?;

    assert_eq!(second_page.items.len(), 1);
    assert_eq!(
        second_page.items[0].entity_id,
        "11111111-1111-1111-1111-111111111111".parse::<Uuid>()?
    );
    assert!(second_page.cursor.is_done());
    Ok(())
}
