use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

const ADA: &str = "macro|ada-1@agents.macro.invalid";

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

async fn active_mailbox(repository: &PgAgentMailboxRepository) -> AgentMailboxId {
    let Reservation::New(mailbox) = repository
        .reserve(&request(1), AgentMailboxId::generate())
        .await
        .unwrap()
    else {
        panic!("expected a new reservation");
    };
    repository
        .record_created(
            mailbox.id,
            &ProvisionedMailbox {
                id: ProviderMailboxId("inbox-1".to_owned()),
                address: "ada@example.net".to_owned(),
            },
        )
        .await
        .unwrap();
    assert!(repository.activate(mailbox.id, &grant()).await.unwrap());
    mailbox.id
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
async fn a_released_mailbox_frees_the_agent_for_a_new_one(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = active_mailbox(&repository).await;
    let now = Utc::now();

    assert!(
        repository
            .transition(id, &[MailboxState::Active], MailboxState::Releasing, now)
            .await
            .unwrap()
    );
    repository.clear_grant(id).await.unwrap();
    assert!(
        repository
            .transition(id, &[MailboxState::Releasing], MailboxState::Released, now)
            .await
            .unwrap()
    );

    assert!(repository.live_mailbox(&ada()).await.unwrap().is_none());
    let next = repository
        .reserve(&request(2), AgentMailboxId::generate())
        .await
        .unwrap();
    assert!(matches!(next, Reservation::New(_)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn activation_stores_the_grant_and_a_pause_wins_over_a_late_activation(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = active_mailbox(&repository).await;

    let stored = repository.live_mailbox(&ada()).await.unwrap().unwrap();
    assert_eq!(stored.state, MailboxState::Active);
    assert_eq!(stored.grant, Some(grant()));
    assert_eq!(stored.address.as_deref(), Some("ada@example.net"));

    let now = Utc::now();
    assert!(
        repository
            .transition(id, &[MailboxState::Active], MailboxState::Paused, now)
            .await
            .unwrap()
    );
    assert!(!repository.activate(id, &grant()).await.unwrap());
    repository
        .record_failure(id, MailboxState::Failed, ProvisioningFailure::Rejected)
        .await
        .unwrap();

    let paused = repository.live_mailbox(&ada()).await.unwrap().unwrap();
    assert_eq!(paused.state, MailboxState::Paused);
    assert_eq!(paused.last_error, None);
    assert!(paused.paused_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_sweep_finds_stalled_releasing_and_long_paused_mailboxes(pool: PgPool) {
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

    let recent = repository
        .due_for_sweep(now - Duration::minutes(1), now - Duration::days(32), 10)
        .await
        .unwrap();
    let due = repository
        .due_for_sweep(now - Duration::minutes(1), now - Duration::days(30), 10)
        .await
        .unwrap();

    assert!(recent.is_empty());
    assert_eq!(
        due.iter().map(|mailbox| mailbox.id).collect::<Vec<_>>(),
        vec![id]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sends_dedupe_by_key_and_stop_at_the_caps(pool: PgPool) {
    let repository = PgAgentMailboxRepository::new(pool);
    let id = active_mailbox(&repository).await;
    let limits = SendLimits {
        per_hour: 2,
        per_day: 3,
    };
    let now = Utc::now();
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
        )
        .await
        .unwrap();
    repository
        .complete_send(id, Uuid::from_u128(1), &sent)
        .await
        .unwrap();
    let replay = repository
        .reserve_send(id, Uuid::from_u128(1), SendKind::Message, limits, now)
        .await
        .unwrap();
    let second = repository
        .reserve_send(
            id,
            Uuid::from_u128(2),
            SendKind::Reply,
            limits,
            now - Duration::minutes(30),
        )
        .await
        .unwrap();
    let in_flight_retry = repository
        .reserve_send(id, Uuid::from_u128(2), SendKind::Reply, limits, now)
        .await
        .unwrap();
    let third = repository
        .reserve_send(id, Uuid::from_u128(3), SendKind::Message, limits, now)
        .await
        .unwrap();
    let over_day = repository
        .reserve_send(id, Uuid::from_u128(4), SendKind::Message, limits, now)
        .await
        .unwrap();

    assert_eq!(first, SendReservation::Proceed);
    assert_eq!(replay, SendReservation::AlreadySent(sent));
    assert_eq!(second, SendReservation::Proceed);
    assert_eq!(in_flight_retry, SendReservation::Proceed);
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
        per_hour: 1,
        per_day: 10,
    };
    let now = Utc::now();

    repository
        .reserve_send(id, Uuid::from_u128(1), SendKind::Message, limits, now)
        .await
        .unwrap();
    repository
        .cancel_send(id, Uuid::from_u128(1))
        .await
        .unwrap();
    let after_cancel = repository
        .reserve_send(id, Uuid::from_u128(2), SendKind::Message, limits, now)
        .await
        .unwrap();
    let pruned = repository
        .prune_sends(now + Duration::seconds(1))
        .await
        .unwrap();

    assert_eq!(after_cancel, SendReservation::Proceed);
    assert_eq!(pruned, 1);
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
