use super::*;

#[derive(Clone, Copy)]
enum Case {
    Normal,
    Missing,
    Done,
    Busy,
    Expired,
    Failed,
    Cancelled,
    Active,
    Orphan,
    Mismatch,
    Fault(usize),
    RetireFault,
    ReleaseFault,
    ContactsSend,
}
#[expect(
    clippy::disallowed_methods,
    reason = "Completion-outbox lease and failure fixtures"
)]
async fn completion(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    seed_job(
        &lab,
        match case {
            Case::Failed => "Failed",
            Case::Cancelled => "Cancelled",
            Case::Active => "InProgress",
            _ => "Complete",
        },
        100,
    )
    .await;
    if !matches!(case, Case::Missing) {
        sqlx::query("INSERT INTO email_backfill_completion_outbox(id,backfill_job_id,created_at,published_at,completed_at,effects_lease_token,effects_lease_expires_at) VALUES($1,$2,'2026-01-01','2026-01-01',$3,$4,CASE WHEN $4::uuid IS NULL THEN NULL ELSE now()+$5*interval '1 hour' END)")
            .bind(MISSING).bind(JOB).bind(if matches!(case,Case::Done){Some(chrono::DateTime::from_timestamp(1_790_000_000,0).unwrap())}else{None})
            .bind(if matches!(case,Case::Busy|Case::Expired){Some(TEAM)}else{None}).bind(if matches!(case,Case::Expired){-1.0}else{1.0}).execute(&lab.db).await.unwrap();
    }
    if matches!(case, Case::Orphan) {
        sqlx::query("UPDATE email_backfill_jobs SET link_id=NULL WHERE id=$1")
            .bind(JOB)
            .execute(&lab.db)
            .await
            .unwrap();
    }
    if let Case::Fault(n) = case {
        lab.sql_fault.fail_acquisition(n);
    }
    if matches!(case, Case::RetireFault) {
        sqlx::query("CREATE FUNCTION parity_retire_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.completed_at IS NOT NULL THEN RAISE EXCEPTION 'parity retire failure'; END IF; RETURN NEW; END $$").execute(&lab.db).await.unwrap();
        sqlx::query("CREATE TRIGGER parity_retire_fault BEFORE UPDATE ON email_backfill_completion_outbox FOR EACH ROW EXECUTE FUNCTION parity_retire_fault()").execute(&lab.db).await.unwrap();
    }
    if matches!(case, Case::ReleaseFault) {
        sqlx::query("CREATE FUNCTION parity_completion_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.effects_lease_token IS NULL THEN RAISE EXCEPTION 'parity completion release failure'; END IF; RETURN NEW; END $$").execute(&lab.db).await.unwrap();
        sqlx::query("CREATE TRIGGER parity_completion_release BEFORE UPDATE ON email_backfill_completion_outbox FOR EACH ROW EXECUTE FUNCTION parity_completion_release()").execute(&lab.db).await.unwrap();
        seed_job(&lab, "InProgress", 100).await;
    }
    if matches!(case, Case::ContactsSend) {
        sqlx::query("INSERT INTO email_contacts(id,link_id,email_address,name) VALUES($1,$2,'contact@example.org','Fixture contact')").bind(TEAM).bind(lab.fixture.links[0]).execute(&lab.db).await.unwrap();
        sqlx::query("INSERT INTO email_message_recipients(message_id,contact_id,recipient_type) VALUES($1,$2,'TO')").bind(lab.fixture.messages["m1a"]).bind(TEAM).execute(&lab.db).await.unwrap();
        sqlx::query("UPDATE email_messages SET is_sent=true WHERE id=$1")
            .bind(lab.fixture.messages["m1a"])
            .execute(&lab.db)
            .await
            .unwrap();
        lab.sqs.fail_nth_send(1);
    }
    let mut message = delivery(&lab, "finalize_backfill", json!({}), count);
    if matches!(case, Case::Mismatch) {
        let mut body: Value = serde_json::from_str(message.body.as_ref().unwrap()).unwrap();
        body["backfillOperation"]["finalize_backfill"]["link_id"] = json!(lab.fixture.links[1]);
        message.body = Some(body.to_string());
    }
    step(&mut lab, "finalize", &message)
        .await
        .result
        .expect("completion policy");
    if matches!(
        case,
        Case::Normal
            | Case::Done
            | Case::Expired
            | Case::Failed
            | Case::Cancelled
            | Case::Mismatch
            | Case::Orphan
    ) {
        step(&mut lab, "completion duplicate", &message.redelivered())
            .await
            .result
            .expect("duplicate");
    }
    lab.transcript.finish();
}
cases! {completion;
    completion_normal,71700,1,Case::Normal; completion_normal_redelivery,71703,20,Case::Normal;
    completion_missing_outbox,71706,1,Case::Missing;
    completion_missing_outbox_redelivery,74706,20,Case::Missing; completion_already_done,71709,1,Case::Done;
    completion_already_done_redelivery,74709,20,Case::Done;
    completion_busy,71712,1,Case::Busy;
    completion_busy_redelivery,74712,20,Case::Busy; completion_expired_lease,71715,1,Case::Expired;
    completion_expired_lease_redelivery,74715,20,Case::Expired;
    completion_failed_job,71718,1,Case::Failed;
    completion_failed_job_redelivery,74718,20,Case::Failed; completion_cancelled_job,71721,1,Case::Cancelled;
    completion_cancelled_job_redelivery,74721,20,Case::Cancelled;
    completion_active_job,71724,1,Case::Active;
    completion_active_job_redelivery,74724,20,Case::Active; completion_orphan_job,71727,1,Case::Orphan;
    completion_orphan_job_redelivery,74727,20,Case::Orphan;
    completion_canonical_link,71730,1,Case::Mismatch;
    completion_canonical_link_redelivery,74730,20,Case::Mismatch;
    completion_claim_failure,71733,1,Case::Fault(1);
    completion_claim_failure_redelivery,74733,20,Case::Fault(1); completion_job_failure,71736,1,Case::Fault(2);
    completion_job_failure_redelivery,74736,20,Case::Fault(2);
    completion_link_failure,71739,1,Case::Fault(3);
    completion_link_failure_redelivery,74739,20,Case::Fault(3); completion_attachment_failure,71742,1,Case::Fault(4);
    completion_attachment_failure_redelivery,74742,20,Case::Fault(4);
    completion_contacts_failure,71745,1,Case::Fault(5);
    completion_contacts_failure_redelivery,74745,20,Case::Fault(5); completion_retire_failure,71748,1,Case::RetireFault;
    completion_retire_failure_redelivery,74748,20,Case::RetireFault;
    completion_release_failure,71751,1,Case::ReleaseFault;
    completion_release_failure_redelivery,74751,20,Case::ReleaseFault; completion_send_failure,71754,1,Case::ContactsSend;
    completion_send_failure_redelivery,74754,20,Case::ContactsSend;
}
