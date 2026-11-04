use super::*;
use crate::domain::auto_archive::{
    AutoArchiveOverrides, AutoArchivePreferences, AutoArchiveReason, AutoArchiveRepo,
};
use crate::domain::coding_preferences::CodingPreferences;
use crate::domain::model::ArchiveCause;
use crate::domain::pull_request_links::SessionPullRequestLinkRepo;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn preferences_default_off_and_round_trip(pool: PgPool) {
    let repo = test_repo(&pool);
    create_test_bot(&pool).await;
    let owner = user_id(OWNER);
    assert_eq!(
        repo.user_auto_archive_preferences(&owner).await.unwrap(),
        AutoArchivePreferences {
            on_pull_request_merged: false,
            on_runtime_closed: false,
        }
    );
    let coding = CodingPreferences {
        create_tasks: true,
        open_pull_requests: false,
    };
    AgentSessionRepo::set_user_coding_preferences(&repo, &owner, coding)
        .await
        .unwrap();
    repo.set_user_auto_archive_preferences(
        &owner,
        AutoArchivePreferences {
            on_pull_request_merged: true,
            on_runtime_closed: false,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        repo.user_auto_archive_preferences(&owner).await.unwrap(),
        AutoArchivePreferences {
            on_pull_request_merged: true,
            on_runtime_closed: false,
        }
    );
    // Both live on the user's coding preferences; neither write clears the other.
    assert_eq!(
        AgentSessionRepo::user_coding_preferences(&repo, &owner)
            .await
            .unwrap(),
        coding
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn archives_only_when_the_trigger_is_on_for_the_session(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let owner = user_id(OWNER);
    let session = create_session(&repo, new_session(bot, None, None)).await;

    assert!(
        !repo
            .auto_archive(session.id, AutoArchiveReason::RuntimeClosed)
            .await
            .unwrap()
    );

    repo.set_user_auto_archive_preferences(
        &owner,
        AutoArchivePreferences {
            on_pull_request_merged: false,
            on_runtime_closed: true,
        },
    )
    .await
    .unwrap();
    repo.set_session_auto_archive_overrides(
        session.id,
        AutoArchiveOverrides {
            on_pull_request_merged: None,
            on_runtime_closed: Some(false),
        },
    )
    .await
    .unwrap();
    assert!(
        !repo
            .auto_archive(session.id, AutoArchiveReason::RuntimeClosed)
            .await
            .unwrap()
    );
    assert!(
        !repo
            .auto_archive(session.id, AutoArchiveReason::PullRequestMerged)
            .await
            .unwrap()
    );

    repo.set_session_auto_archive_overrides(
        session.id,
        AutoArchiveOverrides {
            on_pull_request_merged: Some(true),
            on_runtime_closed: None,
        },
    )
    .await
    .unwrap();
    assert!(
        repo.auto_archive(session.id, AutoArchiveReason::PullRequestMerged)
            .await
            .unwrap()
    );
    let archive = AgentSessionRepo::get(&repo, session.id)
        .await
        .unwrap()
        .archived
        .unwrap();
    assert_eq!(archive.by, ArchiveCause::PullRequestMerged);
    let settings = repo.session_auto_archive(session.id).await.unwrap();
    assert_eq!(
        settings.overrides,
        AutoArchiveOverrides {
            on_pull_request_merged: Some(true),
            on_runtime_closed: None,
        }
    );
    assert_eq!(
        settings.defaults,
        AutoArchivePreferences {
            on_pull_request_merged: false,
            on_runtime_closed: true,
        }
    );
    assert_eq!(settings.auto_archived_at, Some(archive.at));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_restored_session_is_never_archived_again(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    repo.set_user_auto_archive_preferences(
        &user_id(OWNER),
        AutoArchivePreferences {
            on_pull_request_merged: true,
            on_runtime_closed: true,
        },
    )
    .await
    .unwrap();

    assert!(
        repo.auto_archive(session.id, AutoArchiveReason::RuntimeClosed)
            .await
            .unwrap()
    );
    assert!(
        !repo
            .auto_archive(session.id, AutoArchiveReason::RuntimeClosed)
            .await
            .unwrap()
    );
    AgentSessionRepo::set_archived(&repo, session.id, false)
        .await
        .unwrap();
    for reason in [
        AutoArchiveReason::RuntimeClosed,
        AutoArchiveReason::PullRequestMerged,
    ] {
        assert!(!repo.auto_archive(session.id, reason).await.unwrap());
    }
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .unwrap()
            .archived,
        None
    );
    assert!(
        repo.session_auto_archive(session.id)
            .await
            .unwrap()
            .auto_archived_at
            .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_with_work_in_flight_stays_visible(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    repo.set_user_auto_archive_preferences(
        &user_id(OWNER),
        AutoArchivePreferences {
            on_pull_request_merged: false,
            on_runtime_closed: true,
        },
    )
    .await
    .unwrap();

    for state in ["starting", "running", "blocked", "stopping"] {
        let session = create_session(&repo, new_session(bot, None, None)).await;
        sqlx::query!(
            "UPDATE agent_session SET turn_state = $2 WHERE id = $1",
            session.id.as_uuid(),
            state
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            !repo
                .auto_archive(session.id, AutoArchiveReason::RuntimeClosed)
                .await
                .unwrap(),
            "{state}"
        );
    }

    let queued = create_session(&repo, new_session(bot, None, None)).await;
    sqlx::query!(
        r#"INSERT INTO agent_session_queue (agent_session_id, entries) VALUES ($1, '[{"id": "queued"}]')"#,
        queued.id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !repo
            .auto_archive(queued.id, AutoArchiveReason::RuntimeClosed)
            .await
            .unwrap()
    );

    let answering = create_session(&repo, new_session(bot, None, None)).await;
    let channel = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'direct_message', $2)",
        channel,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO agent_conversation_sessions (session_id, channel_id, bot_id) VALUES ($1, $2, $3)",
        answering.id.as_uuid(),
        channel,
        bot.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !repo
            .auto_archive(answering.id, AutoArchiveReason::RuntimeClosed)
            .await
            .unwrap()
    );

    let idle = create_session(&repo, new_session(bot, None, None)).await;
    sqlx::query!(
        "UPDATE agent_session SET turn_state = 'idle' WHERE id = $1",
        idle.id.as_uuid()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.auto_archive(idle.id, AutoArchiveReason::RuntimeClosed)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sessions_archive_for_pull_requests_once_all_are_closed_and_one_merged(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let owner = user_id(OWNER);
    let session = create_session(&repo, new_session(bot, None, None)).await;
    for (key, number, status) in [
        ("Example/Repo/pull/1", 1, Some("open")),
        ("Example/Repo/pull/2", 2, Some("closed")),
        ("Example/Repo/pull/3", 3, None),
    ] {
        sqlx::query!(
            "INSERT INTO github_pull_request (github_key, number, owner, repo, status) VALUES ($1, $2, 'Example', 'Repo', $3)",
            key,
            number,
            status
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    repo.link_pull_request(session.id, "example/repo/pull/1", &owner)
        .await
        .unwrap();
    repo.link_pull_request(session.id, "example/repo/pull/2", &owner)
        .await
        .unwrap();

    assert!(
        repo.sessions_with_merged_pull_requests("example/repo/pull/2")
            .await
            .unwrap()
            .is_empty()
    );

    sqlx::query!(
        "UPDATE github_pull_request SET status = 'merged' WHERE github_key = 'Example/Repo/pull/1'"
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.sessions_with_merged_pull_requests("EXAMPLE/repo/pull/1")
            .await
            .unwrap(),
        [session.id]
    );

    repo.link_pull_request(session.id, "example/repo/pull/3", &owner)
        .await
        .unwrap();
    assert!(
        repo.sessions_with_merged_pull_requests("example/repo/pull/1")
            .await
            .unwrap()
            .is_empty()
    );

    let only_closed = create_session(&repo, new_session(bot, None, None)).await;
    repo.link_pull_request(only_closed.id, "example/repo/pull/2", &owner)
        .await
        .unwrap();
    assert!(
        repo.sessions_with_merged_pull_requests("example/repo/pull/2")
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_person_archives_as_user_and_restoring_clears_who_archived(pool: PgPool) {
    let repo = test_repo(&pool);
    let bot = create_test_bot(&pool).await;
    let session = create_session(&repo, new_session(bot, None, None)).await;
    assert_eq!(session.archived, None);

    AgentSessionRepo::set_archived(&repo, session.id, true)
        .await
        .unwrap();
    let archive = AgentSessionRepo::get(&repo, session.id)
        .await
        .unwrap()
        .archived
        .unwrap();
    assert_eq!(archive.by, ArchiveCause::User);
    // Archiving again keeps who archived it and when.
    AgentSessionRepo::set_archived(&repo, session.id, true)
        .await
        .unwrap();
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .unwrap()
            .archived,
        Some(archive)
    );

    AgentSessionRepo::set_archived(&repo, session.id, false)
        .await
        .unwrap();
    assert_eq!(
        AgentSessionRepo::get(&repo, session.id)
            .await
            .unwrap()
            .archived,
        None
    );
    assert_eq!(
        repo.session_auto_archive(session.id)
            .await
            .unwrap()
            .auto_archived_at,
        None
    );
}
