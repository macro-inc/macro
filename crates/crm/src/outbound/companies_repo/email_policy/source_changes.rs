//! Explicit matching edits record events in their existing transaction. Ordinary
//! imports/enrichment do not pay a per-row trigger cost for dormant policies.
use super::*;
use sqlx::PgConnection;

impl CompaniesRepositoryImpl {
    pub(in crate::outbound::companies_repo) async fn record_contact_matching_change(
        conn: &mut PgConnection,
        team: Uuid,
        contact: Uuid,
    ) -> Result<(), CrmError> {
        sqlx::query!(
            r#"INSERT INTO crm_email_policy_source_events(event_id,team_id,source_kind,source_id,traceparent)
               SELECT $1,$2,'contact',$3,$4
               WHERE EXISTS (SELECT 1 FROM crm_email_rule_contacts WHERE contact_id=$3 AND team_id=$2)"#,
            Uuid::now_v7(),team,contact,Self::current_traceparent()
        ).execute(conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }
    pub(in crate::outbound::companies_repo) async fn record_company_matching_change(
        conn: &mut PgConnection,
        team: Uuid,
        company: Uuid,
    ) -> Result<(), CrmError> {
        sqlx::query!(
            r#"INSERT INTO crm_email_policy_source_events(event_id,team_id,source_kind,source_id,traceparent)
               SELECT $1,$2,'company',$3,$4
               WHERE EXISTS (SELECT 1 FROM crm_email_rule_companies WHERE company_id=$3 AND team_id=$2)"#,
            Uuid::now_v7(),team,company,Self::current_traceparent()
        ).execute(conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(())
    }
    pub(in crate::outbound::companies_repo) async fn has_contact_rule_references(
        conn: &mut PgConnection,
        team: Uuid,
    ) -> Result<bool, CrmError> {
        sqlx::query_scalar!(r#"SELECT COALESCE((SELECT TRUE FROM crm_email_rule_contacts WHERE team_id=$1 ORDER BY user_id,revision,contact_id LIMIT 1), FALSE) AS "referenced!""#,team)
            .fetch_one(conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))
    }
    pub(in crate::outbound::companies_repo) async fn has_company_rule_references(
        conn: &mut PgConnection,
        team: Uuid,
    ) -> Result<bool, CrmError> {
        sqlx::query_scalar!(r#"SELECT COALESCE((SELECT TRUE FROM crm_email_rule_companies WHERE team_id=$1 ORDER BY user_id,revision,company_id LIMIT 1), FALSE) AS "referenced!""#,team)
            .fetch_one(conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))
    }
    pub(in crate::outbound::companies_repo) async fn record_company_contacts_matching_change(
        conn: &mut PgConnection,
        team: Uuid,
        company: Uuid,
        parent_changed: bool,
        hidden: bool,
    ) -> Result<(), CrmError> {
        if !Self::has_contact_rule_references(conn, team).await? {
            return Ok(());
        }
        // Capture matching changes before the cascade. Lock the parent's rows
        // so a concurrent individual hide cannot invalidate this decision.
        // Fence the reverse probe too: stale statistics can otherwise rescan
        // all of the team's references for each contact. No member fan-out
        // occurs inside this source edit.
        let ids = sqlx::query_scalar!(
            r#"SELECT ct.id FROM (
                   SELECT id,team_id,hidden FROM crm_contacts WHERE company_id=$2 OFFSET 0 FOR UPDATE
               ) ct WHERE ct.team_id=$1 AND ($3 OR ct.hidden IS DISTINCT FROM $4)
                 AND EXISTS (SELECT 1 FROM crm_email_rule_contacts r WHERE r.contact_id=ct.id AND r.team_id=$1 OFFSET 0)"#,
            team,company,parent_changed,hidden
        ).fetch_all(&mut *conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Self::record_matching_changes(conn, team, "contact", &ids).await
    }
    pub(in crate::outbound::companies_repo) async fn delete_referenced_orphan_contacts(
        conn: &mut PgConnection,
        team: Uuid,
    ) -> Result<(), CrmError> {
        // Probe sources for each team contact; a global anti-join otherwise
        // scans every mailbox source under fresh statistics.
        let ids = sqlx::query_scalar!(
            r#"WITH removed AS (
                DELETE FROM crm_contacts ct WHERE ct.team_id=$1 AND ct.manually_created=FALSE
                AND NOT EXISTS(SELECT 1 FROM crm_contact_sources WHERE contact_id=ct.id OFFSET 0) RETURNING id
            )
            SELECT d.id FROM removed d
            WHERE EXISTS(SELECT 1 FROM crm_email_rule_contacts r WHERE r.contact_id=d.id AND r.team_id=$1)"#,
            team
        ).fetch_all(&mut *conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Self::record_matching_changes(conn, team, "contact", &ids).await
    }
    pub(in crate::outbound::companies_repo) async fn delete_referenced_orphan_companies(
        conn: &mut PgConnection,
        team: Uuid,
    ) -> Result<(), CrmError> {
        let ids = sqlx::query_scalar!(
            r#"WITH removed AS (
                DELETE FROM crm_companies co WHERE co.team_id=$1 AND co.email_sync=TRUE AND co.manually_created=FALSE
                AND NOT EXISTS(SELECT 1 FROM crm_contacts WHERE company_id=co.id) RETURNING id
            )
            SELECT d.id FROM removed d
            WHERE EXISTS(SELECT 1 FROM crm_email_rule_companies r WHERE r.company_id=d.id AND r.team_id=$1)"#,
            team
        ).fetch_all(&mut *conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Self::record_matching_changes(conn, team, "company", &ids).await
    }

    // IDs are generated in the application so bulk and ordinary edits share
    // UUIDv7 queue order. Parent/teardown reads bound the source set; cap each
    // insert array rather than issuing one write per affected record.
    async fn record_matching_changes(
        conn: &mut PgConnection,
        team: Uuid,
        kind: &str,
        sources: &[Uuid],
    ) -> Result<(), CrmError> {
        let traceparent = Self::current_traceparent();
        for sources in sources.chunks(1000) {
            let events: Vec<Uuid> = sources.iter().map(|_| Uuid::now_v7()).collect();
            sqlx::query!(
                r#"INSERT INTO crm_email_policy_source_events(event_id,team_id,source_kind,source_id,traceparent)
                   SELECT x.event_id,$1,$2,x.source_id,$5 FROM unnest($3::uuid[],$4::uuid[]) x(event_id,source_id)
                   ON CONFLICT(event_id) DO NOTHING"#,
                team,kind,&events,sources,traceparent
            ).execute(&mut *conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }
        Ok(())
    }
}
