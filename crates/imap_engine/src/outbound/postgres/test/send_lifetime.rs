use super::*;
use crate::domain::service::{
    Engine,
    test::{TestCipher, UncertainTransport, send_lifetime::PendingSubmission},
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicU32, Ordering},
};

#[sqlx::test(migrations = false)]
async fn an_expired_submit_lease_allows_other_mail_but_never_resends_the_unknown_message(
    pool: PgPool,
) {
    schema(&pool).await;
    let mut fixture = PendingSubmission::new().await;
    let binding = fixture.binding;
    sqlx::query!(
        "INSERT INTO email_links(id,macro_id,provider) VALUES($1,'owner','IMAP')",
        binding.link_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO imap_accounts(link_id,user_id,sync_generation,grant_generation,credential_ciphertext,state) VALUES($1,'owner',1,1,decode('01','hex'),$2)", binding.link_id, serde_json::to_value(AccountState::default()).unwrap())
        .execute(&pool).await.unwrap();
    let first_repository = Arc::new(PgRepository::new(pool.clone()));
    let first = Arc::new(Engine::new(
        first_repository.clone(),
        Arc::new(TestCipher),
        fixture.transport.clone(),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    ));
    let input = fixture.repository.state.lock().unwrap().drafts[&fixture.draft.id]
        .input
        .clone();
    let draft: Draft = serde_json::from_value(
        first
            .execute(
                binding,
                Operation::CreateDraft {
                    input: input.clone(),
                },
            )
            .await
            .unwrap(),
    )
    .unwrap();
    // The fake transport's assertion is supplementary: the real PG read below
    // proves the durable Unknown fence was saved before the provider barrier.
    fixture
        .repository
        .saved_unknown
        .store(true, Ordering::Release);
    let id = draft.id.clone();
    let sending =
        tokio::spawn(async move { first.execute(binding, Operation::Submit { id }).await });
    assert_eq!(fixture.started.recv().await, Some(binding.link_id));
    let saved = first_repository
        .read_scoped(
            binding,
            StateSelection::Draft {
                id: draft.id.clone(),
                reply_to: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        saved.state.drafts[&draft.id].submission,
        Some(SubmissionOutcome::Unknown)
    );

    // Simulate the actual expiry caused by repeated failed renewals, without
    // waiting for wall time or changing the immutable submission tombstone.
    sqlx::query!(
        "UPDATE imap_accounts SET lease_until=now()-interval '1 second' WHERE link_id=$1",
        binding.link_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let second_transport = Arc::new(UncertainTransport {
        repository: fixture.repository.clone(),
        submissions: AtomicU32::new(0),
        deadline: AtomicBool::new(false),
        submission_deadline: Default::default(),
        submit_control: None,
        refusal: None,
        sent_found: Default::default(),
        provider_work: None,
    });
    let second_repository = Arc::new(PgRepository::new(pool.clone()));
    let second = Engine::new(
        second_repository.clone(),
        Arc::new(TestCipher),
        second_transport.clone(),
        tokio_util::task::TaskTracker::new(),
        tokio_util::sync::CancellationToken::new(),
    );
    let repeated = second
        .execute(
            binding,
            Operation::Submit {
                id: draft.id.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_value::<SubmissionOutcome>(repeated).unwrap(),
        SubmissionOutcome::Unknown
    );
    assert_eq!(second_transport.submissions.load(Ordering::Acquire), 0);

    let mut other_input = input;
    other_input.correlation = Uuid::now_v7();
    other_input.content["message_id"] = serde_json::json!("different-queued-message@example.net");
    let other: Draft = serde_json::from_value(
        second
            .execute(binding, Operation::CreateDraft { input: other_input })
            .await
            .unwrap(),
    )
    .unwrap();
    let outcome = second
        .execute(
            binding,
            Operation::Submit {
                id: other.id.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_value::<SubmissionOutcome>(outcome).unwrap(),
        SubmissionOutcome::Unknown
    );
    assert_eq!(second_transport.submissions.load(Ordering::Acquire), 1);
    assert_eq!(fixture.transport.submissions.load(Ordering::Acquire), 1);

    fixture.control.released.add_permits(1);
    assert!(
        sending.await.unwrap().is_err(),
        "the expired first lease cannot overwrite newer state"
    );
    let after = second_repository
        .read_scoped(
            binding,
            StateSelection::Draft {
                id: draft.id.clone(),
                reply_to: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        after.state.drafts[&draft.id].submission,
        Some(SubmissionOutcome::Unknown)
    );
}
