//! `is_accessor` and `get_users_by_entity_uncached` against real Postgres:
//! the check must agree with the listing, and both must see changes at once.

use crate::domain::{
    models::{AccessError, AccessLevel, EntityType},
    ports::EntityAccessService,
    service::EntityAccessServiceImpl,
};
use crate::outbound::pg_access_repo::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

type Service = EntityAccessServiceImpl<PgAccessRepository>;

// `seed` builds: channel CHANNEL with participants user-a, user-b, user-c;
// call CHANNEL_CALL in it, which also grants user-d directly; and team
// TEAM_ALPHA, owned by OWNER, with TEAM_MEMBER in it.
const CHANNEL: Uuid = Uuid::from_u128(0xc01);
const CHANNEL_CALL: &str = "00000000-0000-0000-0000-0000000ca110";
const USER_A: &str = "macro|user-a@corp.test";
const USER_B: &str = "macro|user-b@corp.test";
const USER_C: &str = "macro|user-c@corp.test";
const USER_D: &str = "macro|user-d@corp.test";
const TEAM_ALPHA: Uuid = Uuid::from_u128(0xea001);
const OWNER: &str = "macro|owner@corp.test";
const TEAM_MEMBER: &str = "macro|member@corp.test";
const OUTSIDER: &str = "macro|outsider@corp.test";
const STRANGER: &str = "macro|stranger@corp.test";
const DIRECT_STORED: &str = "macro|Direct@Corp.test";
const DIRECT: &str = "macro|direct@corp.test";

fn service(pool: &PgPool) -> Service {
    EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()))
}

async fn listed(service: &Service, entity_id: &str, entity_type: EntityType) -> Vec<String> {
    service
        .get_users_by_entity_uncached(entity_id, entity_type)
        .await
        .unwrap()
        .into_iter()
        .map(|user| user.as_ref().to_owned())
        .collect()
}

/// `is_accessor` must equal membership in `get_users_by_entity_uncached`; returns the answer so callers can also pin the expectation.
async fn accessor_matches_listing(
    service: &Service,
    principal: &str,
    entity_id: &str,
    entity_type: EntityType,
) -> bool {
    let is_accessor = service
        .is_accessor(principal, entity_id, entity_type)
        .await
        .unwrap();
    let canonical = MacroUserIdStr::parse_from_str(principal)
        .unwrap()
        .as_ref()
        .to_owned();
    let in_listing = listed(service, entity_id, entity_type)
        .await
        .contains(&canonical);
    assert_eq!(
        is_accessor, in_listing,
        "{principal} on {entity_type:?} {entity_id}: is_accessor disagrees with listing"
    );
    is_accessor
}

async fn insert_user(pool: &PgPool, user_id: &str) {
    let macro_user_id = Uuid::now_v7();
    let email = user_id.trim_start_matches("macro|");
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)"#,
        macro_user_id,
        user_id,
        email,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Users, a team, a channel, and a call in that channel.
async fn seed(pool: &PgPool) {
    for user in [OWNER, TEAM_MEMBER, OUTSIDER] {
        insert_user(pool, user).await;
    }
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Alpha', $2)",
        TEAM_ALPHA,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
        TEAM_MEMBER,
        TEAM_ALPHA,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'channel', 'public', $2)",
        CHANNEL,
        USER_A,
    )
    .execute(pool)
    .await
    .unwrap();
    for user in [USER_A, USER_B, USER_C] {
        sqlx::query!(
            "INSERT INTO comms_channel_participants (channel_id, role, user_id) VALUES ($1, 'member', $2)",
            CHANNEL,
            user,
        )
        .execute(pool)
        .await
        .unwrap();
    }
    let share_permission_id = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id) VALUES ($1)"#,
        share_permission_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "ChannelSharePermission" (share_permission_id, channel_id, access_level)
           VALUES ($1, $2, 'view')"#,
        share_permission_id,
        CHANNEL.to_string(),
    )
    .execute(pool)
    .await
    .unwrap();
    let call = Uuid::parse_str(CHANNEL_CALL).unwrap();
    sqlx::query!(
        "INSERT INTO calls (id, channel_id, room_name, created_by, share_permission_id)
         VALUES ($1, $2, $3, $4, $5)",
        call,
        CHANNEL,
        CHANNEL.to_string(),
        USER_A,
        share_permission_id,
    )
    .execute(pool)
    .await
    .unwrap();
    grant(pool, call, "call", &CHANNEL.to_string(), "channel").await;
    grant(pool, call, "call", USER_D, "user").await;
}

async fn grant(pool: &PgPool, entity_id: Uuid, entity_type: &str, source: &str, kind: &str) {
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, $2, $3, $4::text::entity_access_source_type, 'view')"#,
        entity_id,
        entity_type,
        source,
        kind,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn leave(pool: &PgPool, channel_id: Uuid, principal: &str) {
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1 AND user_id = $2",
        channel_id,
        principal,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A document readable by anyone with its link, owned by the team owner.
async fn insert_public_document(pool: &PgPool) -> Uuid {
    let document_id = Uuid::new_v4();
    let share_permission_id = Uuid::new_v4().to_string();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, 'doc', $2)"#,
        document_id.to_string(),
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel")
           VALUES ($1, 'PUBLIC', 'view')"#,
        share_permission_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId") VALUES ($1, $2)"#,
        document_id.to_string(),
        share_permission_id,
    )
    .execute(pool)
    .await
    .unwrap();
    document_id
}

/// A database with one table and one row; returns `(database_id, row_id)`.
async fn insert_row(pool: &PgPool) -> (Uuid, Uuid) {
    let database_id = Uuid::now_v7();
    let table_id = Uuid::now_v7();
    let row_id = Uuid::now_v7();
    sqlx::query!(
        r#"WITH storage AS (INSERT INTO databases (id) VALUES ($1) RETURNING id)
           INSERT INTO database_entities (database_id, name, user_id)
           SELECT id, 'db', $2 FROM storage"#,
        database_id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 't', 'a')"#,
        table_id,
        database_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_rows (id, table_id, position) VALUES ($1, $2, 'a')"#,
        row_id,
        table_id,
    )
    .execute(pool)
    .await
    .unwrap();
    (database_id, row_id)
}

/// An email thread in a link owned by `owner`.
async fn insert_thread(pool: &PgPool, owner: &str) -> Uuid {
    let link_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, 'inbox@corp.test', 'GMAIL')"#,
        link_id,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO email_threads (id, link_id) VALUES ($1, $2)"#,
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
    thread_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn document_accessors_match_the_listing(pool: PgPool) {
    seed(&pool).await;
    let service = service(&pool);
    let document = insert_public_document(&pool).await;
    grant(&pool, document, "document", DIRECT_STORED, "user").await;
    grant(&pool, document, "document", &CHANNEL.to_string(), "channel").await;
    grant(&pool, document, "document", &TEAM_ALPHA.to_string(), "team").await;
    leave(&pool, CHANNEL, USER_C).await;
    let document = document.to_string();

    // Direct grant, stored with mixed case, found under either spelling.
    assert!(accessor_matches_listing(&service, DIRECT, &document, EntityType::Document).await);
    assert!(
        accessor_matches_listing(&service, DIRECT_STORED, &document, EntityType::Document).await
    );
    // Member of a granting channel; a participant who left is not.
    assert!(accessor_matches_listing(&service, USER_B, &document, EntityType::Document).await);
    assert!(!accessor_matches_listing(&service, USER_C, &document, EntityType::Document).await);
    // Member of a granting team.
    assert!(accessor_matches_listing(&service, TEAM_MEMBER, &document, EntityType::Document).await);

    // Link sharing gives the outsider View, but no explicit access.
    let outsider = MacroUserIdStr::parse_from_str(OUTSIDER).unwrap();
    assert_eq!(
        service
            .get_access_level(Some(&outsider), &document, EntityType::Document)
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    assert!(!accessor_matches_listing(&service, OUTSIDER, &document, EntityType::Document).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_and_call_accessors_are_active_participants(pool: PgPool) {
    seed(&pool).await;
    let service = service(&pool);
    leave(&pool, CHANNEL, USER_C).await;
    let channel = CHANNEL.to_string();

    assert!(accessor_matches_listing(&service, USER_A, &channel, EntityType::Channel).await);
    assert!(!accessor_matches_listing(&service, USER_C, &channel, EntityType::Channel).await);
    assert!(!accessor_matches_listing(&service, OUTSIDER, &channel, EntityType::Channel).await);

    // A channel call's audience is its channel; user-d's direct call grant
    // does not count while the call has a channel.
    assert!(accessor_matches_listing(&service, USER_B, CHANNEL_CALL, EntityType::Call).await);
    assert!(!accessor_matches_listing(&service, USER_D, CHANNEL_CALL, EntityType::Call).await);
    assert!(!accessor_matches_listing(&service, USER_C, CHANNEL_CALL, EntityType::Call).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn database_row_accessors_are_its_databases(pool: PgPool) {
    seed(&pool).await;
    let service = service(&pool);
    let (database, row) = insert_row(&pool).await;
    grant(&pool, database, "database", TEAM_MEMBER, "user").await;
    let row = row.to_string();

    assert!(accessor_matches_listing(&service, TEAM_MEMBER, &row, EntityType::DatabaseRow).await);
    assert!(!accessor_matches_listing(&service, OUTSIDER, &row, EntityType::DatabaseRow).await);
    assert!(
        !service
            .is_accessor(
                TEAM_MEMBER,
                &Uuid::now_v7().to_string(),
                EntityType::DatabaseRow
            )
            .await
            .unwrap(),
        "a missing row has no accessors"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_thread_accessors_include_the_inbox_owner(pool: PgPool) {
    seed(&pool).await;
    let service = service(&pool);
    let thread = insert_thread(&pool, TEAM_MEMBER).await;
    grant(&pool, thread, "email_thread", OUTSIDER, "user").await;
    let thread = thread.to_string();

    assert!(
        accessor_matches_listing(&service, TEAM_MEMBER, &thread, EntityType::EmailThread).await
    );
    assert!(accessor_matches_listing(&service, OUTSIDER, &thread, EntityType::EmailThread).await);
    assert!(!accessor_matches_listing(&service, STRANGER, &thread, EntityType::EmailThread).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn is_accessor_rejects_bad_input(pool: PgPool) {
    seed(&pool).await;
    let service = service(&pool);
    let document = Uuid::now_v7().to_string();

    for (principal, entity_id, entity_type) in [
        ("not-a-principal", document.as_str(), EntityType::Document),
        // Only Macro user ids are principals here.
        (
            "bot|0a0b0c0d-0000-0000-0000-00000000a1a1",
            document.as_str(),
            EntityType::Document,
        ),
        (TEAM_MEMBER, "not-a-uuid", EntityType::Document),
        (TEAM_MEMBER, "not-a-uuid", EntityType::Channel),
        (TEAM_MEMBER, document.as_str(), EntityType::Team),
        (TEAM_MEMBER, document.as_str(), EntityType::User),
    ] {
        assert!(
            matches!(
                service.is_accessor(principal, entity_id, entity_type).await,
                Err(AccessError::BadRequest(_))
            ),
            "{principal} {entity_id} {entity_type:?}"
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn participant_removal_is_visible_immediately(pool: PgPool) {
    seed(&pool).await;
    // The process cache is compiled out under test, so this pins the read
    // path: the uncached listing and is_accessor query the database each call.
    let service = service(&pool);
    let document = Uuid::now_v7();
    grant(&pool, document, "document", &CHANNEL.to_string(), "channel").await;
    let document = document.to_string();
    let channel = CHANNEL.to_string();
    let user_b = USER_B.to_owned();

    for (entity_id, entity_type) in [
        (channel.as_str(), EntityType::Channel),
        (CHANNEL_CALL, EntityType::Call),
        (document.as_str(), EntityType::Document),
    ] {
        assert!(
            listed(&service, entity_id, entity_type)
                .await
                .contains(&user_b)
        );
        assert!(accessor_matches_listing(&service, USER_B, entity_id, entity_type).await);
    }

    leave(&pool, CHANNEL, USER_B).await;

    for (entity_id, entity_type) in [
        (channel.as_str(), EntityType::Channel),
        (CHANNEL_CALL, EntityType::Call),
        (document.as_str(), EntityType::Document),
    ] {
        assert!(
            !listed(&service, entity_id, entity_type)
                .await
                .contains(&user_b)
        );
        assert!(!accessor_matches_listing(&service, USER_B, entity_id, entity_type).await);
    }
}

async fn grant_at(pool: &PgPool, entity_id: Uuid, source: &str, kind: &str, level: &str) {
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, 'document', $2, $3::text::entity_access_source_type, $4::text::"AccessLevel")"#,
        entity_id,
        source,
        kind,
        level,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Accessors at a level come from the grants' own levels in one read: an
/// editor directly or through a channel or team grant at edit, never a viewer
/// or a link-share outsider.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn accessors_at_least_follow_the_grant_levels(pool: PgPool) {
    seed(&pool).await;
    let service = service(&pool);
    let document = insert_public_document(&pool).await;
    grant_at(&pool, document, DIRECT_STORED, "user", "edit").await;
    grant_at(&pool, document, USER_D, "user", "view").await;
    grant_at(&pool, document, &CHANNEL.to_string(), "channel", "edit").await;
    grant_at(&pool, document, &TEAM_ALPHA.to_string(), "team", "comment").await;
    leave(&pool, CHANNEL, USER_C).await;
    let document = document.to_string();

    let mut editors: Vec<String> = service
        .get_users_by_entity_at_least(&document, EntityType::Document, AccessLevel::Edit)
        .await
        .unwrap()
        .into_iter()
        .map(|user| user.as_ref().to_owned())
        .collect();
    editors.sort();
    let mut commenters: Vec<String> = service
        .get_users_by_entity_at_least(&document, EntityType::Document, AccessLevel::Comment)
        .await
        .unwrap()
        .into_iter()
        .map(|user| user.as_ref().to_owned())
        .collect();
    commenters.sort();

    assert_eq!(editors, vec![DIRECT, USER_A, USER_B]);
    assert!(commenters.contains(&TEAM_MEMBER.to_owned()));
    assert!(!commenters.contains(&USER_D.to_owned()), "a viewer");
    assert!(
        !commenters.contains(&OUTSIDER.to_owned()),
        "link share only"
    );
    assert!(!commenters.contains(&USER_C.to_owned()), "left the channel");
}
