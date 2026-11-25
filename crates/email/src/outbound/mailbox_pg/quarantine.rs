use super::*;

#[derive(Clone, Copy, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub(super) enum QuarantineReason {
    Decode,
    ProbeBudget,
    ProbeAccounting,
    MissingDisposition,
}

#[derive(Clone, Copy, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub(super) enum QuarantinedWork {
    Commands,
    Drafts,
    Projection,
}

pub(super) async fn record_quarantine(
    tx: &mut sqlx::PgConnection,
    work: QuarantinedWork,
    work_id: Uuid,
    link_id: Uuid,
    reason: QuarantineReason,
) -> Result<(), MailboxError> {
    sqlx::query!(
        r#"
        INSERT INTO email_mailbox_work_quarantine (work,work_id,link_id,reason,cleanup_at)
        VALUES ($1,$2,$3,$4,CASE WHEN $1='commands' THEN now() END)
        ON CONFLICT (work,work_id) DO NOTHING
        "#,
        work.as_ref(),
        work_id,
        link_id,
        reason.as_ref(),
    )
    .execute(tx)
    .await
    .map_err(db_error)?;
    Ok(())
}
