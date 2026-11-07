use super::super::team_feed::{TeamScan, teammate_feed};
use super::*;

const VIEWER: &str = "macro|viewer@example.com";
const ALICE: &str = "macro|alice@example.com";
const BOB: &str = "macro|bob@example.com";
const OUTSIDER: &str = "macro|outsider@example.com";
const LONER: &str = "macro|loner@example.com";

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        id,
    )
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("user should insert");
}

async fn insert_team(pool: &PgPool, members: &[&str]) -> Uuid {
    let team_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO team (id, owner_id, name) VALUES ($1, $2, 'team')"#,
        team_id,
        members[0],
    )
    .execute(pool)
    .await
    .expect("team should insert");
    for member in members {
        sqlx::query!(
            r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')"#,
            *member,
            team_id,
        )
        .execute(pool)
        .await
        .expect("team member should insert");
    }
    team_id
}

/// Grants `source` access to an entity, as sharing writes it.
async fn grant(
    pool: &PgPool,
    entity_type: &str,
    entity_id: Uuid,
    source_type: &str,
    source_id: &str,
    access_level: &str,
) {
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, $2, $3, $4::text::entity_access_source_type, $5::text::"AccessLevel")
        "#,
        entity_id,
        entity_type,
        source_id,
        source_type,
        access_level,
    )
    .execute(pool)
    .await
    .expect("grant should insert");
}

/// A channel with `active` participants and `left` former ones.
async fn insert_channel(pool: &PgPool, active: &[&str], left: &[&str]) -> Uuid {
    let channel_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'private', $2)"#,
        channel_id,
        ALICE,
    )
    .execute(pool)
    .await
    .expect("channel should insert");
    for (users, has_left) in [(active, false), (left, true)] {
        for user_id in users {
            sqlx::query!(
                r#"
                INSERT INTO comms_channel_participants (channel_id, role, user_id, left_at)
                VALUES ($1, 'member', $2, CASE WHEN $3 THEN now() END)
                "#,
                channel_id,
                *user_id,
                has_left,
            )
            .execute(pool)
            .await
            .expect("participant should insert");
        }
    }
    channel_id
}

/// A connected inbox owned by `owner`.
async fn insert_inbox(pool: &PgPool, owner: &str) -> Uuid {
    let link_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2::text, $2::text, $2::text, 'GMAIL')
        "#,
        link_id,
        owner,
    )
    .execute(pool)
    .await
    .expect("email link should insert");
    link_id
}

async fn insert_thread(pool: &PgPool, link_id: Uuid) -> Uuid {
    let thread_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_threads (id, link_id) VALUES ($1, $2)"#,
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .expect("thread should insert");
    thread_id
}

async fn insert_call(pool: &PgPool, channel_id: Option<Uuid>) -> Uuid {
    let call_id = Uuid::now_v7();
    let share_permission_id = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id) VALUES ($1)"#,
        share_permission_id,
    )
    .execute(pool)
    .await
    .expect("share permission should insert");
    sqlx::query!(
        r#"
        INSERT INTO call_entities (id, user_id, created_via, share_permission_id, channel_id)
        VALUES ($1, $2, 'manual', $3, $4)
        "#,
        call_id,
        ALICE,
        share_permission_id,
        channel_id,
    )
    .execute(pool)
    .await
    .expect("call should insert");
    call_id
}

/// `subject` edited an entity at `seconds` past the base time.
fn edit(
    source_event: u128,
    subject: &str,
    entity_type: model_entity::EntityType,
    entity_id: impl ToString,
    seconds: i64,
) -> Activity {
    Activity::common(
        Uuid::from_u128(source_event),
        0,
        Actor::new_from_user(user(subject)),
        Some(user(subject)),
        entity_type,
        entity_id.to_string(),
        CommonAction::Edited,
        base_time() + chrono::Duration::seconds(seconds),
    )
}

fn entity_ids(page: &ActivityFeedPage) -> Vec<String> {
    page.records
        .iter()
        .map(|record| record.entity_id.clone())
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn teammate_feed_shows_teammates_rows_on_entities_shared_with_the_viewer(pool: PgPool) {
    use model_entity::EntityType as E;

    for id in [VIEWER, ALICE, BOB, OUTSIDER, LONER] {
        insert_user(&pool, id).await;
    }
    let team = insert_team(&pool, &[VIEWER, ALICE, BOB]).await;
    insert_team(&pool, &[OUTSIDER]).await;
    let joined = insert_channel(&pool, &[VIEWER, ALICE], &[]).await;
    let left = insert_channel(&pool, &[ALICE], &[VIEWER]).await;
    let other_channel = insert_channel(&pool, &[ALICE, BOB], &[]).await;
    let (team_source, joined_source, left_source) =
        (team.to_string(), joined.to_string(), left.to_string());

    let [
        granted_doc,
        team_doc,
        channel_doc,
        left_channel_doc,
        link_only_doc,
        team_project,
        form,
    ] = std::array::from_fn(|_| Uuid::now_v7());
    grant(&pool, "document", granted_doc, "user", VIEWER, "view").await;
    grant(&pool, "document", team_doc, "team", &team_source, "view").await;
    grant(
        &pool,
        "document",
        channel_doc,
        "channel",
        &joined_source,
        "view",
    )
    .await;
    grant(
        &pool,
        "document",
        left_channel_doc,
        "channel",
        &left_source,
        "view",
    )
    .await;
    // Sharing with a teammate, or by link, puts no row in the viewer's audience.
    grant(&pool, "document", link_only_doc, "user", ALICE, "owner").await;
    grant(&pool, "project", team_project, "team", &team_source, "edit").await;
    // Form rows name respondents, so they stay out even for editors.
    grant(&pool, "form", form, "user", VIEWER, "edit").await;

    let viewer_inbox = insert_inbox(&pool, VIEWER).await;
    let alice_inbox = insert_inbox(&pool, ALICE).await;
    let viewers_thread = insert_thread(&pool, viewer_inbox).await;
    let shared_thread = insert_thread(&pool, alice_inbox).await;
    let private_thread = insert_thread(&pool, alice_inbox).await;
    grant(&pool, "email_thread", shared_thread, "user", VIEWER, "view").await;

    let channel_call = insert_call(&pool, Some(joined)).await;
    let direct_call = insert_call(&pool, None).await;
    let uninvited_call = insert_call(&pool, None).await;
    grant(&pool, "call", direct_call, "user", VIEWER, "view").await;

    let repo = PgActivityRepo::new(pool.clone());
    repo.insert_activities(&[
        edit(1, ALICE, E::Document, granted_doc, 1),
        edit(2, BOB, E::Document, team_doc, 2),
        edit(3, ALICE, E::Document, channel_doc, 3),
        edit(4, ALICE, E::Document, left_channel_doc, 4),
        edit(5, ALICE, E::Document, link_only_doc, 5),
        edit(6, BOB, E::Project, team_project, 6),
        edit(7, ALICE, E::Form, form, 7),
        edit(8, ALICE, E::Channel, joined, 8),
        edit(9, BOB, E::Channel, other_channel, 9),
        edit(10, ALICE, E::EmailThread, viewers_thread, 10),
        edit(11, ALICE, E::EmailThread, shared_thread, 11),
        edit(12, ALICE, E::EmailThread, private_thread, 12),
        // A malformed id hides its row instead of failing the page.
        edit(13, ALICE, E::EmailThread, "not-a-uuid", 13),
        edit(14, ALICE, E::Call, channel_call, 14),
        edit(15, BOB, E::Call, direct_call, 15),
        edit(16, BOB, E::Call, uninvited_call, 16),
        // Neither the viewer's own rows nor an outsider's belong here.
        edit(17, VIEWER, E::Document, granted_doc, 17),
        edit(18, OUTSIDER, E::Document, team_doc, 18),
    ])
    .await
    .unwrap();

    let page = repo.teammate_feed(VIEWER, None, nz(50)).await.unwrap();

    assert_eq!(
        entity_ids(&page),
        [
            direct_call,
            channel_call,
            shared_thread,
            viewers_thread,
            joined,
            team_project,
            channel_doc,
            team_doc,
            granted_doc,
        ]
        .map(|id| id.to_string())
    );
    assert_eq!(page.next, None, "exhausted feed carries no cursor");

    let alone = repo.teammate_feed(OUTSIDER, None, nz(10)).await.unwrap();
    assert!(alone.records.is_empty(), "a team of one has no teammates");
    let teamless = repo.teammate_feed(LONER, None, nz(10)).await.unwrap();
    assert!(teamless.records.is_empty());
    assert_eq!(teamless.next, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn teammate_feed_pages_past_capped_scans_without_skipping_rows(pool: PgPool) {
    for id in [VIEWER, ALICE, BOB] {
        insert_user(&pool, id).await;
    }
    let team = insert_team(&pool, &[VIEWER, ALICE, BOB]).await;
    let shared = Uuid::now_v7();
    grant(&pool, "document", shared, "team", &team.to_string(), "view").await;
    let hidden = Uuid::now_v7();

    // Alice's history is mostly hidden; Bob's is mostly visible. Rows
    // interleave in time so both scans bound every page.
    let pattern = [
        (ALICE, false),
        (BOB, true),
        (ALICE, false),
        (ALICE, false),
        (BOB, false),
        (ALICE, true),
        (BOB, true),
        (ALICE, false),
        (ALICE, false),
        (ALICE, false),
        (BOB, true),
        (ALICE, true),
        (BOB, false),
        (BOB, true),
        (ALICE, false),
        (ALICE, true),
    ];
    let rows: Vec<Activity> = pattern
        .iter()
        .enumerate()
        .map(|(n, &(subject, visible))| {
            let entity = if visible { shared } else { hidden };
            let n = n as u128 + 1;
            edit(
                n,
                subject,
                model_entity::EntityType::Document,
                entity,
                n as i64,
            )
        })
        .collect();
    PgActivityRepo::new(pool.clone())
        .insert_activities(&rows)
        .await
        .unwrap();
    let mut expected: Vec<Uuid> = rows
        .iter()
        .filter(|row| row.entity_id == shared.to_string())
        .map(|row| row.id)
        .collect();
    expected.reverse();

    // Two raw rows per teammate per page: every page stops at a frontier.
    let scan = TeamScan {
        page_budget: 4,
        min_per_teammate: 2,
    };
    let mut seen = Vec::new();
    let mut short_pages = 0;
    let mut cursor = None;
    for _ in 0..pattern.len() {
        let page = teammate_feed(&pool, VIEWER, cursor, nz(2), scan)
            .await
            .unwrap();
        if page.records.len() < 2 && page.next.is_some() {
            short_pages += 1;
        }
        seen.extend(page.records.iter().map(|record| record.id));
        cursor = page.next;
        if cursor.is_none() {
            break;
        }
    }

    assert_eq!(cursor, None, "paging reaches the end");
    assert_eq!(seen, expected, "every visible row, once, newest first");
    assert!(short_pages > 0, "the scan cap produced short pages");
}
