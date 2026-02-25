//! Redis implementation of [LastOnlineRepo]

use crate::domain::ports::LastOnlineRepo;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use redis::AsyncCommands;
use redis::aio::MultiplexedConnection;
use rootcause::Report;

/// TTL for last_online keys: 30 days
const TTL_SECONDS: u64 = 30 * 24 * 60 * 60;

/// Redis-backed implementation of [LastOnlineRepo]
pub struct RedisLastOnlineRepo {
    conn: MultiplexedConnection,
}

impl RedisLastOnlineRepo {
    /// Create a new [RedisLastOnlineRepo] with the given Redis connection
    pub fn new(conn: MultiplexedConnection) -> Self {
        Self { conn }
    }

    fn key(user: &MacroUserIdStr<'_>) -> String {
        format!("last_online:{}", user.as_ref())
    }
}

impl LastOnlineRepo for RedisLastOnlineRepo {
    async fn set_last_online(
        &self,
        user: MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<(), Report> {
        let mut conn = self.conn.clone();
        let key = Self::key(&user);
        let value = now.to_rfc3339();
        conn.set_ex::<_, _, ()>(&key, value, TTL_SECONDS).await?;
        Ok(())
    }

    async fn get_last_online(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> Result<Option<DateTime<Utc>>, Report> {
        let mut conn = self.conn.clone();
        let key = Self::key(&user);
        let value: Option<String> = conn.get(&key).await?;
        match value {
            Some(s) => Ok(Some(DateTime::parse_from_rfc3339(&s)?.with_timezone(&Utc))),
            None => Ok(None),
        }
    }
}
