use super::*;
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

#[derive(Default)]
struct Fake {
    claimed: AtomicBool,
    calls: Mutex<Vec<&'static str>>,
    fail_send: bool,
}

impl ScheduledDeliveryRepo for Fake {
    type Claim = ();
    type Sent = ();

    async fn try_claim(&self, _: Uuid, _: Uuid) -> anyhow::Result<Option<()>> {
        self.calls.lock().unwrap().push("claim");
        Ok((!self.claimed.swap(true, Ordering::SeqCst)).then_some(()))
    }
    async fn complete(&self, _: &(), _: ()) -> anyhow::Result<()> {
        self.calls.lock().unwrap().push("complete");
        Ok(())
    }
    async fn release(&self, _: ()) -> anyhow::Result<()> {
        self.calls.lock().unwrap().push("release");
        self.claimed.store(false, Ordering::SeqCst);
        Ok(())
    }
}

impl ScheduledMessageSender<(), ()> for Fake {
    async fn send_claimed(&self, _: &()) -> anyhow::Result<()> {
        self.calls.lock().unwrap().push("send");
        anyhow::ensure!(!self.fail_send, "provider failed");
        Ok(())
    }
}

#[tokio::test]
async fn loser_never_sends_completes_or_releases_winner() {
    let fake = Fake::default();
    fake.claimed.store(true, Ordering::SeqCst);
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(*fake.calls.lock().unwrap(), ["claim"]);
    assert!(fake.claimed.load(Ordering::SeqCst));
}

#[tokio::test]
async fn successful_delivery_completes_without_a_late_release() {
    let fake = Fake::default();
    deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
        .await
        .unwrap();
    assert_eq!(*fake.calls.lock().unwrap(), ["claim", "send", "complete"]);
}

#[tokio::test]
async fn only_failed_winner_releases() {
    let fake = Fake {
        fail_send: true,
        ..Fake::default()
    };
    assert!(
        deliver_scheduled(&fake, &fake, Uuid::nil(), Uuid::nil())
            .await
            .is_err()
    );
    assert_eq!(*fake.calls.lock().unwrap(), ["claim", "send", "release"]);
}
