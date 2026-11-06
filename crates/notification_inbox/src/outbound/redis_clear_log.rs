//! The clear log in Redis, shared by every server, expiring once undo is no
//! longer offered.

use attention_feed::domain::models::DoneReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use redis::{AsyncCommands, aio::MultiplexedConnection};
use rootcause::Report;
use uuid::Uuid;

use crate::domain::{models::ClearProgress, ports::ClearLog};

#[cfg(test)]
mod test;

/// How long a clear can be undone: a day, well past the undo the app offers.
const TTL_SECONDS: i64 = 24 * 60 * 60;

/// [`ClearLog`] in Redis: a hash of the clear's state and a list of its
/// batches' receipts, keyed by viewer and clear.
#[derive(Clone)]
pub struct RedisClearLog {
    conn: MultiplexedConnection,
}

impl RedisClearLog {
    /// The log over a Redis connection.
    pub fn new(conn: MultiplexedConnection) -> Self {
        Self { conn }
    }
}

fn state_key(user: &MacroUserIdStr<'_>, id: Uuid) -> String {
    format!("notification_inbox:clear:{}:{id}", user.as_ref())
}

fn receipts_key(user: &MacroUserIdStr<'_>, id: Uuid) -> String {
    format!("{}:receipts", state_key(user, id))
}

impl ClearLog for RedisClearLog {
    async fn begin(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<(), Report> {
        let key = state_key(user, id);
        redis::pipe()
            .atomic()
            .hset_multiple(&key, &[("rows", 0), ("finished", 0), ("cancelled", 0)])
            .ignore()
            .expire(&key, TTL_SECONDS)
            .ignore()
            .exec_async(&mut self.conn.clone())
            .await?;
        Ok(())
    }

    async fn record(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        rows: usize,
        receipt: &DoneReceipt,
    ) -> Result<bool, Report> {
        let key = state_key(user, id);
        let receipts = receipts_key(user, id);
        let mut pipe = redis::pipe();
        pipe.atomic();
        if !receipt.keys.is_empty() {
            pipe.rpush(&receipts, receipt.encode())
                .ignore()
                .expire(&receipts, TTL_SECONDS)
                .ignore();
        }
        pipe.hincr(&key, "rows", rows)
            .ignore()
            .hget(&key, "cancelled");
        let (cancelled,): (Option<u8>,) = pipe.query_async(&mut self.conn.clone()).await?;
        Ok(cancelled == Some(1))
    }

    async fn finish(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<(), Report> {
        let _: () = self
            .conn
            .clone()
            .hset(state_key(user, id), "finished", 1)
            .await?;
        Ok(())
    }

    async fn progress(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Option<ClearProgress>, Report> {
        let (rows, finished): (Option<usize>, Option<u8>) = redis::cmd("HMGET")
            .arg(state_key(user, id))
            .arg("rows")
            .arg("finished")
            .query_async(&mut self.conn.clone())
            .await?;
        Ok(rows.map(|rows| ClearProgress {
            rows,
            finished: finished == Some(1),
        }))
    }

    async fn cancel(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<(), Report> {
        let key = state_key(user, id);
        let mut conn = self.conn.clone();
        // An expired or unknown clear has nothing to stop; don't recreate it.
        if conn.exists(&key).await? {
            let _: () = conn.hset(&key, "cancelled", 1).await?;
        }
        Ok(())
    }

    async fn take(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Vec<DoneReceipt>, Report> {
        let receipts = receipts_key(user, id);
        let (encoded,): (Vec<String>,) = redis::pipe()
            .atomic()
            .lrange(&receipts, 0, -1)
            .del(&receipts)
            .ignore()
            .del(state_key(user, id))
            .ignore()
            .query_async(&mut self.conn.clone())
            .await?;
        Ok(encoded
            .iter()
            .filter_map(|token| match DoneReceipt::decode(token) {
                Ok(receipt) => Some(receipt),
                Err(error) => {
                    tracing::warn!(error = ?error, "unreadable clear receipt");
                    None
                }
            })
            .collect())
    }
}
