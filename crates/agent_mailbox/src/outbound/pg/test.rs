use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const ADA: &str = "macro|ada-1@agents.macro.invalid";
const TTL: Duration = Duration::minutes(3);

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
        .reserve(&request(1), AgentMailboxId::generate())
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
        .reserve(&request(1), AgentMailboxId::generate())
        .await
        .unwrap();
    let again = repository
        .reserve(&request(1), AgentMailboxId::generate())
        .await
        .unwrap();
    let other = repository
        .reserve(&request(2), AgentMailboxId::generate())
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
            .reserve(&request(2), AgentMailboxId::generate())
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sends_dedupe_by_key_stop_at_the_caps_and_expire_unknown_outcomes(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = active_mailbox(&repository).await;
    let limits = SendLimits {
        per_hour: 2,
        per_day: 3,
    };
    let now = Utc::now();
    let replayable = now - Duration::hours(23);
    let sent = SentMessage {
        id: ProviderMessageId("sent-1".to_owned()),
        thread_id: Some("thread-1".to_owned()),
    };

    let first = repository
        .reserve_send(
            id,
            Uuid::from_u128(1),
            SendKind::Message,
            limits,
            now - Duration::hours(2),
            replayable,
        )
        .await
        .unwrap();
    repository
        .complete_send(id, Uuid::from_u128(1), &sent)
        .await
        .unwrap();
    let replay = repository
        .reserve_send(
            id,
            Uuid::from_u128(1),
            SendKind::Message,
            limits,
            now,
            replayable,
        )
        .await
        .unwrap();
    let second = repository
        .reserve_send(
            id,
            Uuid::from_u128(2),
            SendKind::Reply,
            limits,
            now - Duration::minutes(30),
            replayable,
        )
        .await
        .unwrap();
    let in_flight_retry = repository
        .reserve_send(
            id,
            Uuid::from_u128(2),
            SendKind::Reply,
            limits,
            now,
            replayable,
        )
        .await
        .unwrap();
    let expired_retry = repository
        .reserve_send(id, Uuid::from_u128(2), SendKind::Reply, limits, now, now)
        .await
        .unwrap();
    let third = repository
        .reserve_send(
            id,
            Uuid::from_u128(3),
            SendKind::Message,
            limits,
            now,
            replayable,
        )
        .await
        .unwrap();
    let over_day = repository
        .reserve_send(
            id,
            Uuid::from_u128(4),
            SendKind::Message,
            limits,
            now,
            replayable,
        )
        .await
        .unwrap();

    assert_eq!(first, SendReservation::Proceed);
    assert_eq!(replay, SendReservation::AlreadySent(sent));
    assert_eq!(second, SendReservation::Proceed);
    assert_eq!(in_flight_retry, SendReservation::Proceed);
    assert_eq!(expired_retry, SendReservation::OutcomeUnknown);
    assert_eq!(third, SendReservation::Proceed);
    let SendReservation::LimitReached { retry_at } = over_day else {
        panic!("expected a limit, got {over_day:?}")
    };
    assert!(retry_at > now);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cancelled_send_frees_its_slot_and_old_records_are_pruned(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = active_mailbox(&repository).await;
    let limits = SendLimits {
        per_hour: 10,
        per_day: 10,
    };
    let now = Utc::now();
    let replayable = now - Duration::hours(23);

    repository
        .reserve_send(
            id,
            Uuid::from_u128(1),
            SendKind::Message,
            limits,
            now,
            replayable,
        )
        .await
        .unwrap();
    repository
        .cancel_send(id, Uuid::from_u128(1))
        .await
        .unwrap();
    for key in 2..5 {
        repository
            .reserve_send(
                id,
                Uuid::from_u128(key),
                SendKind::Message,
                limits,
                now,
                replayable,
            )
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

    assert_eq!(pruned, 3);
    assert_eq!(nothing_left, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_agent_accounts_are_agents(pool: PgPool) {
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'ada', 'ada-1@agents.macro.invalid', 'cus_ada')"#,
        Uuid::from_u128(1),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ($1, 'ada-1@agents.macro.invalid', $2, TRUE)"#,
        ADA,
        Uuid::from_u128(1),
    )
    .execute(&pool)
    .await
    .unwrap();
    let directory = PgAgentDirectory::new(pool);
    let person = MacroUserIdStr::parse_from_str("macro|person@example.com").unwrap();

    assert!(directory.is_agent(&ada()).await.unwrap());
    assert!(!directory.is_agent(&person).await.unwrap());
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
        .reserve(&request(2), AgentMailboxId::generate())
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
