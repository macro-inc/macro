use crate::domain::models::GetChannelsRequest;
use crate::outbound::postgres::comms_repo::{
    get_latest_channel_message, get_latest_channel_messages_batch,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_comms::channel::ChannelId;
use models_pagination::{Query, SimpleSortMethod};
use rootcause::Report;
use sqlx::Pool;
use uuid::Uuid;

use super::get_user_channels_dynamic;

fn uuid(s: &str) -> Uuid {
    Uuid::parse_str(s).unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn test_get_user_channels_dynamic_no_filter(pool: Pool<sqlx::Postgres>) {
    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();

    let params = GetChannelsRequest {
        macro_id: user_id.into_owned(),
        limit: Some(20),
        query: Query::Sort(SimpleSortMethod::UpdatedAt, None),
    }
    .into_params();

    let channels = get_user_channels_dynamic(&pool, &params).await.unwrap();

    // user-1 is a participant in 4 channels (A, B, C, D)
    assert_eq!(channels.len(), 4, "Should return 4 channels for user-1");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn test_get_user_channels_dynamic_filter_by_channel_id(pool: Pool<sqlx::Postgres>) {
    use filter_ast::ExpandFrame;
    use item_filters::ChannelFilters;

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let channel_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    // Create filter for specific channel ID
    let channel_filters = ChannelFilters {
        channel_ids: vec![channel_id.to_string()],
        ..Default::default()
    };

    let filter_ast = ChannelFilters::expand_ast(channel_filters)
        .unwrap()
        .map(std::sync::Arc::new);

    let params = GetChannelsRequest {
        macro_id: user_id.into_owned(),
        limit: Some(20),
        query: Query::Sort(SimpleSortMethod::UpdatedAt, filter_ast),
    }
    .into_params();

    let channels = get_user_channels_dynamic(&pool, &params).await.unwrap();

    // Should get exactly the filtered channel
    assert_eq!(channels.len(), 1, "Should return exactly one channel");
    assert_eq!(
        channels[0].channel.id.0.to_string(),
        channel_id,
        "Should return the correct channel"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn test_get_user_channels_dynamic_filter_by_org_id(pool: Pool<sqlx::Postgres>) {
    use filter_ast::ExpandFrame;
    use item_filters::ChannelFilters;

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let org_id = 1i64;

    // Create filter for specific organization
    let channel_filters = ChannelFilters {
        org_id: Some(org_id),
        ..Default::default()
    };

    let filter_ast = ChannelFilters::expand_ast(channel_filters)
        .unwrap()
        .map(std::sync::Arc::new);

    let params = GetChannelsRequest {
        macro_id: user_id.into_owned(),
        limit: Some(20),
        query: Query::Sort(SimpleSortMethod::UpdatedAt, filter_ast),
    }
    .into_params();

    let channels = get_user_channels_dynamic(&pool, &params).await.unwrap();

    // Should get channels A and B (both have org_id = 1)
    assert_eq!(channels.len(), 2, "Should return 2 channels with org_id=1");

    // All returned channels should have the specified org_id
    for channel in &channels {
        assert_eq!(
            channel.channel.org_id.as_ref().map(|o| o.0 as i64),
            Some(org_id),
            "All channels should belong to the specified org"
        );
    }
}

/// Tests that mixing supported (channel_id) and unsupported (thread_id) filters
/// does not produce malformed SQL. Thread filters are message-level and should
/// be ignored at the channel query level.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn test_get_user_channels_dynamic_mixed_supported_and_unsupported_filters(
    pool: Pool<sqlx::Postgres>,
) {
    use filter_ast::ExpandFrame;
    use item_filters::ChannelFilters;

    let user_id = MacroUserIdStr::parse_from_str("macro|user-1@test.com").unwrap();
    let channel_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    let thread_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    // Create filter with both channel_id (supported) and thread_id (unsupported at channel level)
    // This combination previously produced malformed SQL like "( AND c.id = '...')"
    let channel_filters = ChannelFilters {
        channel_ids: vec![channel_id.to_string()],
        thread_ids: vec![thread_id.to_string()],
        ..Default::default()
    };

    let filter_ast = ChannelFilters::expand_ast(channel_filters)
        .unwrap()
        .map(std::sync::Arc::new);

    let params = GetChannelsRequest {
        macro_id: user_id.into_owned(),
        limit: Some(20),
        query: Query::Sort(SimpleSortMethod::UpdatedAt, filter_ast),
    }
    .into_params();

    // This should not fail with a SQL syntax error
    let channels = get_user_channels_dynamic(&pool, &params).await.unwrap();

    // Should still filter by the supported channel_id filter
    assert_eq!(channels.len(), 1, "Should return exactly one channel");
    assert_eq!(
        channels[0].channel.id.0.to_string(),
        channel_id,
        "Should return the correct channel"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn test_get_latest_channel_messages_batch(pool: Pool<sqlx::Postgres>) -> Result<(), Report> {
    let ids = vec![
        ChannelId(uuid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")),
        ChannelId(uuid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")),
        ChannelId(uuid("cccccccc-cccc-cccc-cccc-cccccccccccc")),
        ChannelId(uuid("dddddddd-dddd-dddd-dddd-dddddddddddd")),
    ];

    let res = get_latest_channel_messages_batch(&pool, &ids).await?;

    // aaaaaaaa
    let a = res.get(&ids[0]).expect("channel a should exist");
    assert_eq!(
        a.latest_non_thread_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("aaaaaa2a-0000-0000-0000-000000000002")
    );

    // bbbbbbbb
    let b = res.get(&ids[1]).expect("channel b should exist");
    assert_eq!(
        b.latest_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("bbbbbb2b-0000-0000-0000-000000000003")
    );
    assert!(b.latest_non_thread_message.is_none());

    // cccccccc
    let c = res.get(&ids[2]).expect("channel c should exist");
    assert_eq!(
        c.latest_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("cccccc2c-0000-0000-0000-000000000002")
    );
    assert_eq!(
        c.latest_non_thread_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("cccccc2c-0000-0000-0000-000000000002")
    );

    // dddddddd
    let d = res.get(&ids[3]).expect("channel d should exist");
    assert_eq!(
        d.latest_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("dddddd1d-0000-0000-0000-000000000001")
    );
    assert_eq!(
        d.latest_non_thread_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("dddddd1d-0000-0000-0000-000000000001")
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channels"))
)]
async fn test_get_latest_channel_message(pool: Pool<sqlx::Postgres>) -> Result<(), Report> {
    let a = get_latest_channel_message(
        &pool,
        ChannelId(uuid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")),
    )
    .await?;

    assert_eq!(
        a.latest_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("aaaaaa2a-0000-0000-0000-000000000004")
    );
    assert_eq!(
        a.latest_non_thread_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("aaaaaa2a-0000-0000-0000-000000000002")
    );

    let b = get_latest_channel_message(
        &pool,
        ChannelId(uuid("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")),
    )
    .await?;
    assert_eq!(
        b.latest_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("bbbbbb2b-0000-0000-0000-000000000003")
    );
    assert!(b.latest_non_thread_message.is_none());

    let c = get_latest_channel_message(
        &pool,
        ChannelId(uuid("cccccccc-cccc-cccc-cccc-cccccccccccc")),
    )
    .await?;
    assert_eq!(
        c.latest_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("cccccc2c-0000-0000-0000-000000000002")
    );
    assert_eq!(
        c.latest_non_thread_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("cccccc2c-0000-0000-0000-000000000002")
    );

    let d = get_latest_channel_message(
        &pool,
        ChannelId(uuid("dddddddd-dddd-dddd-dddd-dddddddddddd")),
    )
    .await?;
    assert_eq!(
        d.latest_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("dddddd1d-0000-0000-0000-000000000001")
    );
    assert_eq!(
        d.latest_non_thread_message
            .as_ref()
            .map(|m| m.message_id.to_string())
            .as_deref(),
        Some("dddddd1d-0000-0000-0000-000000000001")
    );

    Ok(())
}
