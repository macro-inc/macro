use super::*;

struct RejectOwner;

impl Transport<ToRuntimeMessage, ToServerMessage> for RejectOwner {
    type Sender = PendingSender;
    type Receiver = PendingReceiver;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        panic!("a rejected attachment must never start an actor")
    }
}

#[tokio::test]
async fn owner_activation_failure_releases_reservation_without_starting_actor() {
    let fx = fixture();
    let reservation = fx.service.reserve_attach(fx.session).await.unwrap();
    let session = fx.repo.get(fx.session).await.unwrap();
    let claim = claim_for_test(&fx.repo, fx.session).await;
    let called = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let observed = called.clone();
    let result = fx
        .service
        .activate_reserved(
            session,
            RuntimeAttachment::solo(RejectOwner).on_activate(Box::new(move |actual| {
                assert_eq!(actual.session, claim.session);
                assert_eq!(actual.replica, claim.replica);
                assert_eq!(actual.fence, claim.fence);
                observed.store(true, std::sync::atomic::Ordering::SeqCst);
                Err(TransportError::Client("stale attachment".into()).into())
            })),
            reservation,
            claim,
        )
        .await;
    assert!(matches!(result, Err(AgentSessionError::Transport(_))));
    assert!(called.load(std::sync::atomic::Ordering::SeqCst));
    assert!(!fx.service.active.contains_key(&fx.session));
    assert!(fx.service.tasks.is_empty());
    assert!(fx.service.reserve_attach(fx.session).await.is_ok());
}
