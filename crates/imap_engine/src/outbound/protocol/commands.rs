//! A bounded spare command connection for one exact mailbox credential generation.
use super::*;
use std::{
    collections::BTreeMap,
    ops::{Deref, DerefMut},
    time::Instant,
};

pub(super) struct Command {
    session: Session<Stream>,
    opened: Instant,
    idle_since: Instant,
    permit: Option<tokio::sync::OwnedSemaphorePermit>,
}
impl Deref for Command {
    type Target = Session<Stream>;
    fn deref(&self) -> &Self::Target {
        &self.session
    }
}
impl DerefMut for Command {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.session
    }
}
pub(super) type Pool = BTreeMap<String, Vec<Command>>;
impl ProtocolTransport {
    pub(super) async fn reclaim_commands(&self) {
        self.command_pool.lock().await.retain(|_, sessions| {
            sessions.retain(|session| {
                session.opened.elapsed() < Duration::from_secs(1800)
                    && session.idle_since.elapsed() < Duration::from_secs(60)
            });
            !sessions.is_empty()
        });
    }

    fn command_key(c: &Credentials) -> Option<String> {
        let b = c.binding?;
        let endpoint = serde_json::to_vec(&c.imap.endpoint).ok()?;
        Some(format!(
            "{}:{}:{}:{:x}",
            b.link_id,
            b.sync_generation,
            b.grant_generation,
            Sha256::digest(endpoint)
        ))
    }
    async fn command_permit(
        &self,
        c: &Credentials,
    ) -> Result<tokio::sync::OwnedSemaphorePermit, Error> {
        // Reconnect generations share admission even though their reusable
        // sockets remain generation-fenced in the separate command pool.
        let key = match c.binding {
            Some(binding) => format!("link:{}", binding.link_id),
            None => format!(
                "unbound:{:x}",
                Sha256::digest(format!(
                    "{}:{}:{}",
                    c.imap.endpoint.host, c.imap.endpoint.port, c.imap.endpoint.username
                ))
            ),
        };
        let capacity = {
            let mut accounts = self
                .command_capacity
                .lock()
                .map_err(|_| Error::ConnectionUnavailable)?;
            accounts.retain(|_, capacity| capacity.strong_count() > 0);
            if let Some(capacity) = accounts.get(&key).and_then(std::sync::Weak::upgrade) {
                capacity
            } else {
                if accounts.len() >= 4096 {
                    return Err(Error::Throttled);
                }
                let capacity = std::sync::Arc::new(tokio::sync::Semaphore::new(3));
                accounts.insert(key, std::sync::Arc::downgrade(&capacity));
                capacity
            }
        };
        capacity
            .acquire_owned()
            .await
            .map_err(|_| Error::ConnectionUnavailable)
    }
    pub(super) async fn command_session(&self, c: &Credentials) -> Result<Command, Error> {
        // Only command reads/writes share this quota. The owner's fresh sync
        // and IDLE sockets remain independent so reads cannot consume their slot.
        let permit = self.command_permit(c).await?;
        let key = Self::command_key(c);
        let previous = {
            let mut pool = self.command_pool.lock().await;
            pool.retain(|_, sessions| {
                sessions.retain(|session| {
                    session.opened.elapsed() < Duration::from_secs(1800)
                        && session.idle_since.elapsed() < Duration::from_secs(60)
                });
                !sessions.is_empty()
            });
            key.as_ref()
                .and_then(|key| pool.get_mut(key))
                .and_then(Vec::pop)
        };
        if let Some(mut previous) = previous {
            // A failed liveness check has not emitted a user command and can safely reconnect.
            if timeout(Duration::from_secs(10), previous.noop())
                .await
                .is_ok_and(|r| r.is_ok())
            {
                previous.permit = Some(permit);
                return Ok(previous);
            }
        }
        let session = self.imap(&c.imap).await?;
        let now = Instant::now();
        Ok(Command {
            session,
            opened: now,
            idle_since: now,
            permit: Some(permit),
        })
    }
    pub(super) async fn return_command(&self, c: &Credentials, mut connection: Command) {
        let Some(key) = Self::command_key(c) else {
            return;
        };
        if connection.opened.elapsed() >= Duration::from_secs(1800) {
            return;
        }
        connection.idle_since = Instant::now();
        let permit = connection.permit.take();
        let mut pool = self.command_pool.lock().await;
        pool.retain(|_, sessions| {
            sessions.retain(|session| session.idle_since.elapsed() < Duration::from_secs(60));
            !sessions.is_empty()
        });
        // Retain the three bounded account sessions without replacing a spare
        // during concurrent returns. The global idle socket cap stays at 64.
        if pool.values().map(Vec::len).sum::<usize>() < 64 {
            pool.entry(key).or_default().push(connection);
        }
        // Publish the reusable socket before waking a queued command. Otherwise
        // it could dial a fourth socket while this return is waiting on the pool.
        drop(pool);
        drop(permit);
    }
    pub(super) async fn evict_commands(&self, b: Binding) {
        let prefix = format!(
            "{}:{}:{}:",
            b.link_id, b.sync_generation, b.grant_generation
        );
        self.command_pool
            .lock()
            .await
            .retain(|key, _| !key.starts_with(&prefix));
    }
}

#[cfg(test)]
mod test;
