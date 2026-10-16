//! Disposable notification daemon for the isolated WebKit regression runner.
//! Not part of the application; refuses to replace an existing notification service.

#[cfg(target_os = "linux")]
mod linux {
    use std::{
        collections::{HashMap, HashSet},
        time::Duration,
    };
    use zbus::{message::Header, object_server::SignalEmitter, zvariant::OwnedValue};

    const SERVICE: &str = "org.freedesktop.Notifications";
    const PATH: &str = "/org/freedesktop/Notifications";

    #[derive(Default)]
    struct Daemon {
        next_id: u32,
        closed: Vec<u32>,
        removed: HashSet<u32>,
        senders: HashSet<String>,
    }

    #[derive(Debug, zbus::DBusError)]
    #[zbus(prefix = "org.freedesktop.Notifications.Error")]
    enum CloseError {
        NotFound(String),
    }

    #[zbus::interface(name = "org.freedesktop.Notifications")]
    impl Daemon {
        #[expect(clippy::too_many_arguments, reason = "freedesktop Notify signature")]
        fn notify(
            &mut self,
            _app: &str,
            replaces: u32,
            _icon: &str,
            _summary: &str,
            _body: &str,
            actions: Vec<String>,
            _hints: HashMap<String, OwnedValue>,
            _timeout: i32,
            #[zbus(header)] header: Header<'_>,
        ) -> u32 {
            self.senders.insert(header.sender().unwrap().to_string());
            assert_eq!(replaces, 0);
            assert_eq!(actions, ["default", "Open"]);
            self.next_id += 1;
            self.next_id
        }

        fn close_notification(&mut self, id: u32) -> Result<(), CloseError> {
            self.closed.push(id);
            if !self.removed.insert(id) {
                return Err(CloseError::NotFound("notification id was not found".into()));
            }
            Ok(())
        }

        fn snapshot(&self) -> String {
            serde_json::json!({
                "sent": self.next_id,
                "closed": self.closed,
                "connections": self.senders.len(),
            })
            .to_string()
        }

        async fn activate(
            &mut self,
            id: u32,
            #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        ) -> zbus::fdo::Result<()> {
            // Match Noctalia: activation removes the alert before the client
            // processes ActionInvoked and asks to close it.
            self.removed.insert(id);
            emitter
                .emit(SERVICE, "ActivationToken", &(id, "fixture-token"))
                .await?;
            emitter
                .emit(SERVICE, "ActionInvoked", &(id, "default"))
                .await?;
            Ok(())
        }

        async fn dismiss(
            &mut self,
            id: u32,
            #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        ) -> zbus::fdo::Result<()> {
            self.removed.insert(id);
            emitter
                .emit(SERVICE, "NotificationClosed", &(id, 2u32))
                .await?;
            Ok(())
        }
    }

    pub async fn run() {
        let _connection = zbus::connection::Builder::session()
            .unwrap()
            .name(SERVICE)
            .unwrap()
            .serve_at(PATH, Daemon::default())
            .unwrap()
            .build()
            .await
            .unwrap();
        println!("ready");
        tokio::time::sleep(Duration::from_secs(120)).await;
    }
}

#[tokio::main]
async fn main() {
    #[cfg(target_os = "linux")]
    linux::run().await;
}
