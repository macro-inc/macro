//! The clear log in Redis, shared by every server, expiring once undo is no
//! longer offered.

use attention_feed::domain::models::DoneReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use redis::{AsyncCommands, aio::MultiplexedConnection};
use rootcause::Report;
use uuid::Uuid;

use crate::domain::{
    models::{ClearProgress, ClearStep},
    ports::ClearLog,
};

#[cfg(test)]
mod test;

/// How long a clear can be undone: a day, well past the undo the app offers.
const TTL_SECONDS: i64 = 24 * 60 * 60;

/// Records a batch while the clear's state exists. Returns 0 to continue, 1
/// when cancelled, 2 when the log is gone (nothing recorded).
const RECORD_SCRIPT: &str = r"
if redis.call('EXISTS', KEYS[1]) == 0 then return 2 end
if ARGV[2] ~= '' then
  redis.call('RPUSH', KEYS[2], ARGV[2])
  redis.call('EXPIRE', KEYS[2], ARGV[3])
end
redis.call('HINCRBY', KEYS[1], 'rows', ARGV[1])
if redis.call('HGET', KEYS[1], 'cancelled') == '1' then return 1 end
return 0
";

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
    ) -> Result<ClearStep, Report> {
        // One script, so a log an undo already took stays gone instead of
        // being recreated by this batch.
        let encoded = if receipt.keys.is_empty() {
            String::new()
        } else {
            receipt.encode()
        };
        let step: u8 = redis::Script::new(RECORD_SCRIPT)
            .key(state_key(user, id))
            .key(receipts_key(user, id))
            .arg(rows)
            .arg(encoded)
            .arg(TTL_SECONDS)
            .invoke_async(&mut self.conn.clone())
            .await?;
        Ok(match step {
            0 => ClearStep::Continue,
            1 => ClearStep::Stop,
            _ => ClearStep::Orphaned,
        })
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

    async fn receipts(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<Vec<DoneReceipt>, Report> {
        let encoded: Vec<String> = self
            .conn
            .clone()
            .lrange(receipts_key(user, id), 0, -1)
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

    async fn remove(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<(), Report> {
        let _: () = self
            .conn
            .clone()
            .del(&[state_key(user, id), receipts_key(user, id)])
            .await?;
        Ok(())
    }
}
