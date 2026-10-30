//! Tests for channel name search.

use std::collections::BTreeSet;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::*;

const MACRO: &str = "11111111-1111-1111-1111-111111111111";
const MACRO_PLANNING: &str = "22222222-2222-2222-2222-222222222222";
const MACARONI: &str = "33333333-3333-3333-3333-333333333333";
const GABRIEL_DM: &str = "66666666-6666-6666-6666-666666666666";
const PETER_TEO_GROUP: &str = "77777777-7777-7777-7777-777777777777";
const NAMELESS_DM: &str = "88888888-8888-8888-8888-888888888888";
const CODEX_DM: &str = "99999999-9999-9999-9999-999999999999";
const DEAL_DESK_DM: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DESIGN_DECKS: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const HOLLIS_DM: &str = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const UNKNOWN_BOT_DM: &str = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const MEMBER: &str = "macro|member@test.com";
const GABRIEL: &str = "macro|gabriel@test.com";

fn user(id: &str) -> MacroUserId<Lowercase<'_>> {
    MacroUserId::parse_from_str(id).unwrap().lowercase()
}

fn ids(results: &PaginatedResult<NameSearchResult>) -> Vec<String> {
    results
        .items
        .iter()
        .map(|hit| hit.entity_id.to_string())
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
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "Macro".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert_eq!(ids(&member_results), [MACRO_PLANNING, MACRO]);
    assert!(member_results.items.iter().all(|hit| {
        hit.entity_type == SearchEntityType::Channels
            && hit.name.contains("<macro_em>Macro</macro_em>")
    }));

    let non_member_results = search_channel_names(
        &pool,
        &user("macro|nonmember@test.com"),
        ChannelNameSearchScope::default(),
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
async fn partial_matches_substrings_while_exact_requires_a_complete_token(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let prefix = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "Mac".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&prefix), [MACARONI, MACRO_PLANNING, MACRO]);

    let infix = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "acro".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&infix), [MACRO_PLANNING, MACRO]);

    let exact_prefix = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "Mac".to_string(),
        true,
        10,
        None,
    )
    .await?;
    assert!(exact_prefix.items.is_empty());

    let exact_token = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "Macro".to_string(),
        true,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&exact_token), [MACRO_PLANNING, MACRO]);
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
        ChannelNameSearchScope::default(),
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
async fn direct_message_is_found_by_the_other_participants_name(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let by_first_name = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "Gab".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&by_first_name), [GABRIEL_DM]);
    assert_eq!(
        by_first_name.items[0].name,
        "<macro_em>Gab</macro_em>riel Birman"
    );

    let by_last_name = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "birman".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&by_last_name), [GABRIEL_DM]);
    assert_eq!(
        by_last_name.items[0].name,
        "Gabriel <macro_em>Birman</macro_em>"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn direct_message_falls_back_to_the_email_local_part(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let no_user_row = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "nameless".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&no_user_row), [NAMELESS_DM]);
    assert_eq!(no_user_row.items[0].name, "<macro_em>nameless</macro_em>");

    let no_profile = search_channel_names(
        &pool,
        &user(GABRIEL),
        ChannelNameSearchScope::default(),
        "member".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&no_profile), [GABRIEL_DM]);
    assert_eq!(no_profile.items[0].name, "<macro_em>member</macro_em>");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn viewer_is_never_part_of_their_own_direct_message_name(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let gabriel_searching_gabriel = search_channel_names(
        &pool,
        &user(GABRIEL),
        ChannelNameSearchScope::default(),
        "gab".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert!(gabriel_searching_gabriel.items.is_empty());

    let member_searching_member = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "member".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert!(member_searching_member.items.is_empty());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn display_name_skips_not_available_parts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let results = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "hollis".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert_eq!(ids(&results), [HOLLIS_DM]);
    assert_eq!(results.items[0].name, "<macro_em>Hollis</macro_em>");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn unnamed_private_channel_is_found_by_any_other_participant(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let by_first_participant = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "peter".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&by_first_participant), [PETER_TEO_GROUP]);
    assert_eq!(
        by_first_participant.items[0].name,
        "<macro_em>Peter</macro_em> Chinman, Teo Nys"
    );

    let by_second_participant = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "nys".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&by_second_participant), [PETER_TEO_GROUP]);
    assert_eq!(
        by_second_participant.items[0].name,
        "Peter Chinman, Teo <macro_em>Nys</macro_em>"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn every_term_must_match_the_stored_name_or_some_other_participant(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let two_participants = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "peter teo".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&two_participants), [PETER_TEO_GROUP]);
    assert_eq!(
        two_participants.items[0].name,
        "<macro_em>Peter</macro_em> Chinman, <macro_em>Teo</macro_em> Nys"
    );

    let comma_separated = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "teo, peter".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&comma_separated), [PETER_TEO_GROUP]);

    let participants_of_different_channels = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "peter gabriel".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert!(participants_of_different_channels.items.is_empty());

    let two_words_of_a_stored_name = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "Macro Plan".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&two_words_of_a_stored_name), [MACRO_PLANNING]);
    assert_eq!(
        two_words_of_a_stored_name.items[0].name,
        "<macro_em>Macro</macro_em> <macro_em>Plan</macro_em>ning"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn persona_direct_messages_are_found_by_bot_name(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let system_bot = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "codex".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&system_bot), [CODEX_DM]);
    assert_eq!(system_bot.items[0].name, "<macro_em>Codex</macro_em>");

    let owned_bot = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "deal".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&owned_bot), [DEAL_DESK_DM]);
    assert_eq!(owned_bot.items[0].name, "<macro_em>Deal</macro_em> Desk");

    let bot_without_row = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "bot".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&bot_without_row), [UNKNOWN_BOT_DM]);
    assert_eq!(bot_without_row.items[0].name, "<macro_em>Bot</macro_em>");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn channel_types_narrow_the_search(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let every_type = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "des".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&every_type), [DESIGN_DECKS, DEAL_DESK_DM]);

    let direct_messages = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope {
            channel_ids: &[],
            channel_types: &[ChannelType::DirectMessage],
        },
        "des".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&direct_messages), [DEAL_DESK_DM]);

    let group_channels = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope {
            channel_ids: &[],
            channel_types: &[ChannelType::Public, ChannelType::Private, ChannelType::Team],
        },
        "des".to_string(),
        false,
        10,
        None,
    )
    .await?;
    assert_eq!(ids(&group_channels), [DESIGN_DECKS]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn channel_ids_narrow_the_search(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let results = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope {
            channel_ids: &[MACRO.parse()?],
            channel_types: &[],
        },
        "mac".to_string(),
        false,
        10,
        None,
    )
    .await?;

    assert_eq!(ids(&results), [MACRO]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn pages_through_mixed_named_and_direct_message_results(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let first_page = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "des".to_string(),
        false,
        1,
        None,
    )
    .await?;
    assert_eq!(ids(&first_page), [DESIGN_DECKS]);
    let SearchCursorOption::NotDone(Some(cursor)) = first_page.cursor else {
        anyhow::bail!("expected another page");
    };

    let second_page = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "des".to_string(),
        false,
        1,
        Some(cursor),
    )
    .await?;
    assert_eq!(ids(&second_page), [DEAL_DESK_DM]);
    assert!(second_page.cursor.is_done());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn blank_terms_and_thread_cursors_are_rejected(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let blank = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        " , ".to_string(),
        false,
        10,
        None,
    )
    .await;
    assert!(matches!(blank, Err(NameSearchError::EmptySearchTerm)));

    let thread_cursor = search_channel_names(
        &pool,
        &user(MEMBER),
        ChannelNameSearchScope::default(),
        "Macro".to_string(),
        false,
        10,
        Some(SearchMethodCursor::Thread {
            thread_id: Uuid::nil(),
            message_id: Uuid::nil(),
        }),
    )
    .await;
    assert!(matches!(
        thread_cursor,
        Err(NameSearchError::IncompatibleCursor)
    ));
    Ok(())
}

/// The SQL match and the Rust name resolution implement one rule: a channel is
/// returned exactly when the name the viewer sees contains every term.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("channel"))
)]
async fn results_match_the_names_the_viewer_sees(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let viewer = user(MEMBER);
    let channel_ids: Vec<Uuid> = sqlx::query_scalar!(
        "SELECT channel_id FROM comms_channel_participants WHERE user_id = $1 AND left_at IS NULL",
        MEMBER
    )
    .fetch_all(&pool)
    .await?;
    let resolved_names =
        batch_resolve_channel_names(&pool, &channel_ids, MacroUserIdStr(viewer.clone())).await?;
    assert_eq!(resolved_names.len(), 11);

    for term in [
        "mac",
        "acro",
        "gab",
        "birman",
        "peter",
        "teo",
        "nys",
        "nameless",
        "codex",
        "deal",
        "des",
        "an",
        "hollis",
        "member",
        "peter teo",
        "macro plan",
        "bot",
        "zzz",
    ] {
        let expected: BTreeSet<Uuid> = resolved_names
            .iter()
            .filter(|(_, name)| {
                term.split([' ', ','])
                    .filter(|part| !part.is_empty())
                    .all(|part| name.to_lowercase().contains(part))
            })
            .map(|(channel_id, _)| *channel_id)
            .collect();

        let results = search_channel_names(
            &pool,
            &viewer,
            ChannelNameSearchScope::default(),
            term.to_string(),
            false,
            100,
            None,
        )
        .await?;

        let actual: BTreeSet<Uuid> = results.items.iter().map(|hit| hit.entity_id).collect();
        assert_eq!(actual, expected, "channels matching {term:?}");
        assert!(
            results
                .items
                .iter()
                .all(|hit| hit.name.contains("<macro_em>")),
            "every hit for {term:?} is highlighted"
        );
    }
    Ok(())
}
