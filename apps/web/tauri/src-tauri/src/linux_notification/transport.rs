use std::collections::HashMap;

use futures_util::StreamExt;
use tokio::sync::oneshot;
use zbus::{
    Connection, Proxy,
    proxy::{OwnerChangedStream, SignalStream},
    zvariant::Value,
};

const SERVICE: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";
const DEFAULT_ACTION: &str = "default";

pub(super) struct Notification {
    proxy: Proxy<'static>,
    signals: SignalStream<'static>,
    owners: OwnerChangedStream<'static>,
    id: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Outcome {
    Activated(Option<String>),
    Dismissed,
}

impl Notification {
    pub(super) async fn show(
        connection: Connection,
        desktop_entry: &str,
        title: &str,
        body: Option<&str>,
        icon: Option<&str>,
    ) -> zbus::Result<Self> {
        let bus = zbus::fdo::DBusProxy::new(&connection).await?;
        let owner = match bus.get_name_owner(SERVICE.try_into()?).await {
            Ok(owner) => owner,
            Err(zbus::fdo::Error::NameHasNoOwner(_)) => {
                // Preserve D-Bus activation for lazily started daemons (e.g. dunst).
                bus.start_service_by_name(SERVICE.try_into()?, 0).await?;
                bus.get_name_owner(SERVICE.try_into()?).await?
            }
            Err(error) => return Err(error.into()),
        };
        // Pin the daemon's unique connection, not its replaceable service name:
        // a restarted daemon may reuse the same numeric notification IDs.
        let proxy = Proxy::new_owned(connection, owner, PATH, SERVICE).await?;
        // Subscribe BEFORE Notify: even an immediate click must not be lost.
        // One ordered stream preserves ActivationToken -> ActionInvoked ordering.
        let signals = proxy.receive_all_signals().await?;
        let owners = proxy.receive_owner_changed().await?;
        let hints = HashMap::from([("desktop-entry", Value::from(desktop_entry))]);
        let body = gtk::glib::markup_escape_text(body.unwrap_or_default());
        let id = proxy
            .call(
                "Notify",
                &(
                    "Macro",
                    0u32,
                    icon.unwrap_or("macro"),
                    title,
                    body.as_str(),
                    &[DEFAULT_ACTION, "Open"][..],
                    hints,
                    -1i32,
                ),
            )
            .await?;
        Ok(Self {
            proxy,
            signals,
            owners,
            id,
        })
    }

    async fn close(&self) -> zbus::Result<()> {
        let result = self
            .proxy
            .call::<_, _, ()>("CloseNotification", &(self.id,))
            .await;
        // Some daemons (including Noctalia) remove the alert as soon as it is
        // activated. Closing it afterward is successful, idempotent cleanup.
        if matches!(&result, Err(zbus::Error::MethodError(name, _, _))
            if name.as_str() == "org.freedesktop.Notifications.Error.NotFound")
        {
            return Ok(());
        }
        result.inspect_err(|error| {
            tracing::warn!(?error, "Unable to close Linux notification");
        })
    }

    pub(super) async fn wait(mut self, mut closed: oneshot::Receiver<()>) -> zbus::Result<Outcome> {
        let mut token = None;
        loop {
            let message = tokio::select! {
                biased;
                _ = self.owners.next() => return Ok(Outcome::Dismissed),
                _ = &mut closed => {
                    let _ = self.close().await;
                    return Ok(Outcome::Dismissed);
                }
                message = self.signals.next() => match message {
                    Some(message) => message,
                    None => return Ok(Outcome::Dismissed),
                },
            };
            match message.header().member().map(|name| name.as_str()) {
                Some("ActivationToken") => {
                    let (id, value): (u32, String) = message.body().deserialize()?;
                    if id == self.id {
                        token = Some(value);
                    }
                }
                Some("ActionInvoked") => {
                    let (id, action): (u32, String) = message.body().deserialize()?;
                    if id == self.id && action == DEFAULT_ACTION {
                        // Not all daemons remove a notification after activation.
                        let _ = self.close().await;
                        return Ok(Outcome::Activated(token));
                    }
                }
                Some("NotificationClosed") => {
                    let (id, _reason): (u32, u32) = message.body().deserialize()?;
                    if id == self.id {
                        return Ok(Outcome::Dismissed);
                    }
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod test;
