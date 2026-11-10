use super::*;

async fn payload(lab: &Lab, op: &str) -> Value {
    match op {
        "list_threads" => list_payload(false),
        "backfill_thread" => thread_payload("t1", false),
        "backfill_message" | "update_thread_metadata" => message_payload(lab, "m1a").await,
        "seed_sent_contact" => json!({"message_provider_id":"m1a"}),
        "populate_crm_contact" => {
            json!({"contact_email":"client@example.org","first_at":"2026-01-01T00:00:00Z","last_at":"2026-01-02T00:00:00Z","is_sent":false})
        }
        "depopulate_crm_contact" => json!({"contact_email":"client@example.org"}),
        "populate_crm_for_user" => json!({"macro_id":lab.fixture.users[0]}),
        "depopulate_crm_for_user" => json!({"macro_id":lab.fixture.users[0],"team_id":TEAM}),
        "backfill_attachment" => json!({"metadata":{"attachment_metadata":{
            "attachment_db_id":MISSING,"email_provider_id":"m1a","provider_attachment_id":"att","mime_type":"application/pdf","filename":"file.pdf","internal_date_ts":"2026-01-01T00:00:00Z","message_db_id":lab.fixture.messages["m1a"],"thread_db_id":message_payload(lab,"m1a").await["thread_db_id"],"sender_email":null,"subject":null},"recipient_emails":[],"backfill":true,"upload_destination":"Dss"}}),
        _ => json!({}),
    }
}

#[expect(
    clippy::disallowed_methods,
    reason = "Each fault is confined to this disposable database"
)]
async fn policy(pool: PgPool, name: &'static str, shard: u32, count: u32, case: (&str, usize)) {
    let mut lab = start(pool, name, shard).await;
    let (op, acquisition) = case;
    let message = delivery(&lab, op, payload(&lab, op).await, count);
    if acquisition == 0 {
        sqlx::query("DELETE FROM email_backfill_jobs WHERE id=$1")
            .bind(JOB)
            .execute(&lab.db)
            .await
            .unwrap();
    } else {
        lab.sql_fault.fail_acquisition(acquisition);
    }
    let outcome = step(&mut lab, "lookup policy", &message).await;
    if acquisition > 0 {
        assert!(!outcome.deleted, "retryable fault leaves original");
    }
    outcome.result.expect("policy returns Ok");
    lab.transcript.finish();
}
cases! {policy;
    retry_init,72100,1,("init",1);
    retry_init_redelivery,75100,20,("init",1); retry_list,72103,1,("list_threads",1);
    retry_list_redelivery,75103,20,("list_threads",1);
    retry_thread,72106,1,("backfill_thread",1);
    retry_thread_redelivery,75106,20,("backfill_thread",1); retry_message,72109,1,("backfill_message",1);
    retry_message_redelivery,75109,20,("backfill_message",1);
    retry_metadata,72112,1,("update_thread_metadata",1);
    retry_metadata_redelivery,75112,20,("update_thread_metadata",1); retry_attachment,72115,1,("backfill_attachment",1);
    retry_attachment_redelivery,75115,20,("backfill_attachment",1);
    retry_finalize,72118,1,("finalize_backfill",1);
    retry_finalize_redelivery,75118,20,("finalize_backfill",1); retry_seed,72121,1,("seed_sent_contact",1);
    retry_seed_redelivery,75121,20,("seed_sent_contact",1);
    retry_crm_populate,72124,1,("populate_crm_contact",1);
    retry_crm_populate_redelivery,75124,20,("populate_crm_contact",1); retry_crm_depopulate,72127,1,("depopulate_crm_contact",1);
    retry_crm_depopulate_redelivery,75127,20,("depopulate_crm_contact",1);
    retry_crm_populate_user,72130,1,("populate_crm_for_user",1);
    retry_crm_populate_user_redelivery,75130,20,("populate_crm_for_user",1); retry_crm_depopulate_user,72133,1,("depopulate_crm_for_user",1);
    retry_crm_depopulate_user_redelivery,75133,20,("depopulate_crm_for_user",1);
    missing_job_init,72136,1,("init",0);
    missing_job_init_redelivery,75136,20,("init",0); missing_job_list,72139,1,("list_threads",0);
    missing_job_list_redelivery,75139,20,("list_threads",0);
    missing_job_thread,72142,1,("backfill_thread",0);
    missing_job_thread_redelivery,75142,20,("backfill_thread",0); missing_job_message,72145,1,("backfill_message",0);
    missing_job_message_redelivery,75145,20,("backfill_message",0);
    missing_job_metadata,72148,1,("update_thread_metadata",0);
    missing_job_metadata_redelivery,75148,20,("update_thread_metadata",0); missing_job_attachment,72151,1,("backfill_attachment",0);
    missing_job_attachment_redelivery,75151,20,("backfill_attachment",0);
    missing_job_seed,72154,1,("seed_sent_contact",0);
    missing_job_seed_redelivery,75154,20,("seed_sent_contact",0);
}
