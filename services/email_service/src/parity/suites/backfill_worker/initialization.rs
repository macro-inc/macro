use super::*;
use crate::pubsub::label_write_sim::fake_gmail::PauseAt;

#[derive(Clone, Copy)]
enum Case {
    Normal,
    Empty,
    Limited(i32),
    Busy,
    Expired,
    Already,
    LeaseLost,
    Lookup(usize),
    Fault(&'static str, &'static str, bool),
    ContactsFailed,
    TotalFailure,
    FinalizeFailure,
}
#[expect(
    clippy::disallowed_methods,
    reason = "Initialization lease and transaction fixtures"
)]
async fn initialization(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    seed_job(&lab, "Init", 100).await;
    persistent(&lab, "labels", 200, catalog());
    persistent(
        &lab,
        "profile",
        200,
        json!({"emailAddress":"mailbox@example.com","messagesTotal":12,"threadsTotal":if matches!(case,Case::Empty){0}else{8},"historyId":"200"}),
    );
    lab.stub.reply("GET", "/people/people/me", 200, json!({}));
    lab.stub.reply(
        "GET",
        "/people/people/me/connections",
        200,
        json!({"connections":[],"nextSyncToken":"contacts-token"}),
    );
    lab.stub.reply(
        "GET",
        "/people/otherContacts",
        200,
        json!({"otherContacts":[],"nextSyncToken":"other-token"}),
    );
    match case {
        Case::Limited(n) => {
            sqlx::query("UPDATE email_backfill_jobs SET threads_requested_limit=$2 WHERE id=$1")
                .bind(JOB)
                .bind(n)
                .execute(&lab.db)
                .await
                .unwrap();
        }
        Case::Busy | Case::Expired => {
            sqlx::query("UPDATE email_backfill_jobs SET init_lease_token=$2,init_lease_expires_at=now()+$3*interval '1 hour' WHERE id=$1").bind(JOB).bind(MISSING).bind(if matches!(case,Case::Expired){-1.0}else{1.0}).execute(&lab.db).await.unwrap();
        }
        Case::Already => {
            sqlx::query("UPDATE email_backfill_jobs SET initialized_at='2026-01-01' WHERE id=$1")
                .bind(JOB)
                .execute(&lab.db)
                .await
                .unwrap();
        }
        Case::Lookup(n) => lab.sql_fault.fail_acquisition(n),
        Case::Fault(table, op, commit) => trigger(&lab, table, op, commit, "P0001").await,
        Case::TotalFailure | Case::FinalizeFailure => {
            let condition = if matches!(case, Case::TotalFailure) {
                "NEW.total_threads IS DISTINCT FROM OLD.total_threads"
            } else {
                "NEW.status='InProgress'"
            };
            sqlx::query(&format!("CREATE FUNCTION parity_init_stage_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF {condition} THEN RAISE EXCEPTION 'parity init stage failure'; END IF; RETURN NEW; END $$")).execute(&lab.db).await.unwrap();
            sqlx::query("CREATE TRIGGER parity_init_stage_fault BEFORE UPDATE ON email_backfill_jobs FOR EACH ROW EXECUTE FUNCTION parity_init_stage_fault()").execute(&lab.db).await.unwrap();
        }
        Case::ContactsFailed => lab.stub.reply("GET", "/people/", 503, rejection(503)),
        _ => {}
    }
    let message = delivery(&lab, "init", json!({}), count);
    if matches!(case, Case::LeaseLost) {
        let pause = lab
            .gmail
            .pause_next_http("/gmail/v1/users/me/profile", PauseAt::AfterApply);
        let db = lab.db.clone();
        let change = async move {
            pause.arrived.await.unwrap();
            sqlx::query("UPDATE email_backfill_jobs SET init_lease_token=$2 WHERE id=$1")
                .bind(JOB)
                .bind(MISSING)
                .execute(&db)
                .await
                .unwrap();
            pause.release.send(()).unwrap();
        };
        let (first, ()) = tokio::join!(
            step(&mut lab, "initialization loses lease", &message),
            change
        );
        first.result.expect("lease retry policy");
    } else {
        step(&mut lab, "initialize", &message)
            .await
            .result
            .expect("init policy");
    }
    if matches!(
        case,
        Case::Normal | Case::Empty | Case::Limited(_) | Case::Expired | Case::Already
    ) {
        lab.reset_admission().await;
        step(&mut lab, "initialization duplicate", &message.redelivered())
            .await
            .result
            .expect("duplicate");
    }
    lab.transcript.finish();
}
cases! {initialization;
    init_finalize_failure,72700,1,Case::FinalizeFailure; init_finalize_failure_redelivery,75700,20,Case::FinalizeFailure;
    init_positive,71600,1,Case::Normal; init_positive_redelivery,71603,20,Case::Normal;
    init_empty,71606,1,Case::Empty; init_empty_redelivery,71609,20,Case::Empty;
    init_limit_smaller,71612,1,Case::Limited(2);
    init_limit_smaller_redelivery,74612,20,Case::Limited(2); init_limit_larger,71615,1,Case::Limited(200);
    init_limit_larger_redelivery,74615,20,Case::Limited(200);
    init_limit_negative,71618,1,Case::Limited(-1);
    init_limit_negative_redelivery,74618,20,Case::Limited(-1); init_limit_zero,71621,1,Case::Limited(0);
    init_limit_zero_redelivery,74621,20,Case::Limited(0);
    init_busy,71624,1,Case::Busy; init_busy_redelivery,71627,20,Case::Busy;
    init_expired,71630,1,Case::Expired;
    init_expired_redelivery,74630,20,Case::Expired; init_already_initialized,71633,1,Case::Already;
    init_already_initialized_redelivery,74633,20,Case::Already;
    init_lease_lost,71636,1,Case::LeaseLost;
    init_lease_lost_redelivery,74636,20,Case::LeaseLost; init_claim_failure,71639,1,Case::Lookup(3);
    init_claim_failure_redelivery,74639,20,Case::Lookup(3);
    init_catalog_read_failure,71642,1,Case::Lookup(5);
    init_catalog_read_failure_redelivery,74642,20,Case::Lookup(5);
    init_total_write_failure,71645,1,Case::TotalFailure;
    init_total_write_failure_redelivery,74645,20,Case::TotalFailure;
    init_outbox_insert_failure,71648,1,Case::Fault("email_backfill_init_outbox","INSERT",false);
    init_outbox_insert_failure_redelivery,74648,20,Case::Fault("email_backfill_init_outbox","INSERT",false);
    init_commit_failure,71651,1,Case::Fault("email_backfill_init_outbox","INSERT",true);
    init_commit_failure_redelivery,74651,20,Case::Fault("email_backfill_init_outbox","INSERT",true);
    init_sync_token_failure,71654,1,Case::Fault("email_sync_tokens","INSERT",false);
    init_sync_token_failure_redelivery,74654,20,Case::Fault("email_sync_tokens","INSERT",false);
    init_contacts_provider_failure,71657,1,Case::ContactsFailed;
    init_contacts_provider_failure_redelivery,74657,20,Case::ContactsFailed;
}
