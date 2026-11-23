use super::*;
use crate::domain::ports::Result;
use async_trait::async_trait;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::mpsc;

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@test.com"))
        .unwrap()
        .into_owned()
}

/// Sends each user it is told connected Granola.
struct Connected(mpsc::UnboundedSender<MacroUserIdStr<'static>>);

#[async_trait]
impl SyncService for Connected {
    async fn receive(
        &self,
        _id: Uuid,
        _delivery: Delivery<'_>,
    ) -> std::result::Result<(), SyncError> {
        Ok(())
    }
    async fn tick(&self) -> Result<bool> {
        Ok(false)
    }
    async fn reconcile(&self) -> Result<()> {
        Ok(())
    }
    async fn connected(&self, user: MacroUserIdStr<'static>) -> Result<()> {
        let _ = self.0.send(user);
        Ok(())
    }
}

#[tokio::test]
async fn only_a_granola_connect_restarts_sync() {
    let (sender, mut connected) = mpsc::unbounded_channel();
    let hook = connected_hook(Arc::new(Connected(sender)));

    hook(ConnectorChange {
        user: user("a"),
        key: ConnectorKey::App(ConnectorId::parse("linear").unwrap()),
    })
    .await;
    hook(ConnectorChange {
        user: user("b"),
        key: ConnectorKey::App(ConnectorId::parse("granola").unwrap()),
    })
    .await;
    drop(hook);

    // The channel closes once the hook and its one task are gone.
    assert_eq!(connected.recv().await, Some(user("b")));
    assert_eq!(connected.recv().await, None);
}
