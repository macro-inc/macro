use super::*;
use crate::pubsub::label_write_sim::fake_gmail::PauseAt;
#[derive(Clone, Copy)]
enum Case {
    MissingLink(bool),
    LinkFault(bool),
    Counter(bool),
    NotifyOrphan,
    GateUnavailable,
    InitRedis,
    Cleanup,
}
#[expect(
    clippy::disallowed_methods,
    reason = "Terminal-error interleavings and isolated Redis ACL faults"
)]
async fn errors(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut redis = RedisDatabase::with_fault_user().await;
    let mut lab = start_in_redis(pool, name, shard, &redis).await;
    let msg = matches!(
        case,
        Case::MissingLink(true) | Case::LinkFault(true) | Case::Counter(true)
    );
    let mut op = if msg {
        "backfill_message"
    } else {
        "backfill_thread"
    };
    let mut payload = if msg {
        message_payload(&lab, "terminal-missing").await
    } else {
        thread_payload("terminal", false)
    };
    let path = if msg {
        "messages/terminal-missing"
    } else {
        "threads/terminal"
    };
    persistent(&lab, path, 400, rejection(400));
    match case {
        Case::Counter(true) => {
            let _: () = redis::cmd("SET")
                .arg(format!("bf_thread_status:{JOB}:t1"))
                .arg("wrong type")
                .query_async(&mut lab.redis_connection())
                .await
                .unwrap();
        }
        Case::Counter(false) => {
            let _: () = redis::cmd("SET")
                .arg(format!("bf_job_status:{JOB}"))
                .arg("wrong type")
                .query_async(&mut lab.redis_connection())
                .await
                .unwrap();
        }
        Case::LinkFault(_) => lab.sql_fault.fail_acquisition(5),
        Case::NotifyOrphan => {
            op = "list_threads";
            payload = list_payload(false);
            persistent(&lab, "threads", 400, rejection(400));
            sqlx::query("CREATE FUNCTION parity_orphan_failed_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='Failed' THEN NEW.link_id=NULL; END IF; RETURN NEW; END $$").execute(&lab.db).await.unwrap();
            sqlx::query("CREATE TRIGGER parity_orphan_failed_job BEFORE UPDATE ON email_backfill_jobs FOR EACH ROW EXECUTE FUNCTION parity_orphan_failed_job()").execute(&lab.db).await.unwrap();
        }
        Case::GateUnavailable => {
            redis.deny_commands(&["eval", "evalsha"]).await;
        }
        Case::InitRedis => {
            op = "init";
            payload = json!({});
            seed_job(&lab, "Init", 100).await;
            persistent(&lab, "labels", 200, catalog());
            persistent(
                &lab,
                "profile",
                200,
                json!({"emailAddress":"fixture@example.com","messagesTotal":5,"threadsTotal":5,"historyId":"200"}),
            );
            redis.deny_commands(&["hset"]).await;
        }
        Case::Cleanup => {
            op = "list_threads";
            payload = list_payload(false);
            persistent(&lab, "threads", 200, json!({"threads":[]}));
            redis.deny_commands(&["del"]).await;
        }
        _ => {}
    }
    let message = delivery(&lab, op, payload, count);
    if matches!(case, Case::MissingLink(_)) {
        let pause = lab
            .gmail
            .pause_next_http(&format!("/gmail/v1/users/me/{path}"), PauseAt::AfterApply);
        let db = lab.db.clone();
        let link = lab.fixture.links[0];
        let change = async move {
            pause.arrived.await.unwrap();
            sqlx::query("DELETE FROM email_links WHERE id=$1")
                .bind(link)
                .execute(&db)
                .await
                .unwrap();
            pause.release.send(()).unwrap();
        };
        let (result, ()) = tokio::join!(
            step(&mut lab, "link removed before error policy", &message),
            change
        );
        result.result.expect("missing-link policy");
    } else {
        let result = step(&mut lab, "fault policy", &message).await;
        if matches!(case, Case::LinkFault(_)) {
            assert!(result.result.is_err());
        } else {
            result.result.expect("classified");
        }
    }
    redis.remove_fault_user().await;
    lab.transcript.finish();
}
cases! {errors;
    terminal_thread_link_removed,72200,1,Case::MissingLink(false);
    terminal_thread_link_removed_redelivery,75200,20,Case::MissingLink(false);
    terminal_message_link_removed,72203,1,Case::MissingLink(true);
    terminal_message_link_removed_redelivery,75203,20,Case::MissingLink(true);
    terminal_thread_link_query_failure,72206,1,Case::LinkFault(false);
    terminal_thread_link_query_failure_redelivery,75206,20,Case::LinkFault(false);
    terminal_message_link_query_failure,72209,1,Case::LinkFault(true);
    terminal_message_link_query_failure_redelivery,75209,20,Case::LinkFault(true);
    terminal_thread_counter_failure,72212,1,Case::Counter(false);
    terminal_thread_counter_failure_redelivery,75212,20,Case::Counter(false);
    terminal_message_counter_failure,72215,1,Case::Counter(true);
    terminal_message_counter_failure_redelivery,75215,20,Case::Counter(true);
    failed_job_no_link_notification,72218,1,Case::NotifyOrphan;
    failed_job_no_link_notification_redelivery,75218,20,Case::NotifyOrphan;
    admission_unavailable,72221,1,Case::GateUnavailable;
    admission_unavailable_redelivery,75221,20,Case::GateUnavailable;
    init_progress_redis_failure,72224,1,Case::InitRedis;
    init_progress_redis_failure_redelivery,75224,20,Case::InitRedis;
    empty_listing_cleanup_failure,72227,1,Case::Cleanup;
    empty_listing_cleanup_failure_redelivery,75227,20,Case::Cleanup;
}
