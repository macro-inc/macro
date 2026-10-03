use crate::domain::{model::*, ports::*};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;
#[derive(Clone)]
pub struct PgRepository {
    pub pool: PgPool,
}
impl TicketLock for Transaction<'static, Postgres> {}
fn decode<T: serde::de::DeserializeOwned>(values: Vec<serde_json::Value>) -> Result<Vec<T>> {
    values
        .into_iter()
        .map(|v| serde_json::from_value(v).map_err(Into::into))
        .collect()
}
#[async_trait]
impl Repository for PgRepository {
    async fn settings(&self, team: Uuid) -> Result<Option<TeamSettings>> {
        let row=sqlx::query!("SELECT record, email_cursor_at, email_cursor_id FROM support_settings WHERE team_id=$1",team).fetch_optional(&self.pool).await?;
        row.map(|r| {
            let mut value: TeamSettings = serde_json::from_value(r.record)?;
            value.email_cursor_at = r.email_cursor_at;
            value.email_cursor_id = r.email_cursor_id;
            Ok(value)
        })
        .transpose()
    }
    async fn save_settings(&self, value: &TeamSettings) -> Result<()> {
        let record = serde_json::to_value(value)?;
        sqlx::query!("INSERT INTO support_settings(team_id,user_id,widget_key,record,email_cursor_at,email_cursor_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(team_id) DO UPDATE SET user_id=EXCLUDED.user_id,record=EXCLUDED.record,email_cursor_at=EXCLUDED.email_cursor_at,email_cursor_id=EXCLUDED.email_cursor_id WHERE support_settings.widget_key=EXCLUDED.widget_key",value.team_id,value.user_id,value.settings.widget_key,record,value.email_cursor_at,value.email_cursor_id).execute(&self.pool).await?;
        Ok(())
    }
    async fn widget(&self, key: Uuid) -> Result<Option<TeamSettings>> {
        let value = sqlx::query_scalar!(
            "SELECT record FROM support_settings WHERE widget_key=$1",
            key
        )
        .fetch_optional(&self.pool)
        .await?;
        value
            .map(serde_json::from_value)
            .transpose()
            .map_err(Into::into)
    }
    async fn active_settings(&self) -> Result<Vec<TeamSettings>> {
        let rows=sqlx::query!("UPDATE support_settings SET last_swept_at=now() WHERE team_id IN (SELECT team_id FROM support_settings ORDER BY last_swept_at LIMIT 50 FOR UPDATE SKIP LOCKED) RETURNING record,email_cursor_at,email_cursor_id").fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|r| {
                let mut v: TeamSettings = serde_json::from_value(r.record)?;
                v.email_cursor_at = r.email_cursor_at;
                v.email_cursor_id = r.email_cursor_id;
                Ok(v)
            })
            .collect()
    }
    async fn tickets(&self, team: Uuid, filter: &TicketFilter) -> Result<Vec<Ticket>> {
        let company = filter.company_id.map(|id| id.to_string());
        let contact = filter.contact_id.map(|id| id.to_string());
        let before_id = filter.before_id.unwrap_or(Uuid::max());
        decode(sqlx::query_scalar!("SELECT record FROM support_tickets WHERE team_id=$1 AND ($2::text IS NULL OR record->'customer'->>'company_id'=$2) AND ($3::text IS NULL OR record->'customer'->>'contact_id'=$3) AND ($4::timestamptz IS NULL OR (updated_at,id)<($4,$5)) ORDER BY updated_at DESC,id DESC LIMIT 100",team,company,contact,filter.before,before_id).fetch_all(&self.pool).await?)
    }
    async fn ticket(&self, team: Uuid, id: Uuid) -> Result<Ticket> {
        let value = sqlx::query_scalar!(
            "SELECT record FROM support_tickets WHERE id=$1 AND team_id=$2",
            id,
            team
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(Error::NotFound)?;
        Ok(serde_json::from_value(value)?)
    }
    async fn email_ticket(&self, team: Uuid, thread: Uuid) -> Result<Option<Ticket>> {
        let value = sqlx::query_scalar!(
            "SELECT record FROM support_tickets WHERE team_id=$1 AND email_thread_id=$2",
            team,
            thread
        )
        .fetch_optional(&self.pool)
        .await?;
        value
            .map(serde_json::from_value)
            .transpose()
            .map_err(Into::into)
    }
    async fn save(
        &self,
        ticket: &Ticket,
        message: Option<&Message>,
        due: Option<DateTime<Utc>>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let record = serde_json::to_value(ticket)?;
        let result=sqlx::query!("INSERT INTO support_tickets(id,team_id,channel_id,email_thread_id,record,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET record=EXCLUDED.record,updated_at=EXCLUDED.updated_at WHERE support_tickets.team_id=EXCLUDED.team_id",ticket.id,ticket.team_id,ticket.channel_id,ticket.email_thread_id,record,ticket.updated_at).execute(&mut *tx).await?;
        if result.rows_affected() != 1 {
            return Err(Error::Forbidden);
        }
        if let Some(m) = message {
            let record = serde_json::to_value(m)?;
            sqlx::query!("INSERT INTO support_messages(id,ticket_id,public,email_message_id,record,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",m.id,ticket.id,m.public,m.email_message_id,record,m.created_at).execute(&mut *tx).await?;
        }
        if let (Some(due), Some(trigger)) = (due, ticket.last_customer_message_id) {
            sqlx::query!("INSERT INTO support_agent_jobs(ticket_id,trigger_id,due_at) VALUES($1,$2,$3) ON CONFLICT(ticket_id) DO UPDATE SET trigger_id=EXCLUDED.trigger_id,due_at=EXCLUDED.due_at,lease_until=NULL,attempts=0",ticket.id,trigger,due).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }
    async fn messages(&self, team: Uuid, id: Uuid, public_only: bool) -> Result<Vec<Message>> {
        let values=sqlx::query_scalar!("SELECT m.record FROM support_messages m JOIN support_tickets t ON t.id=m.ticket_id WHERE t.id=$1 AND t.team_id=$2 AND (NOT $3 OR m.public) ORDER BY m.created_at DESC,m.id DESC LIMIT 200",id,team,public_only).fetch_all(&self.pool).await?;
        let mut messages = decode::<Message>(values)?;
        messages.reverse();
        Ok(messages)
    }
    async fn message(&self, team: Uuid, ticket: Uuid, id: Uuid) -> Result<Option<Message>> {
        let value=sqlx::query_scalar!("SELECT m.record FROM support_messages m JOIN support_tickets t ON t.id=m.ticket_id WHERE t.id=$1 AND t.team_id=$2 AND m.id=$3",ticket,team,id).fetch_optional(&self.pool).await?;
        value
            .map(serde_json::from_value)
            .transpose()
            .map_err(Into::into)
    }
    async fn lock(&self, id: Uuid) -> Result<Box<dyn TicketLock>> {
        let mut tx = self.pool.begin().await?;
        let key = i64::from_be_bytes(
            id.as_bytes()[8..]
                .try_into()
                .map_err(|_| Error::Forbidden)?,
        );
        sqlx::query!("SELECT pg_advisory_xact_lock($1)", key)
            .execute(&mut *tx)
            .await?;
        Ok(Box::new(tx))
    }
    async fn tasks(&self, team: Uuid, ticket: Uuid) -> Result<Vec<String>> {
        Ok(sqlx::query_scalar!("SELECT task_id FROM support_task_links WHERE team_id=$1 AND ticket_id=$2 ORDER BY task_id LIMIT 20",team,ticket).fetch_all(&self.pool).await?)
    }
    async fn link_task(&self, team: Uuid, ticket: Uuid, task: &str, remove: bool) -> Result<()> {
        if remove {
            sqlx::query!(
                "DELETE FROM support_task_links WHERE team_id=$1 AND ticket_id=$2 AND task_id=$3",
                team,
                ticket,
                task
            )
            .execute(&self.pool)
            .await?;
        } else {
            sqlx::query!("INSERT INTO support_task_links(team_id,ticket_id,task_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",team,ticket,task).execute(&self.pool).await?;
        }
        Ok(())
    }
    async fn visitor(&self, hash: &[u8], origin: &str) -> Result<(Uuid, Uuid)> {
        let row=sqlx::query!("SELECT t.team_id,t.id FROM support_visitor_sessions s JOIN support_tickets t ON t.id=s.ticket_id WHERE s.token_hash=$1 AND s.origin=$2 AND s.expires_at>now()",hash,origin).fetch_optional(&self.pool).await?.ok_or(Error::Forbidden)?;
        Ok((row.team_id, row.id))
    }
    async fn save_visitor(&self, hash: &[u8], ticket: Uuid, origin: &str) -> Result<()> {
        sqlx::query!("INSERT INTO support_visitor_sessions(token_hash,ticket_id,origin,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",hash,ticket,origin).execute(&self.pool).await?;
        Ok(())
    }
    async fn rate(&self, bucket: &str, limit: i32) -> Result<()> {
        let count=sqlx::query_scalar!("INSERT INTO support_rate_limits(bucket,window_at,requests) VALUES($1,now(),1) ON CONFLICT(bucket) DO UPDATE SET requests=CASE WHEN support_rate_limits.window_at < now()-interval '1 minute' THEN 1 ELSE support_rate_limits.requests+1 END,window_at=CASE WHEN support_rate_limits.window_at < now()-interval '1 minute' THEN now() ELSE support_rate_limits.window_at END RETURNING requests",bucket).fetch_one(&self.pool).await?;
        if count > limit {
            Err(Error::RateLimited)
        } else {
            Ok(())
        }
    }
    async fn jobs(&self) -> Result<Vec<Job>> {
        let rows=sqlx::query!("UPDATE support_agent_jobs j SET lease_until=now()+interval '5 minutes',attempts=attempts+1 FROM support_tickets t WHERE t.id=j.ticket_id AND j.ticket_id IN (SELECT ticket_id FROM support_agent_jobs WHERE due_at<=now() AND (lease_until IS NULL OR lease_until<now()) AND attempts<5 ORDER BY due_at LIMIT 4 FOR UPDATE SKIP LOCKED) RETURNING j.ticket_id,j.trigger_id,t.team_id").fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|r| Job {
                ticket_id: r.ticket_id,
                trigger_id: r.trigger_id,
                team_id: r.team_id,
            })
            .collect())
    }
    async fn finish_job(&self, job: &Job, due: Option<DateTime<Utc>>) -> Result<()> {
        if let Some(due) = due {
            sqlx::query!("UPDATE support_agent_jobs SET due_at=$3,lease_until=NULL,attempts=0 WHERE ticket_id=$1 AND trigger_id=$2",job.ticket_id,job.trigger_id,due).execute(&self.pool).await?;
        } else {
            sqlx::query!(
                "DELETE FROM support_agent_jobs WHERE ticket_id=$1 AND trigger_id=$2",
                job.ticket_id,
                job.trigger_id
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }
    async fn cursor(&self, team: Uuid, at: DateTime<Utc>, id: Uuid) -> Result<()> {
        sqlx::query!("UPDATE support_settings SET email_cursor_at=$2,email_cursor_id=$3 WHERE team_id=$1 AND (email_cursor_at,email_cursor_id)<($2,$3)",team,at,id).execute(&self.pool).await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;

impl From<sqlx::Error> for Error {
    fn from(e: sqlx::Error) -> Self {
        Self::Internal(rootcause::report!(e).into())
    }
}
