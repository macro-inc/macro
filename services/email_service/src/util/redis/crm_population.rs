//! Pending CRM population entries: one hash per mailbox, address and
//! `live_mail`, holding the hints merged from every request since its
//! population last started and the claim of the one queued message that will
//! act on them.
//!
//! Fields: `claim` (the queued message's claim, absent after a failed send),
//! `claimed_at` (when the claim was taken or its message last ran, in
//! milliseconds), `first` and `last` (milliseconds since the epoch), `sent`
//! (`1` or `0`), `name` (empty for none), `fresh` (`1` when a request merged
//! since the run started) and `attempts` (failed runs of the current claim).
//! Every key of a mailbox shares its hash tag, so a request's keys sit in one
//! cluster slot.
//!
//! A claim whose message is gone (dead-lettered, or lost to a crash between
//! claiming and sending) would absorb every later request. So a claim that
//! has not been taken or run for [`STALE_CLAIM`] counts as unheld: the next
//! request claims the entry again and sends, and a message that finds it
//! adopts it. A message held only by a long queue is duplicated at worst; the
//! older copy then finds the entry superseded and merges into it.

use crate::util::redis::RedisClient;
use chrono::{DateTime, Utc};
use email::domain::crm_population::{ContactHints, PendingContact, SettledContact};
use models_email::service::backfill::PopulateCrmContactPayload;
use sha2::{Digest, Sha256};
use std::sync::LazyLock;
use std::time::Duration;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// How long an entry outlives its last request or hand-off. A message that
/// waits longer finds no entry and runs on its own hints, without the
/// "changes nothing" shortcut for a known contact.
const TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long a claim's message may go without starting a run before the claim
/// is taken over.
const STALE_CLAIM: Duration = Duration::from_secs(60 * 60);
const KEY_PREFIX: &str = "email:crm_population";

fn key(link: Uuid, contact: &PopulateCrmContactPayload) -> String {
    let kind = if contact.live_mail { "live" } else { "history" };
    // The hash keeps addresses out of key names.
    let address = Sha256::digest(contact.contact_email.as_bytes());
    format!("{KEY_PREFIX}:{{{link}}}:{kind}:{address:x}")
}

/// Merges each request into its entry and claims the entries no queued
/// message holds. Returns 1 for each newly claimed key, 0 for an absorbed one.
static RECORD: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r#"
        local clock = redis.call('TIME')
        local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
        local stale = tonumber(ARGV[2])
        local claimed = {}
        for i, key in ipairs(KEYS) do
          local at = 3 + (i - 1) * 5
          local first, last, sent, name = ARGV[at + 1], ARGV[at + 2], ARGV[at + 3], ARGV[at + 4]
          local held = redis.call('HMGET', key, 'claim', 'first', 'last', 'sent', 'name', 'claimed_at')
          if held[2] and tonumber(held[2]) < tonumber(first) then first = held[2] end
          if held[3] and tonumber(held[3]) > tonumber(last) then last = held[3] end
          if held[4] == '1' then sent = '1' end
          if name == '' and held[5] then name = held[5] end
          redis.call('HSET', key, 'first', first, 'last', last, 'sent', sent, 'name', name, 'fresh', '1')
          local live = held[1] and held[6] and now - tonumber(held[6]) < stale
          if live then
            claimed[i] = 0
          else
            redis.call('HSET', key, 'claim', ARGV[at], 'claimed_at', now, 'attempts', '0')
            claimed[i] = 1
          end
          redis.call('EXPIRE', key, ARGV[1])
        end
        return claimed
        "#,
    )
});

/// Drops each key's claim if it is still the given one, keeping its hints.
static RELEASE: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r#"
        for i, key in ipairs(KEYS) do
          if redis.call('HGET', key, 'claim') == ARGV[i] then
            redis.call('HDEL', key, 'claim')
            redis.call('HSET', key, 'fresh', '1')
          end
        end
        return 0
        "#,
    )
});

/// Starts a run: 1 with the hints when the entry is this claim's (adopting an
/// entry a failed send released, or one whose claim went stale), 2 when
/// another live claim holds it, 0 when there is no entry.
static TAKE: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r#"
        local clock = redis.call('TIME')
        local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
        local held = redis.call('HMGET', KEYS[1], 'claim', 'first', 'last', 'sent', 'name', 'claimed_at')
        if not held[2] then return {0, '', '', '', ''} end
        local other = held[1] and held[1] ~= ARGV[1]
        if other and held[6] and now - tonumber(held[6]) < tonumber(ARGV[2]) then
          return {2, '', '', '', ''}
        end
        if other then redis.call('HSET', KEYS[1], 'attempts', '0') end
        redis.call('HSET', KEYS[1], 'claim', ARGV[1], 'claimed_at', now, 'fresh', '0')
        return {1, held[2], held[3], held[4], held[5] or ''}
        "#,
    )
});

/// Counts a failed run of this claim; 0 when another claim holds the entry.
static FAIL: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r#"
        if redis.call('HGET', KEYS[1], 'claim') ~= ARGV[1] then return 0 end
        local clock = redis.call('TIME')
        redis.call('HSET', KEYS[1], 'claimed_at', tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000))
        return redis.call('HINCRBY', KEYS[1], 'attempts', 1)
        "#,
    )
});

/// Ends this claim's turn: hands the entry to the next claim with its hints
/// (1) when a request merged during the run, otherwise deletes it (0).
static SETTLE: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r#"
        local held = redis.call('HMGET', KEYS[1], 'claim', 'fresh', 'first', 'last', 'sent', 'name')
        if held[1] ~= ARGV[1] then return {0, '', '', '', ''} end
        if held[2] == '1' then
          local clock = redis.call('TIME')
          local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
          redis.call('HSET', KEYS[1], 'claim', ARGV[2], 'claimed_at', now, 'attempts', '0')
          redis.call('EXPIRE', KEYS[1], ARGV[3])
          return {1, held[3], held[4], held[5], held[6] or ''}
        end
        redis.call('DEL', KEYS[1])
        return {0, '', '', '', ''}
        "#,
    )
});

/// Gives a handed entry back to the previous claim, as still fresh.
static RESTORE: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r#"
        if redis.call('HGET', KEYS[1], 'claim') == ARGV[2] then
          local clock = redis.call('TIME')
          local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
          redis.call('HSET', KEYS[1], 'claim', ARGV[1], 'claimed_at', now, 'fresh', '1')
        end
        return 0
        "#,
    )
});

/// Deletes the entry if this claim holds it: its mailbox is gone or has no
/// team, so its requests mean nothing.
static DISCARD: LazyLock<redis::Script> = LazyLock::new(|| {
    redis::Script::new(
        r#"
        if redis.call('HGET', KEYS[1], 'claim') == ARGV[1] then redis.call('DEL', KEYS[1]) end
        return 0
        "#,
    )
});

/// A script reply carrying an entry's hints: status, first, last, sent, name.
type HintsReply = (u8, String, String, String, String);

fn hints(reply: &HintsReply) -> anyhow::Result<ContactHints> {
    let (_, first, last, sent, name) = reply;
    let at = |millis: &str| {
        millis
            .parse::<i64>()
            .ok()
            .and_then(DateTime::<Utc>::from_timestamp_millis)
            .ok_or_else(|| anyhow::anyhow!("a pending CRM population holds an invalid timestamp"))
    };
    Ok(ContactHints {
        first_at: at(first)?,
        last_at: at(last)?,
        is_sent: sent == "1",
        name: (!name.is_empty()).then(|| name.clone()),
    })
}

impl RedisClient {
    /// See [`email::domain::crm_population::PendingContacts::record`].
    pub async fn record_crm_population(
        &self,
        link: Uuid,
        requests: &[(Uuid, PopulateCrmContactPayload)],
    ) -> anyhow::Result<Vec<bool>> {
        let mut invocation = RECORD.prepare_invoke();
        invocation
            .arg(TTL.as_secs())
            .arg(STALE_CLAIM.as_millis().to_string());
        for (claim, contact) in requests {
            invocation
                .key(key(link, contact))
                .arg(claim.to_string())
                .arg(contact.first_at.timestamp_millis())
                .arg(contact.last_at.timestamp_millis())
                .arg(u8::from(contact.is_sent))
                .arg(contact.contact_name.as_deref().unwrap_or_default());
        }
        let mut connection = self.inner.get_multiplexed_async_connection().await?;
        let claimed: Vec<u8> = invocation.invoke_async(&mut connection).await?;
        anyhow::ensure!(
            claimed.len() == requests.len(),
            "the CRM population record answered {} of {} requests",
            claimed.len(),
            requests.len()
        );
        Ok(claimed.into_iter().map(|claimed| claimed == 1).collect())
    }

    /// See [`email::domain::crm_population::PendingContacts::release`].
    pub async fn release_crm_population(
        &self,
        link: Uuid,
        claimed: &[(Uuid, PopulateCrmContactPayload)],
    ) -> redis::RedisResult<()> {
        let mut invocation = RELEASE.prepare_invoke();
        for (claim, contact) in claimed {
            invocation.key(key(link, contact)).arg(claim.to_string());
        }
        let mut connection = self.inner.get_multiplexed_async_connection().await?;
        let _: i64 = invocation.invoke_async(&mut connection).await?;
        Ok(())
    }

    /// See [`email::domain::crm_population::PendingContacts::take`].
    pub async fn take_crm_population(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> anyhow::Result<PendingContact> {
        let mut connection = self.inner.get_multiplexed_async_connection().await?;
        let reply: HintsReply = TAKE
            .key(key(link, contact))
            .arg(claim.to_string())
            .arg(STALE_CLAIM.as_millis().to_string())
            .invoke_async(&mut connection)
            .await?;
        match reply.0 {
            1 => Ok(PendingContact::Claimed(hints(&reply)?)),
            2 => Ok(PendingContact::Superseded),
            _ => Ok(PendingContact::Missing),
        }
    }

    /// See [`email::domain::crm_population::PendingContacts::fail`].
    pub async fn fail_crm_population(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> redis::RedisResult<Option<u32>> {
        let mut connection = self.inner.get_multiplexed_async_connection().await?;
        let attempts: u32 = FAIL
            .key(key(link, contact))
            .arg(claim.to_string())
            .invoke_async(&mut connection)
            .await?;
        Ok((attempts > 0).then_some(attempts))
    }

    /// See [`email::domain::crm_population::PendingContacts::settle`].
    pub async fn settle_crm_population(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
        next: Uuid,
    ) -> anyhow::Result<SettledContact> {
        let mut connection = self.inner.get_multiplexed_async_connection().await?;
        let reply: HintsReply = SETTLE
            .key(key(link, contact))
            .arg(claim.to_string())
            .arg(next.to_string())
            .arg(TTL.as_secs())
            .invoke_async(&mut connection)
            .await?;
        match reply.0 {
            1 => Ok(SettledContact::Handed(hints(&reply)?)),
            _ => Ok(SettledContact::Cleared),
        }
    }

    /// See [`email::domain::crm_population::PendingContacts::discard`].
    pub async fn discard_crm_population(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
    ) -> redis::RedisResult<()> {
        let mut connection = self.inner.get_multiplexed_async_connection().await?;
        let _: i64 = DISCARD
            .key(key(link, contact))
            .arg(claim.to_string())
            .invoke_async(&mut connection)
            .await?;
        Ok(())
    }

    /// See [`email::domain::crm_population::PendingContacts::restore`].
    pub async fn restore_crm_population(
        &self,
        link: Uuid,
        contact: &PopulateCrmContactPayload,
        claim: Uuid,
        next: Uuid,
    ) -> redis::RedisResult<()> {
        let mut connection = self.inner.get_multiplexed_async_connection().await?;
        let _: i64 = RESTORE
            .key(key(link, contact))
            .arg(claim.to_string())
            .arg(next.to_string())
            .invoke_async(&mut connection)
            .await?;
        Ok(())
    }
}
