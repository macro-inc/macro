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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn human_and_agent_publication_never_share_an_enrollment_or_intent_id(pool: PgPool) {
    let (repository, owner, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let item = record.metadata.id;
    let agent = account(&pool, "macro|agent@example.test", true).await;
    let setup = IntentAgent {
        agent: agent.clone(),
        wake: crate::domain::agent::WakeId(Uuid::now_v7()),
        action: AgentAction::AgentTotpSetup,
    };
    let enrolled = TotpKeyId(Uuid::now_v7());
    AgentRepository::stage_totp(&repository, team, item, enrolled, &setup)
        .await
        .expect("stage");
    let revision = repository.get(team, item).await.expect("item").revision;
    repository
        .activate_totp(team, item, enrolled, revision)
        .await
        .expect("activate");
    let mut next = repository.get(team, item).await.expect("item");
    next.metadata.version = 2;

    // A human update named by the agent's enrollment id would lose its audit.
    let aliased = Repository::stage(&repository, enrolled.0, &next, &owner.user_id).await;
    assert!(matches!(aliased, Err(Error::Conflict)));
    let intents = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM password_write_intents WHERE operation_id=$1",
        enrolled.0
    )
    .fetch_one(&pool)
    .await
    .expect("intents");
    assert_eq!(intents, 0);

    // A human intent's id cannot become an enrollment, even without the lease.
    let staged = Uuid::now_v7();
    Repository::stage(&repository, staged, &next, &owner.user_id)
        .await
        .expect("human stage");
    let inverse =
        AgentRepository::stage_totp(&repository, team, item, TotpKeyId(staged), &setup).await;
    assert!(matches!(inverse, Err(Error::Conflict)));
    let enrollments = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",
        team.0,
        staged
    )
    .fetch_one(&pool)
    .await
    .expect("enrollments");
    assert_eq!(enrollments, 0);

    // The human's own audited update still replays.
    Repository::audit(&repository, team, item, &owner, Action::Update, staged)
        .await
        .expect("audit");
    Repository::stage(&repository, staged, &next, &owner.user_id)
        .await
        .expect("own replay");
}

/// Which lock a staging writer is seen waiting on in this test's database.
#[derive(Clone, Copy)]
enum Wait {
    /// A relation lock on `password_write_intents`.
    Intents,
    /// A relation lock on `password_totp_enrollments`.
    Enrollments,
    /// An advisory lock.
    Advisory,
}

async fn waiting(pool: &PgPool, wait: Wait) -> bool {
    match wait {
        Wait::Intents | Wait::Enrollments => {
            let relation = match wait {
                Wait::Intents => "password_write_intents",
                _ => "password_totp_enrollments",
            };
            sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
                    WHERE l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
                    AND c.relname=$1 AND NOT l.granted) AS "waiting!""#,
                relation
            )
            .fetch_one(pool)
            .await
            .expect("pg_locks")
        }
        Wait::Advisory => sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM pg_locks l
                WHERE l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
                AND l.locktype='advisory' AND NOT l.granted) AS "waiting!""#
        )
        .fetch_one(pool)
        .await
        .expect("pg_locks"),
    }
}

/// Bounded barrier: returns once `wait` is observed, or once `done` reports the
/// writer already finished without waiting. Fails after five seconds; no fixed sleep
/// decides the outcome, only the observed lock state does.
async fn until_waiting(pool: &PgPool, wait: Wait, done: impl Fn() -> bool) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !done() && !waiting(pool, wait).await {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("writer neither waited nor finished");
}

async fn reservations(pool: &PgPool, team: TeamId, operation: Uuid) -> (i64, i64) {
    let intents = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM password_write_intents WHERE operation_id=$1",
        operation
    )
    .fetch_one(pool)
    .await
    .expect("intents");
    let enrollments = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM password_totp_enrollments WHERE team_id=$1 AND key_id=$2",
        team.0,
        operation
    )
    .fetch_one(pool)
    .await
    .expect("enrollments");
    (intents, enrollments)
}

/// The writer of `first` is held inside its INSERT by a table lock; `second`
/// runs meanwhile with the same operation id. At most one may reserve it, and
/// the other is refused (Conflict, or Busy when it waited past the lock budget).
async fn overlap<First, Second>(
    pool: &PgPool,
    team: TeamId,
    operation: Uuid,
    held: Wait,
    first: First,
    second: Second,
) where
    First: std::future::Future<Output = Result<(), Error>> + Send + 'static,
    Second: std::future::Future<Output = Result<(), Error>> + Send + 'static,
{
    let mut blocker = pool.begin().await.expect("blocker");
    match held {
        Wait::Intents => sqlx::query!("LOCK TABLE password_write_intents IN SHARE MODE")
            .execute(&mut *blocker)
            .await
            .expect("lock intents"),
        _ => sqlx::query!("LOCK TABLE password_totp_enrollments IN SHARE MODE")
            .execute(&mut *blocker)
            .await
            .expect("lock enrollments"),
    };
    let first = tokio::spawn(first);
    until_waiting(pool, held, || first.is_finished()).await;
    assert!(
        !first.is_finished(),
        "the first writer must be held in its insert"
    );
    let second = tokio::spawn(second);
    until_waiting(pool, Wait::Advisory, || second.is_finished()).await;
    blocker.rollback().await.expect("release");
    let first = first.await.expect("first writer");
    let second = second.await.expect("second writer");
    let (intents, enrollments) = reservations(pool, team, operation).await;
    eprintln!(
        "overlap: first={first:?} second={second:?} intents={intents} enrollments={enrollments}"
    );
    assert!(
        intents + enrollments <= 1,
        "one operation id reserved twice: {intents} intents, {enrollments} enrollments"
    );
    let refused = [&first, &second]
        .into_iter()
        .filter(|result| matches!(result, Err(Error::Conflict | Error::Busy)))
        .count();
    assert_eq!(refused, 1, "exactly one writer is refused");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_overlapping_human_intent_and_enrollment_reserve_one_operation(pool: PgPool) {
    let (repository, owner, record) = folder_fixture(pool.clone()).await;
    let repository = Arc::new(repository);
    let team = record.metadata.team_id;
    let item = record.metadata.id;
    let agent = account(&pool, "macro|agent@example.test", true).await;
    let setup = IntentAgent {
        agent,
        wake: crate::domain::agent::WakeId(Uuid::now_v7()),
        action: AgentAction::AgentTotpSetup,
    };
    let mut next = record.clone();
    next.metadata.version = 2;

    // Human intent held in its insert, enrollment of the same id meanwhile.
    let operation = Uuid::now_v7();
    let (human, totp) = (repository.clone(), repository.clone());
    let (publisher, staged) = (owner.user_id.clone(), next.clone());
    let key_setup = setup.clone();
    overlap(
        &pool,
        team,
        operation,
        Wait::Intents,
        async move { Repository::stage(&*human, operation, &staged, &publisher).await },
        async move {
            AgentRepository::stage_totp(&*totp, team, item, TotpKeyId(operation), &key_setup).await
        },
    )
    .await;

    // Enrollment held in its insert, human intent of the same id meanwhile.
    let operation = Uuid::now_v7();
    let (human, totp) = (repository.clone(), repository.clone());
    let (publisher, staged) = (owner.user_id.clone(), next.clone());
    overlap(
        &pool,
        team,
        operation,
        Wait::Enrollments,
        async move {
            AgentRepository::stage_totp(&*totp, team, item, TotpKeyId(operation), &setup).await
        },
        async move { Repository::stage(&*human, operation, &staged, &publisher).await },
    )
    .await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_overlapping_agent_update_and_enrollment_reserve_one_operation(pool: PgPool) {
    let (repository, _, mut record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let agent = account(&pool, "macro|agent@example.test", true).await;
    // An item the agent created, with the agent's own Edit grant.
    record.metadata.id = ItemId(Uuid::now_v7());
    record.user_id = agent.clone();
    record.grants = vec![Grant {
        kind: GranteeKind::Agent,
        id: agent.to_string(),
        permission: Permission::Edit,
    }];
    repository.save(&record, None).await.expect("agent item");
    let item = record.metadata.id;
    let current = repository.get(team, item).await.expect("item");
    let mut next = current.clone();
    next.metadata.version = current.metadata.version + 1;
    let update = IntentAgent {
        agent: agent.clone(),
        wake: crate::domain::agent::WakeId(Uuid::now_v7()),
        action: AgentAction::AgentUpdate,
    };
    let setup = IntentAgent {
        action: AgentAction::AgentTotpSetup,
        ..update.clone()
    };
    let repository = Arc::new(repository);
    let operation = Uuid::now_v7();
    let (stager, totp) = (repository.clone(), repository.clone());
    overlap(
        &pool,
        team,
        operation,
        Wait::Intents,
        async move { AgentRepository::stage(&*stager, operation, &next, &update).await },
        async move {
            AgentRepository::stage_totp(&*totp, team, item, TotpKeyId(operation), &setup).await
        },
    )
    .await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_held_operation_lock_is_busy_after_the_lock_budget_with_no_journal(pool: PgPool) {
    let (repository, owner, record) = folder_fixture(pool.clone()).await;
    let team = record.metadata.team_id;
    let operation = Uuid::now_v7();
    let mut holder = pool.begin().await.expect("holder");
    let key = format!("passwords/operation/{operation}");
    sqlx::query!(
        r#"SELECT 1 AS "locked!" FROM pg_advisory_xact_lock(hashtextextended($1, 0))"#,
        key
    )
    .fetch_one(&mut *holder)
    .await
    .expect("hold operation lock");
    let mut next = record.clone();
    next.metadata.version = 2;
    let started = std::time::Instant::now();
    let staged = Repository::stage(&repository, operation, &next, &owner.user_id).await;
    let waited = started.elapsed();
    eprintln!("held operation lock: {staged:?} after {waited:?}");
    assert!(matches!(staged, Err(Error::Busy)), "{staged:?}");
    // The 2s lock budget, not the 5s statement budget, ended the wait.
    assert!(waited < std::time::Duration::from_secs(5), "{waited:?}");
    holder.rollback().await.expect("release");
    assert_eq!(reservations(&pool, team, operation).await, (0, 0));
}
