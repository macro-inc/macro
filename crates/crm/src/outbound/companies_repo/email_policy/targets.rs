use super::*;
use crate::domain::{
    email_policy_api::EmailRuleTargetFacts,
    email_rules::{EmailInclusionRule, MAX_EMAIL_INCLUSION_RULES},
};
use sqlx::PgConnection;

pub(super) async fn read_targets(
    conn: &mut PgConnection,
    team: Uuid,
    user: &str,
    link: Uuid,
    rules: &[EmailInclusionRule],
    lock: bool,
) -> Result<EmailRuleTargetFacts, CrmError> {
    if rules.len() > MAX_EMAIL_INCLUSION_RULES {
        return Err(CrmError::InvalidRequest(
            "too many email inclusion rules".into(),
        ));
    }
    let mut threads = Vec::new();
    let mut contacts = Vec::new();
    let mut companies = Vec::new();
    for rule in rules {
        match rule {
            EmailInclusionRule::Thread { thread_id } => threads.push(*thread_id),
            EmailInclusionRule::Contact { contact_id } => contacts.push(*contact_id),
            EmailInclusionRule::Company { company_id } => companies.push(*company_id),
            _ => {}
        }
    }
    let include_hidden = sqlx::query_scalar!(
        r#"SELECT member.team_role IN ('admin','owner') AS "admin!" FROM team_user member
           WHERE member.team_id=$1 AND member.user_id=$2
             AND EXISTS(SELECT 1 FROM email_links WHERE id=$3 AND macro_id=$2)"#,
        team,
        user,
        link
    )
    .fetch_optional(&mut *conn)
    .await
    .map_err(|e| CrmError::StorageLayerError(e.into()))?
    .ok_or(CrmError::AccessDenied)?;
    if lock {
        // Normal target writers use the team privacy lock; bulk teardown does
        // not. Lock parents before contacts, then read all authorization facts
        // in a new statement after any lock wait. This keeps deletion and first
        // activation ordered without blocking withdrawal behind a teardown.
        // Resolve authorized IDs before locking. Locking inside the ID lookup
        // would lock foreign-team rows before filtering and before the sort.
        // Keep team predicates outside each fence so stale estimates cannot
        // turn a primary-key probe into a whole-team scan for every target.
        sqlx::query!(
            r#"WITH parents AS MATERIALIZED (
                   SELECT unnest($2::uuid[]) AS id
                   UNION
                   SELECT ct.company_id FROM unnest($3::uuid[]) ids(id)
                   CROSS JOIN LATERAL (SELECT company_id,team_id FROM crm_contacts
                       WHERE id=ids.id OFFSET 0) ct
                   WHERE ct.team_id=$1 AND ct.company_id IS NOT NULL
               )
               SELECT id FROM crm_companies WHERE id=ANY(ARRAY(
                   SELECT co.id FROM parents CROSS JOIN LATERAL (
                       SELECT id,team_id FROM crm_companies WHERE id=parents.id OFFSET 0
                   ) co WHERE co.team_id=$1
               )) ORDER BY id FOR SHARE"#,
            team,
            &companies,
            &contacts
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!(
            r#"SELECT id FROM crm_contacts WHERE id=ANY(ARRAY(
                   SELECT ct.id FROM unnest($2::uuid[]) ids(id) CROSS JOIN LATERAL (
                       SELECT id,team_id FROM crm_contacts WHERE id=ids.id OFFSET 0
                   ) ct WHERE ct.team_id=$1
               )) ORDER BY id FOR SHARE"#,
            team,
            &contacts
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        // Probe the supplied IDs before mailbox scope. A stale plan otherwise
        // reads every thread in the mailbox to validate even one missing ID.
        sqlx::query!(
            r#"SELECT t.id FROM unnest($2::uuid[]) ids(id) CROSS JOIN LATERAL (
                   SELECT id,link_id FROM email_threads WHERE id=ids.id OFFSET 0
               ) t WHERE t.link_id=$1 ORDER BY t.id FOR SHARE OF t"#,
            link,
            &threads
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
    }
    let threads = sqlx::query_scalar!(
        r#"SELECT t.id FROM unnest($2::uuid[]) ids(id) CROSS JOIN LATERAL (
               SELECT id,link_id FROM email_threads WHERE id=ids.id OFFSET 0
           ) t WHERE t.link_id=$1"#,
        link,
        &threads
    )
    .fetch_all(&mut *conn)
    .await
    .map_err(|e| CrmError::StorageLayerError(e.into()))?;
    let contacts = sqlx::query!(
        r#"SELECT ct.id, (($3 OR (NOT ct.hidden AND NOT COALESCE(co.hidden,FALSE)))
                 AND EXISTS(SELECT 1 FROM crm_contact_emails WHERE contact_id=ct.id OFFSET 0)) AS "active!"
           FROM unnest($2::uuid[]) ids(id) CROSS JOIN LATERAL (
               SELECT id,company_id,team_id,hidden FROM crm_contacts WHERE id=ids.id OFFSET 0
           ) ct LEFT JOIN LATERAL (
               SELECT id,team_id,hidden FROM crm_companies WHERE id=ct.company_id OFFSET 0
           ) co ON co.team_id=$1
           WHERE ct.team_id=$1 AND (ct.company_id IS NULL OR co.id IS NOT NULL)
             AND ($3 OR (NOT ct.hidden AND NOT COALESCE(co.hidden,FALSE)))"#,
        team,&contacts,include_hidden
    ).fetch_all(&mut *conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
    let companies = sqlx::query!(
        r#"SELECT co.id,(($3 OR NOT co.hidden) AND EXISTS(SELECT 1 FROM crm_domains WHERE company_id=co.id OFFSET 0)) AS "active!"
           FROM unnest($2::uuid[]) ids(id) CROSS JOIN LATERAL (
               SELECT id,team_id,hidden FROM crm_companies WHERE id=ids.id OFFSET 0
           ) co WHERE co.team_id=$1 AND ($3 OR NOT co.hidden)"#,
        team,&companies,include_hidden
    ).fetch_all(&mut *conn).await.map_err(|e| CrmError::StorageLayerError(e.into()))?;
    Ok(EmailRuleTargetFacts {
        threads,
        contacts: contacts.into_iter().map(|r| (r.id, r.active)).collect(),
        companies: companies.into_iter().map(|r| (r.id, r.active)).collect(),
    })
}
