use super::*;
use crate::parity::stub::WireBody;
#[derive(Clone, Copy)]
enum Site {
    Me,
    Primary,
    Other,
}
#[expect(
    clippy::disallowed_methods,
    reason = "Independent People API outcomes restore only fixture state"
)]
async fn people(pool: PgPool, name: &'static str, shard: u32, count: u32, site: Site) {
    let mut lab = start(pool, name, shard).await;
    let chosen = match site {
        Site::Me => "/people/people/me",
        Site::Primary => "/people/people/me/connections",
        Site::Other => "/people/otherContacts",
    };
    lab.stub.reply_header("/people/", "retry-after", "3600");
    for status in [200, 400, 401, 403, 404, 409, 429, 500, 503, 422, 0] {
        seed_job(&lab, "Init", 100).await;
        sqlx::query("DELETE FROM email_backfill_init_outbox WHERE backfill_job_id=$1")
            .bind(JOB)
            .execute(&lab.db)
            .await
            .unwrap();
        sqlx::query("UPDATE email_links SET needs_reauth=false WHERE id=$1")
            .bind(lab.fixture.links[0])
            .execute(&lab.db)
            .await
            .unwrap();
        lab.seed_link_token(lab.fixture.links[0]).await;
        lab.reset_admission().await;
        persistent(&lab, "labels", 200, catalog());
        persistent(
            &lab,
            "profile",
            200,
            json!({"emailAddress":"mailbox@example.com","messagesTotal":10,"threadsTotal":10,"historyId":"200"}),
        );
        for (path, good) in [
            ("/people/people/me", json!({})),
            (
                "/people/people/me/connections",
                json!({"connections":[],"nextSyncToken":"contacts"}),
            ),
            (
                "/people/otherContacts",
                json!({"otherContacts":[],"nextSyncToken":"other"}),
            ),
        ] {
            lab.stub.reply(
                "GET",
                path,
                if path == chosen && status != 422 && status != 0 {
                    status
                } else {
                    200
                },
                if path == chosen && status == 422 {
                    json!({"emailAddresses":false,"connections":false,"otherContacts":false})
                } else if path == chosen && status != 200 && status != 0 {
                    rejection(status)
                } else {
                    good
                },
            );
        }
        if status == 0 {
            lab.stub.reply_wire(
                chosen,
                &[],
                WireBody::Stream {
                    chunks: vec![],
                    fail: true,
                },
            );
        }
        let message = delivery(&lab, "init", json!({}), count);
        step(&mut lab, &format!("People status {status}"), &message)
            .await
            .result
            .expect("contacts are best effort");
    }
    lab.transcript.finish();
}
cases! {people;
    people_self,72600,1,Site::Me; people_self_redelivery,75600,20,Site::Me;
    people_primary,72603,1,Site::Primary; people_primary_redelivery,75603,20,Site::Primary;
    people_other,72606,1,Site::Other; people_other_redelivery,75606,20,Site::Other;
}
