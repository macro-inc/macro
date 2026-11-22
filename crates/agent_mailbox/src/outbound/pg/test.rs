use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::models::{SendKind, SweepJob};

const ADA: &str = "macro|ada-1@agents.macro.invalid";
const TTL: Duration = Duration::minutes(3);
const TEAM: TeamId = TeamId(Uuid::from_u128(0x7ea));

fn ada() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(ADA).unwrap().into_owned()
}

fn request(request_id: u128) -> ProvisionRequest {
    ProvisionRequest {
        request_id: Uuid::from_u128(request_id),
        agent: ada(),
        display_name: Some("Ada".to_owned()),
        requested_local_part: Some(LocalPart::parse("ada").unwrap()),
    }
}

fn grant() -> StoredGrant {
    StoredGrant {
        id: ProviderGrantId("grant-1".to_owned()),
        key: EncryptedMailboxKey {
            ciphertext: vec![1, 2, 3],
            kms_key_id: "arn:aws:kms:local:key".to_owned(),
            encryption_version: 1,
        },
    }
}

fn token(value: u128) -> LeaseToken {
    LeaseToken(Uuid::from_u128(value))
}

async fn new_mailbox(repository: &PgAgentMailboxRepository) -> AgentMailboxId {
    let Reservation::New(mailbox) = repository
        .reserve(&request(1), AgentMailboxId::generate(), TEAM, 25)
        .await
        .unwrap()
    else {
        panic!("expected a new reservation");
    };
    mailbox.id
}

async fn active_mailbox(repository: &PgAgentMailboxRepository) -> AgentMailboxId {
    let id = new_mailbox(repository).await;
    let lease = token(1);
    repository
        .claim(id, lease, Utc::now(), TTL)
        .await
        .unwrap()
        .unwrap();
    let created = ProvisionedMailbox {
        id: ProviderMailboxId("inbox-1".to_owned()),
        address: "ada@example.net".to_owned(),
    };
    assert!(
        repository
            .record_created(id, lease, &created)
            .await
            .unwrap()
    );
    assert!(repository.record_grant(id, lease, &grant()).await.unwrap());
    assert!(repository.activate(id, lease).await.unwrap());
    repository.unclaim(id, lease).await.unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserve_is_idempotent_and_allows_one_live_mailbox_per_agent(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);

    let first = repository
        .reserve(&request(1), AgentMailboxId::generate(), TEAM, 25)
        .await
        .unwrap();
    let again = repository
        .reserve(&request(1), AgentMailboxId::generate(), TEAM, 25)
        .await
        .unwrap();
    let other = repository
        .reserve(&request(2), AgentMailboxId::generate(), TEAM, 25)
        .await
        .unwrap();

    let Reservation::New(first) = first else {
        panic!("expected new")
    };
    let Reservation::Existing(again) = again else {
        panic!("expected existing")
    };
    let Reservation::AgentHasMailbox(other) = other else {
        panic!("expected the agent's mailbox")
    };
    assert_eq!(first.id, again.id);
    assert_eq!(first.id, other.id);
    assert_eq!(again.requested_local_part.unwrap().as_str(), "ada");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_lease_at_a_time_fences_the_writes_of_the_other(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = new_mailbox(&repository).await;
    let now = Utc::now();
    let created = ProvisionedMailbox {
        id: ProviderMailboxId("inbox-1".to_owned()),
        address: "ada@example.net".to_owned(),
    };

    let holder = repository.claim(id, token(1), now, TTL).await.unwrap();
    let rival = repository.claim(id, token(2), now, TTL).await.unwrap();
    let rival_write = repository
        .record_created(id, token(2), &created)
        .await
        .unwrap();
    let taken_over = repository
        .claim(id, token(2), now + Duration::minutes(4), TTL)
        .await
        .unwrap();
    let stale_write = repository
        .record_created(id, token(1), &created)
        .await
        .unwrap();

    assert!(holder.is_some());
    assert!(rival.is_none());
    assert!(!rival_write);
    assert!(taken_over.is_some(), "an expired lease is taken over");
    assert!(!stale_write, "the first holder's writes are fenced off");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_pause_wins_over_activation_and_keeps_the_stored_grant(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = new_mailbox(&repository).await;
    let lease = token(1);
    repository
        .claim(id, lease, Utc::now(), TTL)
        .await
        .unwrap()
        .unwrap();
    let created = ProvisionedMailbox {
        id: ProviderMailboxId("inbox-1".to_owned()),
        address: "ada@example.net".to_owned(),
    };
    repository
        .record_created(id, lease, &created)
        .await
        .unwrap();

    assert!(
        repository
            .transition(
                id,
                &[MailboxState::Provisioning],
                MailboxState::Paused,
                Utc::now()
            )
            .await
            .unwrap()
    );
    assert!(repository.record_grant(id, lease, &grant()).await.unwrap());
    assert!(!repository.activate(id, lease).await.unwrap());
    repository
        .record_failure(
            id,
            lease,
            MailboxState::Failed,
            ProvisioningFailure::Rejected,
        )
        .await
        .unwrap();

    let paused = repository.live_mailbox(&ada()).await.unwrap().unwrap();
    assert_eq!(paused.state, MailboxState::Paused);
    assert_eq!(paused.grant, Some(grant()));
    assert_eq!(paused.last_error, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_release_records_a_late_create_and_finishes_under_the_lease(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = new_mailbox(&repository).await;
    let now = Utc::now();
    let in_flight = token(1);
    repository
        .claim(id, in_flight, now, TTL)
        .await
        .unwrap()
        .unwrap();

    let live = [
        MailboxState::Provisioning,
        MailboxState::Active,
        MailboxState::Failed,
        MailboxState::Paused,
    ];
    assert!(
        repository
            .transition(id, &live, MailboxState::Releasing, now)
            .await
            .unwrap()
    );
    let created = ProvisionedMailbox {
        id: ProviderMailboxId("inbox-1".to_owned()),
        address: "ada@example.net".to_owned(),
    };
    assert!(
        repository
            .record_created(id, in_flight, &created)
            .await
            .unwrap()
    );
    repository.unclaim(id, in_flight).await.unwrap();

    let teardown = token(2);
    let claimed = repository
        .claim(id, teardown, now, TTL)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        claimed.provider_mailbox_id,
        Some(ProviderMailboxId("inbox-1".to_owned()))
    );
    assert!(repository.finish_release(id, teardown, now).await.unwrap());
    assert!(repository.live_mailbox(&ada()).await.unwrap().is_none());
    assert!(matches!(
        repository
            .reserve(&request(2), AgentMailboxId::generate(), TEAM, 25)
            .await
            .unwrap(),
        Reservation::New(_)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retention_release_starts_only_for_a_mailbox_still_paused_long_enough(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = active_mailbox(&repository).await;
    let now = Utc::now();
    repository
        .transition(
            id,
            &[MailboxState::Active],
            MailboxState::Paused,
            now - Duration::days(31),
        )
        .await
        .unwrap();

    let too_recent = repository
        .release_if_paused_before(id, now - Duration::days(32), now)
        .await
        .unwrap();
    repository
        .transition(id, &[MailboxState::Paused], MailboxState::Active, now)
        .await
        .unwrap();
    let resumed = repository
        .release_if_paused_before(id, now - Duration::days(30), now)
        .await
        .unwrap();

    assert!(!too_recent);
    assert!(!resumed);
    assert_eq!(
        repository
            .live_mailbox(&ada())
            .await
            .unwrap()
            .unwrap()
            .state,
        MailboxState::Active
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_sweep_skips_deferred_mailboxes_until_their_time(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = active_mailbox(&repository).await;
    let now = Utc::now();
    repository
        .transition(id, &[MailboxState::Active], MailboxState::Releasing, now)
        .await
        .unwrap();
    repository
        .defer_sweep(id, now + Duration::minutes(5))
        .await
        .unwrap();

    let deferred = repository
        .due_for_sweep(
            now,
            now - Duration::minutes(1),
            now - Duration::days(30),
            10,
        )
        .await
        .unwrap();
    let later = repository
        .due_for_sweep(
            now + Duration::minutes(6),
            now,
            now - Duration::days(30),
            10,
        )
        .await
        .unwrap();

    assert!(deferred.is_empty());
    assert_eq!(
        later.iter().map(|mailbox| mailbox.id).collect::<Vec<_>>(),
        vec![id]
    );
}

fn attempt(key: u128, recipients: u32) -> SendAttempt {
    SendAttempt {
        idempotency_key: Uuid::from_u128(key),
        kind: SendKind::Message,
        recipient_count: recipients,
        fingerprint: [u8::try_from(key).unwrap(); 32],
    }
}

const ROOMY: SendLimits = SendLimits {
    per_hour: 100,
    per_day: 100,
    recipients_per_day: 1000,
    team_recipients_per_day: 1000,
};

async fn mailbox(repository: &PgAgentMailboxRepository, id: AgentMailboxId) -> AgentMailbox {
    repository.mailbox(id).await.unwrap().unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sends_dedupe_by_key_stop_at_the_caps_and_expire_unknown_outcomes(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let ada = mailbox(&repository, active_mailbox(&repository).await).await;
    let limits = SendLimits {
        per_hour: 2,
        per_day: 3,
        ..ROOMY
    };
    let now = Utc::now();
    let replayable = now - Duration::hours(23);
    let sent = SentMessage {
        id: ProviderMessageId("sent-1".to_owned()),
        thread_id: Some("thread-1".to_owned()),
    };

    let first = repository
        .reserve_send(
            &ada,
            &attempt(1, 1),
            limits,
            now - Duration::hours(2),
            replayable,
        )
        .await
        .unwrap();
    repository
        .complete_send(ada.id, Uuid::from_u128(1), &sent)
        .await
        .unwrap();
    let replay = repository
        .reserve_send(&ada, &attempt(1, 1), limits, now, replayable)
        .await
        .unwrap();
    let second = repository
        .reserve_send(
            &ada,
            &attempt(2, 1),
            limits,
            now - Duration::minutes(30),
            replayable,
        )
        .await
        .unwrap();
    let in_flight_retry = repository
        .reserve_send(&ada, &attempt(2, 1), limits, now, replayable)
        .await
        .unwrap();
    let expired_retry = repository
        .reserve_send(&ada, &attempt(2, 1), limits, now, now)
        .await
        .unwrap();
    let third = repository
        .reserve_send(&ada, &attempt(3, 1), limits, now, replayable)
        .await
        .unwrap();
    let over_day = repository
        .reserve_send(&ada, &attempt(4, 1), limits, now, replayable)
        .await
        .unwrap();

    assert_eq!(first, SendReservation::Proceed { fresh: true });
    assert_eq!(replay, SendReservation::AlreadySent(sent));
    assert_eq!(second, SendReservation::Proceed { fresh: true });
    assert_eq!(in_flight_retry, SendReservation::Proceed { fresh: false });
    assert_eq!(expired_retry, SendReservation::OutcomeUnknown);
    assert_eq!(third, SendReservation::Proceed { fresh: true });
    let SendReservation::LimitReached { retry_at } = over_day else {
        panic!("expected a limit, got {over_day:?}")
    };
    assert!(retry_at > now);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_key_reused_for_a_different_message_is_refused_even_after_a_refusal(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let ada = mailbox(&repository, active_mailbox(&repository).await).await;
    let now = Utc::now();
    let replayable = now - Duration::hours(1);
    let original = attempt(1, 1);
    let different = SendAttempt {
        fingerprint: [9; 32],
        ..original.clone()
    };

    repository
        .reserve_send(&ada, &original, ROOMY, now, replayable)
        .await
        .unwrap();
    let while_pending = repository
        .reserve_send(&ada, &different, ROOMY, now, replayable)
        .await
        .unwrap();
    repository
        .cancel_send(ada.id, original.idempotency_key)
        .await
        .unwrap();
    let after_refusal = repository
        .reserve_send(&ada, &different, ROOMY, now, replayable)
        .await
        .unwrap();
    let same_again = repository
        .reserve_send(&ada, &original, ROOMY, now, replayable)
        .await
        .unwrap();

    assert_eq!(while_pending, SendReservation::KeyReused);
    assert_eq!(after_refusal, SendReservation::KeyReused);
    assert_eq!(same_again, SendReservation::Proceed { fresh: true });
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recipients_count_against_the_mailbox_and_the_team(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool.clone());
    let ada = mailbox(&repository, active_mailbox(&repository).await).await;
    // A second agent mailbox on the same team.
    let ben = MacroUserIdStr::parse_from_str("macro|ben-2@agents.macro.invalid")
        .unwrap()
        .into_owned();
    let Reservation::New(ben) = repository
        .reserve(
            &ProvisionRequest {
                agent: ben,
                ..request(2)
            },
            AgentMailboxId::generate(),
            TEAM,
            25,
        )
        .await
        .unwrap()
    else {
        panic!("expected a new reservation");
    };
    let lease = token(2);
    repository
        .claim(ben.id, lease, Utc::now(), TTL)
        .await
        .unwrap()
        .unwrap();
    let created = ProvisionedMailbox {
        id: ProviderMailboxId("inbox-2".to_owned()),
        address: "ben@example.net".to_owned(),
    };
    assert!(
        repository
            .record_created(ben.id, lease, &created)
            .await
            .unwrap()
    );
    assert!(
        repository
            .record_grant(ben.id, lease, &grant())
            .await
            .unwrap()
    );
    assert!(repository.activate(ben.id, lease).await.unwrap());
    let ben = mailbox(&repository, ben.id).await;
    let limits = SendLimits {
        recipients_per_day: 10,
        team_recipients_per_day: 15,
        ..ROOMY
    };
    let now = Utc::now();
    let replayable = now - Duration::hours(1);

    let ada_first = repository
        .reserve_send(&ada, &attempt(1, 8), limits, now, replayable)
        .await
        .unwrap();
    let ada_over = repository
        .reserve_send(&ada, &attempt(2, 3), limits, now, replayable)
        .await
        .unwrap();
    let ben_fits = repository
        .reserve_send(&ben, &attempt(3, 7), limits, now, replayable)
        .await
        .unwrap();
    let ben_over_team = repository
        .reserve_send(&ben, &attempt(4, 1), limits, now, replayable)
        .await
        .unwrap();

    assert_eq!(ada_first, SendReservation::Proceed { fresh: true });
    assert!(
        matches!(ada_over, SendReservation::LimitReached { .. }),
        "{ada_over:?}"
    );
    assert_eq!(ben_fits, SendReservation::Proceed { fresh: true });
    let SendReservation::LimitReached { retry_at } = ben_over_team else {
        panic!("expected the team cap, got {ben_over_team:?}")
    };
    // Postgres keeps microseconds.
    assert_eq!((retry_at - (now + Duration::days(1))).num_milliseconds(), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_team_gets_at_most_its_limit_of_live_mailboxes(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let first = new_mailbox(&repository).await;
    let ben = MacroUserIdStr::parse_from_str("macro|ben-2@agents.macro.invalid")
        .unwrap()
        .into_owned();
    let ben_request = ProvisionRequest {
        agent: ben,
        ..request(2)
    };

    let full = repository
        .reserve(&ben_request, AgentMailboxId::generate(), TEAM, 1)
        .await
        .unwrap();
    repository
        .transition(
            first,
            &[MailboxState::Provisioning],
            MailboxState::Releasing,
            Utc::now(),
        )
        .await
        .unwrap();
    let still_full = repository
        .reserve(&ben_request, AgentMailboxId::generate(), TEAM, 1)
        .await
        .unwrap();
    let lease = token(5);
    repository
        .claim(first, lease, Utc::now(), TTL)
        .await
        .unwrap()
        .unwrap();
    repository
        .finish_release(first, lease, Utc::now())
        .await
        .unwrap();
    let freed = repository
        .reserve(&ben_request, AgentMailboxId::generate(), TEAM, 1)
        .await
        .unwrap();
    let retry_of_first = repository
        .reserve(&request(1), AgentMailboxId::generate(), TEAM, 1)
        .await
        .unwrap();

    assert_eq!(full, Reservation::TeamFull);
    assert_eq!(
        still_full,
        Reservation::TeamFull,
        "a releasing mailbox still counts"
    );
    assert!(matches!(freed, Reservation::New(_)));
    assert!(
        matches!(retry_of_first, Reservation::Existing(_)),
        "a full team still answers an old request with its own mailbox"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn each_send_is_recorded_without_its_content_and_pruned_after_retention(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool.clone());
    let ada = mailbox(&repository, active_mailbox(&repository).await).await;
    let now = Utc::now();
    let replayable = now - Duration::hours(1);
    let sent = SentMessage {
        id: ProviderMessageId("sent-1".to_owned()),
        thread_id: None,
    };

    repository
        .reserve_send(&ada, &attempt(1, 3), ROOMY, now, replayable)
        .await
        .unwrap();
    repository
        .complete_send(ada.id, Uuid::from_u128(1), &sent)
        .await
        .unwrap();
    repository
        .reserve_send(&ada, &attempt(2, 1), ROOMY, now, replayable)
        .await
        .unwrap();
    repository
        .cancel_send(ada.id, Uuid::from_u128(2))
        .await
        .unwrap();
    repository
        .reserve_send(&ada, &attempt(3, 2), ROOMY, now, replayable)
        .await
        .unwrap();
    repository
        .reserve_send(&ada, &attempt(3, 2), ROOMY, now, replayable)
        .await
        .unwrap();

    let audit = sqlx::query!(
        r#"
        SELECT idempotency_key, team_id, kind, recipient_count, outcome, provider_message_id, attempts
        FROM agent_mailbox_sends
        WHERE mailbox_id = $1
        ORDER BY idempotency_key
        "#,
        ada.id.0,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let rows: Vec<_> = audit
        .iter()
        .map(|row| {
            (
                row.idempotency_key,
                row.team_id,
                row.kind.as_str(),
                row.recipient_count,
                row.outcome.as_str(),
                row.provider_message_id.as_deref(),
                row.attempts,
            )
        })
        .collect();
    assert_eq!(
        rows,
        vec![
            (
                Uuid::from_u128(1),
                TEAM.0,
                "message",
                3,
                "sent",
                Some("sent-1"),
                1
            ),
            (Uuid::from_u128(2), TEAM.0, "message", 1, "refused", None, 1),
            (Uuid::from_u128(3), TEAM.0, "message", 2, "pending", None, 2),
        ]
    );
    let pruned = repository
        .prune_sends(now + Duration::seconds(1))
        .await
        .unwrap();
    assert_eq!(pruned, 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cancelled_send_frees_its_slot_and_old_records_are_pruned(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let ada = mailbox(&repository, active_mailbox(&repository).await).await;
    let limits = SendLimits {
        per_hour: 10,
        per_day: 10,
        ..ROOMY
    };
    let now = Utc::now();
    let replayable = now - Duration::hours(23);

    repository
        .reserve_send(&ada, &attempt(1, 1), limits, now, replayable)
        .await
        .unwrap();
    repository
        .cancel_send(ada.id, Uuid::from_u128(1))
        .await
        .unwrap();
    for key in 2..5 {
        repository
            .reserve_send(&ada, &attempt(key, 1), limits, now, replayable)
            .await
            .unwrap();
    }
    let pruned = repository
        .prune_sends(now + Duration::seconds(1))
        .await
        .unwrap();
    let nothing_left = repository
        .prune_sends(now + Duration::seconds(1))
        .await
        .unwrap();

    assert_eq!(
        pruned, 4,
        "the refused record stays until its retention ends"
    );
    assert_eq!(nothing_left, 0);
}

async fn seed_account(pool: &PgPool, id: &str, number: u128, is_agent: bool) {
    let email = id.trim_start_matches("macro|");
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)"#,
        Uuid::from_u128(number),
        format!("user-{number}"),
        email,
        format!("cus_{number}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ($1, $2, $3, $4)"#,
        id,
        email,
        Uuid::from_u128(number),
        is_agent,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_team(pool: &PgPool, team: TeamId, owner: &str, members: &[&str]) {
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)"#,
        team.0,
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    for member in members {
        sqlx::query!(
            r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')"#,
            member,
            team.0,
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

const OWNER: &str = "macro|owner@example.com";

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_agent_accounts_on_a_team_have_one(pool: PgPool) {
    seed_account(&pool, OWNER, 1, false).await;
    seed_account(&pool, ADA, 2, true).await;
    seed_account(&pool, "macro|loner@agents.macro.invalid", 3, true).await;
    seed_team(&pool, TEAM, OWNER, &[OWNER, ADA]).await;
    let directory = PgAgentDirectory::new(pool);
    let owner = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let loner = MacroUserIdStr::parse_from_str("macro|loner@agents.macro.invalid").unwrap();

    assert_eq!(directory.agent_team(&ada()).await.unwrap(), Some(TEAM));
    assert_eq!(
        directory.agent_team(&owner).await.unwrap(),
        None,
        "a person is not an agent"
    );
    assert_eq!(
        directory.agent_team(&loner).await.unwrap(),
        None,
        "an agent on no team"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_released_mailbox_does_not_block_a_reused_provider_id(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let first = active_mailbox(&repository).await;
    let now = Utc::now();
    repository
        .transition(first, &[MailboxState::Active], MailboxState::Releasing, now)
        .await
        .unwrap();
    let teardown = token(9);
    repository
        .claim(first, teardown, now, TTL)
        .await
        .unwrap()
        .unwrap();
    assert!(
        repository
            .finish_release(first, teardown, now)
            .await
            .unwrap()
    );

    let Reservation::New(second) = repository
        .reserve(&request(2), AgentMailboxId::generate(), TEAM, 25)
        .await
        .unwrap()
    else {
        panic!("expected a new reservation");
    };
    let lease = token(10);
    repository
        .claim(second.id, lease, now, TTL)
        .await
        .unwrap()
        .unwrap();
    let reused = ProvisionedMailbox {
        id: ProviderMailboxId("inbox-1".to_owned()),
        address: "ada@example.net".to_owned(),
    };

    assert!(
        repository
            .record_created(second.id, lease, &reused)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn provisioning_needs_only_one_connection(pool: PgPool) {
    let single = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(2))
        .connect_with(pool.connect_options().as_ref().clone())
        .await
        .unwrap();
    let repository = PgAgentMailboxRepository::new(single);

    let first = repository
        .reserve(&request(1), AgentMailboxId::generate(), TEAM, 25)
        .await;
    let again = repository
        .reserve(&request(1), AgentMailboxId::generate(), TEAM, 25)
        .await;

    assert!(matches!(first, Ok(Reservation::New(_))), "{first:?}");
    assert!(matches!(again, Ok(Reservation::Existing(_))), "{again:?}");
}

async fn orphan_ids(repository: &PgAgentMailboxRepository) -> Vec<AgentMailboxId> {
    repository
        .orphaned(None, 10)
        .await
        .unwrap()
        .0
        .into_iter()
        .map(|mailbox| mailbox.id)
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_agent_that_left_its_team_is_an_orphan_and_is_paused(pool: PgPool) {
    seed_account(&pool, OWNER, 1, false).await;
    seed_account(&pool, ADA, 2, true).await;
    seed_team(&pool, TEAM, OWNER, &[OWNER, ADA]).await;
    let repository = PgAgentMailboxRepository::new(pool.clone());
    let id = active_mailbox(&repository).await;
    let now = Utc::now();

    let while_member = orphan_ids(&repository).await;
    let pause_while_member = repository.pause_if_orphaned(id, now).await.unwrap();
    sqlx::query!(r#"DELETE FROM team_user WHERE user_id = $1"#, ADA)
        .execute(&pool)
        .await
        .unwrap();
    let after_leaving = orphan_ids(&repository).await;
    let paused = repository.pause_if_orphaned(id, now).await.unwrap();
    let after_pause = orphan_ids(&repository).await;

    assert!(while_member.is_empty());
    assert!(
        !pause_while_member,
        "the write rechecks: a member's mailbox is never paused"
    );
    assert_eq!(after_leaving, vec![id]);
    assert!(paused);
    assert!(
        after_pause.is_empty(),
        "a paused orphan is left to the 30-day retention"
    );
    assert_eq!(
        repository.mailbox(id).await.unwrap().unwrap().state,
        MailboxState::Paused
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_account_is_an_orphan_and_is_paused(pool: PgPool) {
    seed_account(&pool, OWNER, 1, false).await;
    seed_account(&pool, ADA, 2, true).await;
    seed_team(&pool, TEAM, OWNER, &[OWNER, ADA]).await;
    let repository = PgAgentMailboxRepository::new(pool.clone());
    let id = active_mailbox(&repository).await;
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, ADA)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(orphan_ids(&repository).await, vec![id]);
    assert!(repository.pause_if_orphaned(id, Utc::now()).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_team_orphans_its_mailboxes_and_pauses_them(pool: PgPool) {
    seed_account(&pool, OWNER, 1, false).await;
    seed_account(&pool, ADA, 2, true).await;
    seed_team(&pool, TEAM, OWNER, &[OWNER, ADA]).await;
    let repository = PgAgentMailboxRepository::new(pool.clone());
    let id = active_mailbox(&repository).await;
    sqlx::query!(r#"DELETE FROM team WHERE id = $1"#, TEAM.0)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(orphan_ids(&repository).await, vec![id]);
    assert!(repository.pause_if_orphaned(id, Utc::now()).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_orphan_check_pages_through_live_mailboxes_by_id(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let mut ids = Vec::new();
    for number in 0..3 {
        let agent =
            MacroUserIdStr::parse_from_str(&format!("macro|agent-{number}@agents.macro.invalid"))
                .unwrap()
                .into_owned();
        let Reservation::New(mailbox) = repository
            .reserve(
                &ProvisionRequest {
                    agent,
                    ..request(10 + number)
                },
                AgentMailboxId::generate(),
                TEAM,
                25,
            )
            .await
            .unwrap()
        else {
            panic!("expected a new reservation");
        };
        ids.push(mailbox.id);
    }
    ids.sort_by_key(|id| id.0);

    let (first, after_first) = repository.orphaned(None, 2).await.unwrap();
    let (second, after_second) = repository.orphaned(after_first, 2).await.unwrap();

    // No "User" rows at all: every mailbox is an orphan, two a page.
    assert_eq!(
        first.iter().map(|mailbox| mailbox.id).collect::<Vec<_>>(),
        ids[..2]
    );
    assert_eq!(after_first, Some(ids[1]));
    assert_eq!(
        second.iter().map(|mailbox| mailbox.id).collect::<Vec<_>>(),
        ids[2..]
    );
    assert_eq!(after_second, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_replica_claims_each_hourly_orphan_check(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool.clone());

    let first = repository
        .claim_sweep_job(SweepJob::Orphans, Duration::hours(1))
        .await
        .unwrap();
    let rival = repository
        .claim_sweep_job(SweepJob::Orphans, Duration::hours(1))
        .await
        .unwrap();
    sqlx::query!("UPDATE agent_mailbox_sweep_claims SET next_run_at = now() - interval '1 second'")
        .execute(&pool)
        .await
        .unwrap();
    let next = repository
        .claim_sweep_job(SweepJob::Orphans, Duration::hours(1))
        .await
        .unwrap();

    assert!(first);
    assert!(!rival);
    assert!(next);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stored_reserved_name_still_reads_back(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let support = ProvisionRequest {
        requested_local_part: Some(LocalPart::parse("support").unwrap()),
        ..request(1)
    };
    let Reservation::New(mailbox) = repository
        .reserve(&support, AgentMailboxId::generate(), TEAM, 25)
        .await
        .unwrap()
    else {
        panic!("expected a new reservation");
    };

    let read = repository.mailbox(mailbox.id).await.unwrap().unwrap();

    assert_eq!(read.requested_local_part.unwrap().as_str(), "support");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn each_sweep_job_is_claimed_by_one_replica_per_round_independently(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);

    let prune = repository
        .claim_sweep_job(SweepJob::Prune, Duration::minutes(1))
        .await
        .unwrap();
    let rival = repository
        .claim_sweep_job(SweepJob::Prune, Duration::minutes(1))
        .await
        .unwrap();
    let orphans = repository
        .claim_sweep_job(SweepJob::Orphans, Duration::hours(1))
        .await
        .unwrap();

    assert!(prune);
    assert!(!rival);
    assert!(
        orphans,
        "the prune claim does not take the orphan check's round"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_orphan_check_claim_survives_a_missing_seed_row(pool: PgPool) {
    sqlx::query!("DELETE FROM agent_mailbox_sweep_claims")
        .execute(&pool)
        .await
        .unwrap();
    let repository = PgAgentMailboxRepository::new(pool);

    let first = repository
        .claim_sweep_job(SweepJob::Orphans, Duration::hours(1))
        .await
        .unwrap();
    let rival = repository
        .claim_sweep_job(SweepJob::Orphans, Duration::hours(1))
        .await
        .unwrap();

    assert!(first);
    assert!(!rival);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_send_reserved_after_a_pause_or_release_does_not_proceed(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = active_mailbox(&repository).await;
    // The caller read the mailbox while it was active...
    let ada = mailbox(&repository, id).await;
    let now = Utc::now();
    // ...and a pause committed before its reservation.
    assert!(
        repository
            .transition(id, &[MailboxState::Active], MailboxState::Paused, now)
            .await
            .unwrap()
    );

    let paused = repository
        .reserve_send(&ada, &attempt(1, 1), ROOMY, now, now - Duration::hours(1))
        .await
        .unwrap();
    assert!(
        repository
            .transition(id, &[MailboxState::Paused], MailboxState::Releasing, now)
            .await
            .unwrap()
    );
    let released = repository
        .reserve_send(&ada, &attempt(2, 1), ROOMY, now, now - Duration::hours(1))
        .await
        .unwrap();

    assert!(
        !matches!(paused, SendReservation::Proceed { .. }),
        "{paused:?}"
    );
    assert!(
        !matches!(released, SendReservation::Proceed { .. }),
        "{released:?}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_retry_that_succeeds_after_the_first_attempt_was_refused_still_counts(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let ada = mailbox(&repository, active_mailbox(&repository).await).await;
    let limits = SendLimits {
        per_hour: 1,
        ..ROOMY
    };
    let now = Utc::now();
    let replayable = now - Duration::hours(1);

    let fresh = repository
        .reserve_send(&ada, &attempt(1, 1), limits, now, replayable)
        .await
        .unwrap();
    let retry = repository
        .reserve_send(&ada, &attempt(1, 1), limits, now, replayable)
        .await
        .unwrap();
    // The first attempt is refused, the concurrent retry goes out.
    repository
        .cancel_send(ada.id, Uuid::from_u128(1))
        .await
        .unwrap();
    repository
        .complete_send(
            ada.id,
            Uuid::from_u128(1),
            &SentMessage {
                id: ProviderMessageId("sent-1".to_owned()),
                thread_id: None,
            },
        )
        .await
        .unwrap();
    let next = repository
        .reserve_send(&ada, &attempt(2, 1), limits, now, replayable)
        .await
        .unwrap();

    assert_eq!(fresh, SendReservation::Proceed { fresh: true });
    assert_eq!(retry, SendReservation::Proceed { fresh: false });
    assert!(
        matches!(next, SendReservation::LimitReached { .. }),
        "the sent message holds the hour's only slot: {next:?}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_request_replaces_a_failed_mailbox_that_never_reached_the_provider(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let failed = new_mailbox(&repository).await;
    let lease = token(1);
    repository
        .claim(failed, lease, Utc::now(), TTL)
        .await
        .unwrap()
        .unwrap();
    repository
        .record_failure(
            failed,
            lease,
            MailboxState::Failed,
            ProvisioningFailure::AddressTaken,
        )
        .await
        .unwrap();
    repository.unclaim(failed, lease).await.unwrap();

    let replaced = repository
        .reserve(&request(2), AgentMailboxId::generate(), TEAM, 25)
        .await
        .unwrap();

    let Reservation::New(mailbox) = replaced else {
        panic!("expected a new mailbox, got {replaced:?}");
    };
    assert_ne!(mailbox.id, failed);
    assert_eq!(
        repository.mailbox(failed).await.unwrap().unwrap().state,
        MailboxState::Released
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_mailbox_holding_a_provider_inbox_or_a_lease_is_not_replaced(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let failed = new_mailbox(&repository).await;
    let lease = token(1);
    repository
        .claim(failed, lease, Utc::now(), TTL)
        .await
        .unwrap()
        .unwrap();
    let created = ProvisionedMailbox {
        id: ProviderMailboxId("inbox-1".to_owned()),
        address: "ada@example.net".to_owned(),
    };
    assert!(
        repository
            .record_created(failed, lease, &created)
            .await
            .unwrap()
    );
    repository
        .record_failure(
            failed,
            lease,
            MailboxState::Failed,
            ProvisioningFailure::Rejected,
        )
        .await
        .unwrap();
    repository.unclaim(failed, lease).await.unwrap();

    let refused = repository
        .reserve(&request(2), AgentMailboxId::generate(), TEAM, 25)
        .await
        .unwrap();

    assert!(
        matches!(refused, Reservation::AgentHasMailbox(_)),
        "{refused:?}"
    );
}
