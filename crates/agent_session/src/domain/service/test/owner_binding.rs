use super::*;

struct RejectOwner {
    expected: SessionClaim,
    called: Arc<std::sync::atomic::AtomicBool>,
}

impl Transport<ToRuntimeMessage, ToServerMessage> for RejectOwner {
    type Sender = PendingSender;
    type Receiver = PendingReceiver;

    fn bind_session_owner(
        &mut self,
        session: Uuid,
        replica: Uuid,
        fence: i64,
    ) -> std::result::Result<(), TransportError> {
        assert_eq!(session, self.expected.session.as_uuid());
        assert_eq!(replica, self.expected.replica.as_uuid());
        assert_eq!(fence, self.expected.fence.0);
        self.called.store(true, std::sync::atomic::Ordering::SeqCst);
        Err(TransportError::Client("stale attachment".into()))
    }

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
    let result = fx
        .service
        .activate_reserved(
            session,
            RuntimeAttachment::solo(RejectOwner {
                expected: claim,
                called: called.clone(),
            }),
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
