//! Live-database regressions for the agent access transactions.
use super::*;
use crate::{
    domain::{agent::ports::RequestLimits, ports::Repository},
    outbound::postgres::test::support::folder_fixture,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const LIMITS: RequestLimits = RequestLimits {
    denied_cooldown: chrono::TimeDelta::hours(1),
    max_new_requests: 20,
    window: chrono::TimeDelta::hours(1),
};

async fn account(pool: &PgPool, id: &str, agent: bool) -> MacroUserIdStr<'static> {
    let email = id.strip_prefix("macro|").expect("fixture prefix");
    let account = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES($1,$2,$2,$3)",
        account,
        email,
        format!("fixture-{account}")
    )
    .execute(pool)
    .await
    .expect("account");
    sqlx::query!(
        r#"INSERT INTO "User"(id,email,macro_user_id,"isAgent") VALUES($1,$2,$3,$4)"#,
        id,
        email,
        account,
        agent
    )
    .execute(pool)
    .await
    .expect("user");
    MacroUserIdStr::parse_from_str(id)
        .expect("fixture")
        .into_owned()
}

fn request(record: &Record, agent: &MacroUserIdStr<'static>, limits: RequestLimits) -> NewRequest {
    NewRequest {
        team: record.metadata.team_id,
        item: record.metadata.id,
        agent: agent.clone(),
        wake: crate::domain::agent::WakeId(Uuid::now_v7()),
        permission: Permission::View,
        human_creator: Some(record.user_id.clone()),
        request_id: Uuid::now_v7(),
        item_name: record.metadata.name.clone(),
        limits,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn requests_dedupe_rate_limit_and_notify_only_current_reviewers(pool: PgPool) {
    let (repository, owner, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let agent = account(&pool, "macro|agent@example.test", true).await;
    let teammate = account(&pool, "macro|teammate@example.test", false).await;
    sqlx::query!(
        "INSERT INTO team_user(user_id,team_id,team_role) VALUES($1,$2,'member')",
        teammate.as_ref(),
        team.0
    )
    .execute(&pool)
    .await
    .expect("teammate");

    let RequestOutcome::Created(created) = repository
        .request(request(&record, &agent, LIMITS))
        .await
        .expect("request")
    else {
        panic!("expected a new request");
    };
    let RequestOutcome::Deduplicated(again) = repository
        .request(request(&record, &agent, LIMITS))
        .await
        .expect("repeat")
    else {
        panic!("expected the pending request");
    };
    assert_eq!(
        again.request.map(|request| request.id),
        created.request.map(|request| request.id)
    );

    // Renaming after the request does not change what reviewers are shown.
    let mut renamed = record.clone();
    renamed.metadata.name = "Renamed privately".into();
    repository
        .save(&renamed, Some(renamed.metadata.version))
        .await
        .expect("rename");
    let events = AgentRepository::undelivered(&repository)
        .await
        .expect("events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].item_name, record.metadata.name);
    let reviewers: Vec<String> = events[0]
        .reviewers
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(reviewers, [owner.user_id.to_string()]);

    // The audit-backed rate limit counts new requests only.
    let strict = RequestLimits {
        max_new_requests: 1,
        ..LIMITS
    };
    let mut second = record.clone();
    second.metadata.id = ItemId(Uuid::now_v7());
    second.revision = 0;
    repository.save(&second, None).await.expect("second item");
    let limited = repository
        .request(request(&second, &agent, strict))
        .await
        .expect("limited");
    assert!(matches!(limited, RequestOutcome::RetryAt(_)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn approval_commits_grant_audit_and_event_together_and_is_compare_and_set(pool: PgPool) {
    let (repository, owner, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let agent = account(&pool, "macro|agent@example.test", true).await;
    let RequestOutcome::Created(created) = repository
        .request(request(&record, &agent, LIMITS))
        .await
        .expect("request")
    else {
        panic!("expected a new request");
    };
    let pending = created.request.expect("pending");
    let mut granted = record.clone();
    granted.grants.push(Grant {
        kind: GranteeKind::Agent,
        id: agent.to_string(),
        permission: Permission::Edit,
    });
    let transition = AccessTransition {
        record: granted,
        agent: agent.clone(),
        approved: true,
        expected: Expected::Request {
            id: pending.id,
            revision: pending.revision,
        },
        request_status: Some(StoredRequestStatus::Approved),
        permission_changed: true,
        reviewer: owner.user_id.clone(),
        action: AgentAction::AgentAccessApprove,
    };
    let approved = repository
        .transition(transition.clone())
        .await
        .expect("approve");
    assert!(approved.approved);
    assert_eq!(approved.permission_revision, 1);
    let stored = repository
        .get(team, record.metadata.id)
        .await
        .expect("item");
    assert!(
        stored
            .grants
            .iter()
            .any(|grant| matches!(grant.kind, GranteeKind::Agent)
                && grant.id == agent.as_ref()
                && grant.permission == Permission::Edit)
    );
    let audits = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM password_activity WHERE team_id=$1 AND item_id=$2 AND action='agent_access_approve' AND user_id=$3 AND agent_user_id=$4",
        team.0,
        record.metadata.id.0,
        owner.user_id.as_ref(),
        agent.as_ref()
    )
    .fetch_one(&pool)
    .await
    .expect("audit");
    assert_eq!(audits, 1);

    // A replay of the same review is stale and changes nothing.
    let replayed = repository.transition(transition).await;
    assert!(matches!(replayed, Err(Error::Conflict)));
    let events = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM password_agent_access_events WHERE item_id=$1 AND status='approved'",
        record.metadata.id.0
    )
    .fetch_one(&pool)
    .await
    .expect("events");
    assert_eq!(events, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agent_intents_bind_their_publisher_and_audit_with_completion(pool: PgPool) {
    let (repository, owner, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let agent = account(&pool, "macro|agent@example.test", true).await;
    let operation = Uuid::now_v7();
    let wake = Uuid::now_v7();
    let publisher = IntentAgent {
        agent: agent.clone(),
        wake: crate::domain::agent::WakeId(wake),
        action: AgentAction::AgentUpdate,
    };
    let mut next = record.clone();
    next.metadata.version = 2;

    // No Agent Edit grant yet: the update cannot be published.
    let unauthorized = AgentRepository::stage(&repository, operation, &next, &publisher).await;
    assert!(matches!(unauthorized, Err(Error::Forbidden)));

    let mut granted = record.clone();
    granted.grants.push(Grant {
        kind: GranteeKind::Agent,
        id: agent.to_string(),
        permission: Permission::Edit,
    });
    repository
        .transition(AccessTransition {
            record: granted,
            agent: agent.clone(),
            approved: true,
            expected: Expected::PermissionRevision(0),
            request_status: None,
            permission_changed: true,
            reviewer: owner.user_id.clone(),
            action: AgentAction::AgentAccessApprove,
        })
        .await
        .expect("grant");
    let current = repository
        .get(team, record.metadata.id)
        .await
        .expect("item");
    let mut next = current.clone();
    next.metadata.version = 2;
    AgentRepository::stage(&repository, operation, &next, &publisher)
        .await
        .expect("publish");

    // A human, or the same agent under another action, cannot alias it.
    let human = Repository::stage(&repository, operation, &next, &owner.user_id).await;
    assert!(matches!(human, Err(Error::Conflict)));
    let create = IntentAgent {
        action: AgentAction::AgentCreate,
        ..publisher.clone()
    };
    let aliased = AgentRepository::stage(&repository, operation, &next, &create).await;
    assert!(matches!(aliased, Err(Error::Conflict)));
    // The same publisher retrying with a new wake keeps the original wake.
    let retry = IntentAgent {
        wake: crate::domain::agent::WakeId(Uuid::now_v7()),
        ..publisher
    };
    AgentRepository::stage(&repository, operation, &next, &retry)
        .await
        .expect("retry");

    // Whoever reconciles commits metadata and the agent audit together.
    repository
        .save_reconciled(&next, Some(1), operation)
        .await
        .expect("reconcile");
    let audit = sqlx::query!(
        "SELECT user_id,wake_id FROM password_activity WHERE team_id=$1 AND item_id=$2 AND id=$3 AND action='agent_update'",
        team.0,
        record.metadata.id.0,
        operation
    )
    .fetch_one(&pool)
    .await
    .expect("agent audit");
    assert_eq!(audit.user_id, agent.as_ref());
    assert_eq!(audit.wake_id, Some(wake));
    let completed = sqlx::query_scalar!(
        "SELECT completed_at IS NOT NULL AS \"completed!\" FROM password_write_intents WHERE operation_id=$1",
        operation
    )
    .fetch_one(&pool)
    .await
    .expect("intent");
    assert!(completed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agent_enrollment_staging_rejects_foreign_or_settled_keys(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let agent = account(&pool, "macro|agent@example.test", true).await;
    let mut other = record.clone();
    other.metadata.id = ItemId(Uuid::now_v7());
    other.revision = 0;
    repository.save(&other, None).await.expect("other item");
    let key = TotpKeyId(Uuid::now_v7());
    let wake = Uuid::now_v7();
    let publisher = IntentAgent {
        agent: agent.clone(),
        wake: crate::domain::agent::WakeId(wake),
        action: AgentAction::AgentTotpSetup,
    };
    AgentRepository::stage_totp(&repository, team, record.metadata.id, key, &publisher)
        .await
        .expect("stage");
    let foreign =
        AgentRepository::stage_totp(&repository, team, other.metadata.id, key, &publisher).await;
    assert!(matches!(foreign, Err(Error::Conflict)));
    let resumed = IntentAgent {
        wake: crate::domain::agent::WakeId(Uuid::now_v7()),
        ..publisher.clone()
    };
    AgentRepository::stage_totp(&repository, team, record.metadata.id, key, &resumed)
        .await
        .expect("resume own pending setup");
    let retained = sqlx::query_scalar!(
        "SELECT wake_id FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",
        team.0,
        key.0
    )
    .fetch_one(&pool)
    .await
    .expect("enrollment");
    assert_eq!(retained, Some(wake));

    // Activation audits the retained identity in the same transaction.
    let revision = repository
        .get(team, record.metadata.id)
        .await
        .expect("item")
        .revision;
    repository
        .activate_totp(team, record.metadata.id, key, revision)
        .await
        .expect("activate");
    let audited = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM password_activity WHERE team_id=$1 AND item_id=$2 AND id=$3 AND action='agent_totp_setup' AND wake_id=$4",
        team.0,
        record.metadata.id.0,
        key.0,
        wake
    )
    .fetch_one(&pool)
    .await
    .expect("audit");
    assert_eq!(audited, 1);
    let settled =
        AgentRepository::stage_totp(&repository, team, record.metadata.id, key, &publisher).await;
    assert!(matches!(settled, Err(Error::Conflict)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deferred_event_yields_to_due_events(pool: PgPool) {
    let (repository, _, record) = folder_fixture(pool.clone()).await;
    let agent = account(&pool, "macro|agent@example.test", true).await;
    repository
        .request(request(&record, &agent, LIMITS))
        .await
        .expect("first");
    let mut second = record.clone();
    second.metadata.id = ItemId(Uuid::now_v7());
    second.revision = 0;
    repository.save(&second, None).await.expect("second item");
    repository
        .request(request(&second, &agent, LIMITS))
        .await
        .expect("second");
    let events = AgentRepository::undelivered(&repository)
        .await
        .expect("due");
    assert_eq!(events.len(), 2);
    repository.defer(events[0].id).await.expect("defer");
    let due = AgentRepository::undelivered(&repository)
        .await
        .expect("due");
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].id, events[1].id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn staging_refuses_an_operation_id_already_naming_an_audit_entry(pool: PgPool) {
    let (repository, owner, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let agent = account(&pool, "macro|agent@example.test", true).await;
    let pending = request(&record, &agent, LIMITS);
    let reused = pending.request_id;
    let RequestOutcome::Created(created) = repository.request(pending).await.expect("request")
    else {
        panic!("expected a new request");
    };
    let mut granted = record.clone();
    granted.grants.push(Grant {
        kind: GranteeKind::Agent,
        id: agent.to_string(),
        permission: Permission::Edit,
    });
    let stored = created.request.expect("pending");
    repository
        .transition(AccessTransition {
            record: granted,
            agent: agent.clone(),
            approved: true,
            expected: Expected::Request {
                id: stored.id,
                revision: stored.revision,
            },
            request_status: Some(StoredRequestStatus::Approved),
            permission_changed: true,
            reviewer: owner.user_id.clone(),
            action: AgentAction::AgentAccessApprove,
        })
        .await
        .expect("approve");
    let current = repository
        .get(team, record.metadata.id)
        .await
        .expect("item");
    let mut next = current.clone();
    next.metadata.version = 2;
    let update = IntentAgent {
        agent: agent.clone(),
        wake: crate::domain::agent::WakeId(Uuid::now_v7()),
        action: AgentAction::AgentUpdate,
    };

    // The request id is taken by the request's audit entry: conflict, no intent.
    let staged = AgentRepository::stage(&repository, reused, &next, &update).await;
    assert!(matches!(staged, Err(Error::Conflict)));
    let intents = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM password_write_intents WHERE operation_id=$1",
        reused
    )
    .fetch_one(&pool)
    .await
    .expect("intents");
    assert_eq!(intents, 0);

    // Enrollment staging refuses the same id and inserts nothing.
    let totp = IntentAgent {
        action: AgentAction::AgentTotpSetup,
        ..update.clone()
    };
    let enrolled = AgentRepository::stage_totp(
        &repository,
        team,
        record.metadata.id,
        TotpKeyId(reused),
        &totp,
    )
    .await;
    assert!(matches!(enrolled, Err(Error::Conflict)));
    let enrollments = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",
        team.0,
        reused
    )
    .fetch_one(&pool)
    .await
    .expect("enrollments");
    assert_eq!(enrollments, 0);

    // The original request audit is preserved, and a fresh id still stages.
    let audit = sqlx::query_scalar!(
        "SELECT action FROM password_activity WHERE team_id=$1 AND item_id=$2 AND id=$3",
        team.0,
        record.metadata.id.0,
        reused
    )
    .fetch_one(&pool)
    .await
    .expect("request audit");
    assert_eq!(audit, "agent_access_request");
    AgentRepository::stage(&repository, Uuid::now_v7(), &next, &update)
        .await
        .expect("fresh operation stages");
}
