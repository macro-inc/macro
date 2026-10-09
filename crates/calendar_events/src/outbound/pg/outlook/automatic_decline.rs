use super::*;
use crate::domain::outlook::automatic_decline::*;

impl AutomaticDeclineRepository for PgCalendarRepository {
    async fn away_candidates(
        &self,
        lease: &OutlookCalendarLease,
    ) -> Result<Vec<AwayCandidate>, Report> {
        let Some(target) = &lease.target else {
            return Ok(vec![]);
        };
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence(&mut tx, lease).await?;
        // Use this mailbox's source projection, not another calendar's canonical
        // copy. Fresh provider facts still authorize every eventual response.
        let rows = sqlx::query!(r#"
            WITH occurrences AS (
                SELECT s.provider_event_id, o.value->>'recurrenceId' AS recurrence_id,
                    COALESCE((o.value->'time'->>'startsAt')::timestamptz,
                        (o.value->'time'->>'startDate')::date::timestamp AT TIME ZONE COALESCE(c.time_zone,'UTC')) AS starts_at,
                    COALESCE((o.value->'time'->>'endsAt')::timestamptz,
                        (o.value->'time'->>'endDate')::date::timestamp AT TIME ZONE COALESCE(c.time_zone,'UTC')) AS ends_at,
                    COALESCE(x.value->'automaticDecline',s.automatic_decline) AS policy
                FROM calendar_event_sources s JOIN calendars c ON c.id=s.calendar_id
                CROSS JOIN LATERAL jsonb_array_elements(s.normalized_payload->'occurrences') o(value)
                LEFT JOIN LATERAL (
                    SELECT value FROM jsonb_array_elements(s.normalized_payload->'overrides')
                    WHERE value->>'recurrenceId'=o.value->>'recurrenceId' LIMIT 1
                ) x ON true
                WHERE s.calendar_id=$1 AND s.source_kind='outlook' AND NOT s.is_read_only
                    AND COALESCE((o.value->>'isCancelled')::bool,false)=false
            )
            SELECT a.provider_event_id AS "away!", a.recurrence_id AS "away_recurrence?",
                i.provider_event_id AS "invitation!", i.recurrence_id AS "invitation_recurrence?"
            FROM occurrences a JOIN occurrences i ON i.provider_event_id<>a.provider_event_id
            LEFT JOIN calendar_outlook_away_checks checked ON checked.work_id=$2
                AND checked.away_id=a.provider_event_id AND checked.away_recurrence=COALESCE(a.recurrence_id,'')
                AND checked.invitation_id=i.provider_event_id AND checked.invitation_recurrence=COALESCE(i.recurrence_id,'')
            WHERE a.policy->'properties'->>'autoDeclineMode'<>'decline_none'
                AND i.ends_at>now() AND a.starts_at<i.ends_at AND i.starts_at<a.ends_at
                AND (checked.next_check_at IS NULL OR checked.next_check_at<=now())
                AND NOT EXISTS(SELECT 1 FROM calendar_outlook_declines d
                    WHERE d.mailbox_key=calendar_outlook_mailbox_key($3)
                    AND d.invitation_id=i.provider_event_id AND d.recurrence_id IS NOT DISTINCT FROM i.recurrence_id)
            ORDER BY checked.checked_at NULLS FIRST,i.starts_at,a.provider_event_id,a.recurrence_id,i.provider_event_id,i.recurrence_id
            LIMIT 20
        "#, target.calendar_id, lease.id, lease.binding.link_id).fetch_all(&mut *tx).await.map_err(report)?;
        tx.commit().await.map_err(report)?;
        Ok(rows
            .into_iter()
            .map(|r| AwayCandidate {
                away_id: r.away,
                away_recurrence: r.away_recurrence,
                invitation_id: r.invitation,
                invitation_recurrence: r.invitation_recurrence,
            })
            .collect())
    }

    async fn away_submissions(
        &self,
        lease: &OutlookCalendarLease,
    ) -> Result<Vec<AwaySubmission>, Report> {
        let Some(target) = &lease.target else {
            return Ok(vec![]);
        };
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence(&mut tx, lease).await?;
        let rows=sqlx::query!("SELECT id,invitation_id,recurrence_id FROM calendar_outlook_declines WHERE mailbox_key=calendar_outlook_mailbox_key($1) AND provider_calendar_id=$2 AND confirmed_at IS NULL AND next_check_at<=now() ORDER BY next_check_at,id LIMIT 20",lease.binding.link_id,target.provider_calendar_id)
            .fetch_all(&mut *tx).await.map_err(report)?;
        tx.commit().await.map_err(report)?;
        Ok(rows
            .into_iter()
            .map(|r| AwaySubmission {
                id: r.id,
                invitation_id: r.invitation_id,
                recurrence_id: r.recurrence_id,
            })
            .collect())
    }

    async fn begin_away_submission(
        &self,
        lease: &OutlookCalendarLease,
        candidate: &AwayCandidate,
    ) -> Result<Option<Uuid>, Report> {
        let target = lease
            .target
            .as_ref()
            .ok_or_else(|| rootcause::report!("Calendar target missing"))?;
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence(&mut tx, lease).await?;
        let id = Uuid::now_v7();
        let inserted=sqlx::query_scalar!("INSERT INTO calendar_outlook_declines(id,work_id,invitation_id,recurrence_id,mailbox_key,provider_calendar_id) VALUES($1,$2,$3,$4,calendar_outlook_mailbox_key($5),$6) ON CONFLICT(mailbox_key,invitation_id,(COALESCE(recurrence_id,''))) DO NOTHING RETURNING id",
            id,lease.id,candidate.invitation_id,candidate.invitation_recurrence,lease.binding.link_id,target.provider_calendar_id).fetch_optional(&mut *tx).await.map_err(report)?;
        tx.commit().await.map_err(report)?;
        Ok(inserted)
    }

    async fn observe_away_submission(
        &self,
        lease: &OutlookCalendarLease,
        id: Uuid,
        confirmed: bool,
    ) -> Result<(), Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence(&mut tx, lease).await?;
        sqlx::query!("UPDATE calendar_outlook_declines SET confirmed_at=CASE WHEN $3 THEN now() ELSE confirmed_at END,next_check_at=now()+interval '120 seconds' WHERE id=$1 AND mailbox_key=calendar_outlook_mailbox_key($2)",id,lease.binding.link_id,confirmed).execute(&mut *tx).await.map_err(report)?;
        tx.commit().await.map_err(report)
    }

    async fn defer_away_submission(
        &self,
        lease: &OutlookCalendarLease,
        id: Uuid,
    ) -> Result<(), Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence(&mut tx, lease).await?;
        sqlx::query!("DELETE FROM calendar_outlook_declines WHERE id=$1 AND mailbox_key=calendar_outlook_mailbox_key($2) AND confirmed_at IS NULL",id,lease.binding.link_id).execute(&mut *tx).await.map_err(report)?;
        tx.commit().await.map_err(report)
    }

    async fn record_away_check(
        &self,
        lease: &OutlookCalendarLease,
        candidate: &AwayCandidate,
        delay: u32,
    ) -> Result<(), Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence(&mut tx, lease).await?;
        sqlx::query!("INSERT INTO calendar_outlook_away_checks(work_id,away_id,away_recurrence,invitation_id,invitation_recurrence,next_check_at) VALUES($1,$2,$3,$4,$5,now()+make_interval(secs=>$6)) ON CONFLICT(work_id,away_id,away_recurrence,invitation_id,invitation_recurrence) DO UPDATE SET checked_at=now(),next_check_at=EXCLUDED.next_check_at",
            lease.id,candidate.away_id,candidate.away_recurrence.as_deref().unwrap_or(""),candidate.invitation_id,candidate.invitation_recurrence.as_deref().unwrap_or(""),f64::from(delay)).execute(&mut *tx).await.map_err(report)?;
        tx.commit().await.map_err(report)
    }
}
