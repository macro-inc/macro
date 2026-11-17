use std::collections::BTreeSet;

use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

#[test]
fn direct_message_falls_back_to_the_other_participants_email_local_part() {
    let participants = vec![
        "macro|me@test.com".to_string(),
        "macro|shepherd.hatton@gmail.com".to_string(),
    ];

    let name = resolve_channel_name(
        ChannelType::DirectMessage,
        None,
        Uuid::nil(),
        "macro|me@test.com",
        &participants,
        &NameLookup::new(),
        &HashMap::new(),
    );

    assert_eq!(name, "shepherd.hatton");
}

#[test]
fn unnamed_private_channel_lists_people_and_bots_but_not_the_viewer() {
    let participants = vec![
        "macro|me@test.com".to_string(),
        "macro|gabriel@test.com".to_string(),
        format!("bot|{}", bot_id::CODEX_BOT_ID),
    ];
    let mut user_names = NameLookup::new();
    user_names.insert(
        MacroUserIdStr::try_from("macro|gabriel@test.com".to_string()).unwrap(),
        "Gabriel Birman".to_string(),
    );
    let bot_names = HashMap::from([(bot_id::CODEX_BOT_ID, "Codex".to_string())]);

    let name = resolve_channel_name(
        ChannelType::Private,
        Some("  "),
        Uuid::nil(),
        "macro|me@test.com",
        &participants,
        &user_names,
        &bot_names,
    );

    assert_eq!(name, "Codex, Gabriel Birman");
}

const VIEWER: &str = "macro|viewer@example.com";
const MATCH_CHANNEL_NAMES_SQL: &str = include_str!("match_channel_names.sql");

fn viewer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(VIEWER.to_string()).unwrap()
}

fn channel(suffix: u8) -> Uuid {
    Uuid::parse_str(&format!("c1000000-0000-0000-0000-{suffix:012x}")).unwrap()
}

fn substring_patterns(term: &str) -> Vec<String> {
    term.split_whitespace()
        .map(|part| format!("%{part}%"))
        .collect()
}

fn search<'a>(patterns: &'a [String], limit: i64) -> ChannelNameSearch<'a> {
    ChannelNameSearch {
        viewer_user_id: viewer(),
        patterns,
        regex_patterns: false,
        channel_ids: &[],
        channel_types: &[],
        after: None,
        limit,
    }
}

fn ids(matches: &[ChannelNameMatch]) -> BTreeSet<Uuid> {
    matches.iter().map(|hit| hit.channel_id).collect()
}

/// The SQL match and the Rust naming rule agree for every way a channel gets
/// its name: a channel matches exactly when every term is in the name the
/// viewer sees, and matches come newest first.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_name_search"))
)]
async fn matches_are_the_channels_whose_resolved_name_has_every_term(
    pool: PgPool,
) -> anyhow::Result<()> {
    let channel_ids: Vec<Uuid> = sqlx::query_scalar!(
        "SELECT channel_id FROM comms_channel_participants WHERE user_id = $1 AND left_at IS NULL",
        VIEWER
    )
    .fetch_all(&pool)
    .await?;
    let resolved_names = batch_resolve_channel_names(&pool, &channel_ids, viewer()).await?;
    assert_eq!(resolved_names.len(), 14);

    for term in [
        "a",
        "o",
        "ada",
        "lovelace",
        "ada lovelace",
        "adam",
        "grace",
        "hopper",
        "grace ada",
        "helper",
        "owl",
        "retired",
        "robin",
        "bot",
        "macro",
        "coder",
        "cursor",
        "blank.profile",
        "noinfo",
        "ghost",
        "roadmap",
        "planning",
        "fans",
        "archive",
        "fern",
        "vera",
        "zzz",
        "zzz ada",
    ] {
        // A channel with no one else in it shows a placeholder, which is not a
        // name anyone knows it by, so the search never matches it.
        let expected: BTreeSet<Uuid> = resolved_names
            .iter()
            .filter(|(_, name)| !matches!(name.as_str(), "Direct message" | "Private channel"))
            .filter(|(_, name)| {
                term.split_whitespace()
                    .all(|part| name.to_lowercase().contains(part))
            })
            .map(|(channel_id, _)| *channel_id)
            .collect();
        let patterns = substring_patterns(term);
        let matches = match_channel_names(&pool, search(&patterns, 100)).await?;

        assert_eq!(ids(&matches), expected, "channels matching {term:?}");
        assert!(
            matches.windows(2).all(|pair| {
                (pair[0].updated_at, pair[0].channel_id) > (pair[1].updated_at, pair[1].channel_id)
            }),
            "matches for {term:?} come newest first"
        );
    }

    let cases: [(&str, &[u8]); 8] = [
        ("ada", &[0x02, 0x03, 0x04, 0x05]),
        ("grace ada", &[0x05]),
        ("bot", &[0x0a, 0x0b]),
        ("retired", &[]),
        ("macro", &[0x06]),
        ("ghost", &[0x09]),
        ("fern", &[]),
        ("vera", &[]),
    ];
    for (term, expected) in cases {
        let patterns = substring_patterns(term);
        let matches = match_channel_names(&pool, search(&patterns, 100)).await?;
        let expected: BTreeSet<Uuid> = expected.iter().copied().map(channel).collect();
        assert_eq!(ids(&matches), expected, "channels matching {term:?}");
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_name_search"))
)]
async fn exact_patterns_match_whole_words_of_people_and_names(pool: PgPool) -> anyhow::Result<()> {
    let patterns = vec![r"(^|\W)ada($|\W)".to_string()];
    let matches = match_channel_names(
        &pool,
        ChannelNameSearch {
            regex_patterns: true,
            ..search(&patterns, 100)
        },
    )
    .await?;

    assert_eq!(
        ids(&matches),
        BTreeSet::from([channel(0x02), channel(0x03), channel(0x05)])
    );
    Ok(())
}

/// Paging by the last match's `(updated_at, id)` returns every match once, in
/// order, including two channels updated at the same moment.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_name_search"))
)]
async fn pages_return_every_match_once_in_order(pool: PgPool) -> anyhow::Result<()> {
    let patterns = substring_patterns("o");
    let all = match_channel_names(&pool, search(&patterns, 100)).await?;
    assert!(all.len() > 4);

    let mut paged = Vec::new();
    let mut after = None;
    loop {
        let page = match_channel_names(
            &pool,
            ChannelNameSearch {
                after,
                ..search(&patterns, 2)
            },
        )
        .await?;
        let Some(last) = page.last() else {
            break;
        };
        after = Some((last.updated_at, last.channel_id));
        paged.extend(page);
    }

    assert_eq!(paged, all);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_name_search"))
)]
async fn channel_ids_and_types_narrow_the_matches(pool: PgPool) -> anyhow::Result<()> {
    let patterns = substring_patterns("a");
    let direct_messages = match_channel_names(
        &pool,
        ChannelNameSearch {
            channel_types: &[ChannelType::DirectMessage],
            ..search(&patterns, 100)
        },
    )
    .await?;
    let all = match_channel_names(&pool, search(&patterns, 100)).await?;
    assert!(!direct_messages.is_empty() && direct_messages.len() < all.len());
    let direct_message_ids: Vec<Uuid> = direct_messages.iter().map(|hit| hit.channel_id).collect();
    let types: Vec<String> = sqlx::query_scalar!(
        r#"SELECT channel_type::text AS "channel_type!" FROM comms_channels WHERE id = ANY($1)"#,
        &direct_message_ids
    )
    .fetch_all(&pool)
    .await?;
    assert!(
        types
            .iter()
            .all(|channel_type| channel_type == "direct_message")
    );

    let patterns = substring_patterns("ada");
    let listed = [channel(0x03), channel(0x05), channel(0x0f), channel(0x10)];
    let matches = match_channel_names(
        &pool,
        ChannelNameSearch {
            channel_ids: &listed,
            ..search(&patterns, 100)
        },
    )
    .await?;
    assert_eq!(
        ids(&matches),
        BTreeSet::from([channel(0x03), channel(0x05)])
    );
    Ok(())
}

/// A viewer in hundreds of channels among other people's channels, so the
/// planner weighs scans against lookups.
async fn seed_plan_data(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        SELECT md5('plan-user' || n)::uuid, 'plan-user' || n, 'plan-user' || n || '@example.test', 'cus_plan_' || n
        FROM generate_series(1, 5000) n;
        INSERT INTO "User" (id, email, macro_user_id)
        SELECT 'macro|plan-user' || n || '@example.test', 'plan-user' || n || '@example.test', md5('plan-user' || n)::uuid
        FROM generate_series(1, 5000) n;
        INSERT INTO macro_user_info (macro_user_id, first_name, last_name)
        SELECT md5('plan-user' || n)::uuid, 'Person' || n, 'Plan'
        FROM generate_series(1, 5000) n;
        INSERT INTO bots (id, kind, owner_user_id, name, handle)
        SELECT md5('plan-bot' || n)::uuid, 'owned', 'macro|plan-user1@example.test', 'Plan bot ' || n, 'plan-bot-' || n
        FROM generate_series(1, 700) n;
        INSERT INTO comms_channels (id, name, channel_type, owner_id, updated_at)
        SELECT md5('plan-other' || n)::uuid, NULL, 'direct_message', 'macro|plan-user' || n || '@example.test',
               now() - n * interval '1 minute'
        FROM generate_series(1, 4000) n;
        INSERT INTO comms_channel_participants (channel_id, role, user_id)
        SELECT md5('plan-other' || n)::uuid, 'owner'::comms_participant_role, 'macro|plan-user' || (n % 5000 + 1) || '@example.test'
        FROM generate_series(1, 4000) n
        UNION ALL
        SELECT md5('plan-other' || n)::uuid, 'member', 'macro|plan-user' || ((n + 2500) % 5000 + 1) || '@example.test'
        FROM generate_series(1, 4000) n;
        INSERT INTO comms_channels (id, name, channel_type, owner_id, updated_at)
        SELECT md5('plan-mine' || n)::uuid,
               CASE WHEN n > 500 THEN 'Plan channel ' || n END,
               (CASE WHEN n <= 400 THEN 'direct_message' WHEN n <= 500 THEN 'private' ELSE 'public' END)::comms_channel_type,
               'macro|viewer@example.com', now() - n * interval '1 hour'
        FROM generate_series(1, 600) n;
        INSERT INTO comms_channel_participants (channel_id, role, user_id)
        SELECT md5('plan-mine' || n)::uuid, 'owner'::comms_participant_role, 'macro|viewer@example.com'
        FROM generate_series(1, 600) n
        UNION ALL
        SELECT md5('plan-mine' || n)::uuid, 'member',
               CASE WHEN n % 20 = 0 THEN 'bot|' || md5('plan-bot' || n)::uuid
                    ELSE 'macro|plan-user' || n || '@example.test' END
        FROM generate_series(1, 400) n
        UNION ALL
        SELECT md5('plan-mine' || n)::uuid, 'member', 'macro|plan-user' || (n * 3 + k) || '@example.test'
        FROM generate_series(401, 600) n CROSS JOIN generate_series(1, 3) k;
        COMMIT;
        ANALYZE comms_channels;
        ANALYZE comms_channel_participants;
        ANALYZE "User";
        ANALYZE macro_user_info;
        ANALYZE bots;
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// The previous statement joined its matched terms back to the viewer's
/// channels in a nested loop under a generic plan, comparing every channel with
/// every match: seconds for a viewer in a few thousand channels. Under custom
/// and generic plans alike, every table must be read by key and no join may
/// compare more rows than the viewer's channels times the patterns.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_table_is_read_by_key_and_work_stays_within_the_viewers_channels(
    pool: PgPool,
) -> anyhow::Result<()> {
    use sqlx::Row;

    seed_plan_data(&pool).await?;
    let mut connection = pool.acquire().await?;
    sqlx::raw_sql(&format!(
        "PREPARE match_channel_names(text, uuid[], text[], timestamptz, uuid, text[], bool, uuid[], text[], bigint) AS {MATCH_CHANNEL_NAMES_SQL}"
    ))
    .execute(&mut *connection)
    .await?;
    let system_bot_ids = bot_id::SYSTEM_BOTS
        .iter()
        .map(|bot| bot.id.as_uuid().to_string())
        .collect::<Vec<_>>()
        .join(",");
    let system_bot_names = bot_id::SYSTEM_BOTS
        .iter()
        .map(|bot| format!(r#""{}""#, bot.name))
        .collect::<Vec<_>>()
        .join(",");
    let viewer_channels = 600.0;
    let seeded_tables = [
        "comms_channels",
        "comms_channel_participants",
        "User",
        "macro_user_info",
        "bots",
    ];

    for plan_cache_mode in ["force_custom_plan", "force_generic_plan"] {
        sqlx::raw_sql(&format!("SET plan_cache_mode = {plan_cache_mode}"))
            .execute(&mut *connection)
            .await?;
        for patterns in [
            vec!["%person%"],
            vec!["%zzz%"],
            vec!["%zzz%", "%person%", "%plan%"],
        ] {
            let row = sqlx::raw_sql(&format!(
                "EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF, FORMAT JSON) EXECUTE match_channel_names('{VIEWER}', '{{}}', '{{}}', NULL, NULL, '{{{}}}', false, '{{{system_bot_ids}}}', '{{{system_bot_names}}}', 51)",
                patterns.join(",")
            ))
            .fetch_one(&mut *connection)
            .await?;
            let explain: serde_json::Value =
                serde_json::from_str(&row.try_get_unchecked::<String, _>(0)?)?;
            let mut nodes = Vec::new();
            plan_nodes(&explain[0]["Plan"], &mut nodes);
            let context = format!(
                "{plan_cache_mode}, {patterns:?}:\n{}",
                serde_json::to_string_pretty(&explain)?
            );

            for node in &nodes {
                let node_type = node["Node Type"].as_str().unwrap_or_default();
                let relation = node["Relation Name"].as_str().unwrap_or_default();
                assert!(
                    !(node_type == "Seq Scan" && seeded_tables.contains(&relation)),
                    "{relation} is read by key, {context}"
                );
                assert!(
                    !matches!(node_type, "Hash" | "Hash Join" | "Merge Join"),
                    "no join builds or sorts a whole table, {context}"
                );
                // EXPLAIN reports removed rows per loop, rounded to a whole row.
                if let Some(removed_per_loop) = node["Rows Removed by Join Filter"].as_f64() {
                    let loops = node["Actual Loops"].as_f64().unwrap_or(1.0);
                    let bound = viewer_channels * patterns.len() as f64;
                    assert!(
                        removed_per_loop * loops <= bound + loops / 2.0,
                        "a join compared {removed_per_loop} rows in each of {loops} loops, more than {bound} in all, {context}"
                    );
                }
            }
            assert!(
                nodes.iter().any(|node| {
                    node["Node Type"] == "Index Scan" && node["Index Name"] == "comms_channels_pkey"
                }),
                "each of the viewer's channels is looked up by id, {context}"
            );
        }
    }
    Ok(())
}

fn plan_nodes<'a>(node: &'a serde_json::Value, nodes: &mut Vec<&'a serde_json::Value>) {
    nodes.push(node);
    for child in node["Plans"].as_array().into_iter().flatten() {
        plan_nodes(child, nodes);
    }
}
