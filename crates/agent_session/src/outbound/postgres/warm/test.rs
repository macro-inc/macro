use crate::domain::agent_conversation::{AgentConversation, AgentConversationRepo};
use crate::domain::error::AgentSessionError;
use crate::domain::model::SessionStatus;
use crate::domain::model::{SessionPurpose, SessionVisibility};
use crate::domain::ports::AgentSessionRepo;
use crate::domain::warm::{WarmClaim, WarmMissReason, WarmSessionLifecycle};
use crate::outbound::postgres::test::{OWNER, create_test_bot, new_session, test_repo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::num::NonZeroUsize;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn dm_contexts_stay_hidden_and_cannot_be_claimed_or_expired(pool: PgPool) {
    let bot = create_test_bot(&pool).await;
    let repo =
        test_repo(&pool).with_list_policy(crate::domain::list_visibility::SessionListPolicy {
            hide_agent_dms: true,
        });
    let channel = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'direct_message', $2)",
        channel,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap();
    let conversation = AgentConversation {
        channel_id: channel,
        bot_id: bot,
    };
    let first = repo.current_or_create(conversation).await.unwrap();
    let fresh = repo.start_fresh(conversation).await.unwrap();
    let standalone = repo.create(new_session(bot, None, None)).await.unwrap();
    for (id, purpose) in [
        (first, SessionPurpose::AgentDm),
        (fresh, SessionPurpose::Standalone),
    ] {
        let mut params = new_session(bot, None, None);
        params.id = id;
        params.purpose = purpose;
        // Legacy standalone callers also adopt durable conversation provenance.
        let dm = repo.create(params).await.unwrap();
        assert!(
            !sqlx::query_scalar!(
                "SELECT for_warming FROM agent_session WHERE id = $1",
                id.as_uuid()
            )
            .fetch_one(&pool)
            .await
            .unwrap()
        );
        assert_eq!(repo.get(id).await.unwrap().id, id);
        assert_eq!(
            repo.claim(id, &dm.owner_id, bot, &dm.model, None)
                .await
                .unwrap(),
            WarmClaim::Missed(WarmMissReason::NotWarm)
        );
    }
    let listed = repo
        .recent_for_owner(
            &MacroUserIdStr::parse_from_str(OWNER).unwrap(),
            NonZeroUsize::new(10).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        listed.iter().map(|s| s.id).collect::<Vec<_>>(),
        vec![standalone.id]
    );
    // A corrupt/legacy warm marker must not allow cleanup of either context.
    sqlx::query!("UPDATE agent_session SET for_warming = TRUE, created_at = NOW() - INTERVAL '11 minutes' WHERE id = ANY($1)", &[first.as_uuid(), fresh.as_uuid()])
        .execute(&pool).await.unwrap();
    assert!(repo.expire().await.unwrap().is_empty());
    for id in [first, fresh] {
        let dm = repo.get(id).await.unwrap();
        assert_eq!(dm.status, SessionStatus::NoMessages);
        assert_eq!(
            repo.claim(id, &dm.owner_id, bot, &dm.model, None)
                .await
                .unwrap(),
            WarmClaim::Missed(WarmMissReason::NotWarm)
        );
    }
    assert_eq!(repo.sessions(conversation).await.unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn warm_creation_rejects_a_reserved_conversation(pool: PgPool) {
    let bot = create_test_bot(&pool).await;
    let repo = test_repo(&pool);
    let channel = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'direct_message', $2)",
        channel,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap();
    let id = repo
        .current_or_create(AgentConversation {
            channel_id: channel,
            bot_id: bot,
        })
        .await
        .unwrap();
    let mut params = new_session(bot, None, None);
    params.id = id;
    params.purpose = SessionPurpose::Warm;
    assert!(matches!(
        repo.create(params).await,
        Err(AgentSessionError::InvalidSessionPurpose)
    ));
    assert!(matches!(
        repo.get(id).await,
        Err(AgentSessionError::NotFound(_))
    ));
}

#[test]
fn warm_policy_rejects_message_provenance() {
    assert!(matches!(
        SessionPurpose::Warm.for_creation(false, true),
        Err(AgentSessionError::InvalidSessionPurpose)
    ));
    assert_eq!(
        SessionPurpose::Warm.for_creation(false, false).unwrap(),
        SessionPurpose::Warm
    );
    assert_eq!(
        SessionPurpose::AgentDm.visibility(bot_id::MACRO_NEW_BOT_ID, None, true),
        SessionVisibility::Hidden
    );
    assert_eq!(
        SessionPurpose::AgentDm.visibility(bot_id::MACRO_NEW_BOT_ID, None, false),
        SessionVisibility::Listed
    );
    assert_eq!(
        SessionPurpose::Standalone.visibility(bot_id::MACRO_NEW_BOT_ID, None, true),
        SessionVisibility::Listed
    );
}

#[sqlx::test(migrations = false)]
async fn migration_preserves_old_writers_and_stages_dm_visibility(pool: PgPool) {
    // SQLx clones template1; this test intentionally reconstructs the old schema.
    sqlx::raw_sql(include_str!("legacy_schema.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../../../../macro_db_client/migrations/20261015022720_separate_warm_session_lifecycle.up.sql"))
        .execute(&pool).await.unwrap();
    let before = sqlx::query!("SELECT id, list_hidden, for_warming FROM agent_session ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(
        before[0].for_warming,
        "existing speculative session retained"
    );
    assert!(
        !before[1].list_hidden && !before[2].list_hidden,
        "migration does not expose hidden DMs to old reapers"
    );
    assert!(!before[1].for_warming && !before[2].for_warming);
    assert!(!before[3].list_hidden);
    assert!(
        before[4].list_hidden && !before[4].for_warming,
        "inline mention remains hidden but not warm"
    );
    // Emulate an older writer that omits the marker entirely.
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO agent_session (id, list_hidden) VALUES ($1, TRUE)",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    let warm = sqlx::query_scalar!("SELECT for_warming FROM agent_session WHERE id = $1", id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(warm);
    // Emulate an older claimant. New lifecycle must never reclaim/delete it.
    sqlx::query!(
        "UPDATE agent_session SET list_hidden = FALSE WHERE id = $1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !sqlx::query_scalar!("SELECT for_warming FROM agent_session WHERE id = $1", id)
            .fetch_one(&pool)
            .await
            .unwrap()
    );
    // Once the old reapers are gone, the domain policy backfills both contexts.
    // It writes `visibility`, which a later migration adds and keeps
    // `list_hidden` in step with.
    sqlx::raw_sql(include_str!("../../../../../macro_db_client/migrations/20261022031656_agent_session_source_and_visibility.sql"))
        .execute(&pool).await.unwrap();
    let repo = test_repo(&pool);
    crate::domain::list_visibility::SessionListPolicy {
        hide_agent_dms: false,
    }
    .reconcile(&repo)
    .await
    .unwrap();
    let disabled =
        sqlx::query!("SELECT id, list_hidden, for_warming FROM agent_session ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(!disabled[1].list_hidden && !disabled[2].list_hidden);
    crate::domain::list_visibility::SessionListPolicy {
        hide_agent_dms: true,
    }
    .reconcile(&repo)
    .await
    .unwrap();
    let after = sqlx::query!("SELECT id, list_hidden, for_warming FROM agent_session ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert!(after[1].list_hidden && after[2].list_hidden);
    assert!(!after[1].for_warming && !after[2].for_warming);
    assert!(
        !after[3].list_hidden,
        "unrelated standalone session stays listed"
    );
    assert!(
        after[0].for_warming,
        "legitimate warm lifecycle is unchanged"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_old_claimant_cannot_leave_a_visible_session_eligible_for_cleanup(pool: PgPool) {
    let bot = create_test_bot(&pool).await;
    let repo = test_repo(&pool);
    let mut params = new_session(bot, None, None);
    params.purpose = SessionPurpose::Warm;
    let session = repo.create(params).await.unwrap();
    sqlx::query!(
        "UPDATE agent_session SET list_hidden = FALSE WHERE id = $1",
        session.id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    // Even a stale true marker cannot defeat the visibility invariant.
    sqlx::query!(
        "UPDATE agent_session SET for_warming = TRUE WHERE id = $1",
        session.id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.claim(session.id, &session.owner_id, bot, &session.model, None)
            .await
            .unwrap(),
        WarmClaim::Missed(WarmMissReason::NotWarm)
    );
    sqlx::query!(
        "UPDATE agent_session SET created_at = NOW() - INTERVAL '11 minutes' WHERE id = $1",
        session.id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.expire().await.unwrap().is_empty());
    assert_eq!(
        repo.get(session.id).await.unwrap().status,
        SessionStatus::NoMessages
    );
}
