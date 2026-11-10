use super::*;
use base64::Engine;
#[derive(Clone, Copy)]
enum Case {
    Inline,
    Attachment,
    Invalid,
    Draft,
    DownloadFailure,
    PersistFailure,
    LookupFailure,
}
#[expect(
    clippy::disallowed_methods,
    reason = "Local calendar fixtures and exact post-write fault"
)]
async fn calendar(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let ics = if matches!(case, Case::Invalid) {
        "not a calendar"
    } else {
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Fixture//EN\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:backfill-event@example.com\r\nDTSTAMP:20260921T140000Z\r\nDTSTART:20260922T140000Z\r\nDTEND:20260922T150000Z\r\nSUMMARY:Fixture meeting\r\nORGANIZER:mailto:organizer@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    };
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(ics);
    let mut full = full_message(
        "calendar-backfill",
        "t1",
        if matches!(case, Case::Draft) {
            &["DRAFT"]
        } else {
            &["INBOX"]
        },
    );
    let mut part = json!({"partId":"1","mimeType":"text/calendar","filename":"invite.ics","headers":[{"name":"Content-Type","value":"text/calendar; method=REQUEST"}],"body":{"size":ics.len()}});
    if matches!(case, Case::Attachment | Case::DownloadFailure) {
        part["body"]["attachmentId"] = json!("calendar-part");
    } else {
        part["body"]["data"] = json!(encoded);
    }
    full["payload"] = json!({"mimeType":"multipart/mixed","filename":"","partId":"","headers":full["payload"]["headers"],"parts":[full["payload"],part]});
    persistent(&lab, "messages/calendar-backfill", 200, full);
    persistent(
        &lab,
        "messages/calendar-backfill/attachments/calendar-part",
        if matches!(case, Case::DownloadFailure) {
            503
        } else {
            200
        },
        if matches!(case, Case::DownloadFailure) {
            rejection(503)
        } else {
            json!({"size":ics.len(),"data":encoded})
        },
    );
    message_progress(&lab, 100, 0).await;
    if matches!(case, Case::PersistFailure) {
        sqlx::query(
            "ALTER TABLE email_message_calendar_invites RENAME TO parity_hidden_invitations",
        )
        .execute(&lab.db)
        .await
        .unwrap();
    }
    if matches!(case, Case::LookupFailure) {
        lab.sql_fault.fail_acquisition(8);
    }
    let message = delivery(
        &lab,
        "backfill_message",
        message_payload(&lab, "calendar-backfill").await,
        count,
    );
    step(&mut lab, "calendar backfill", &message)
        .await
        .result
        .expect("mail survives calendar result");
    if !matches!(case, Case::LookupFailure) {
        lab.reset_admission().await;
        step(&mut lab, "calendar duplicate", &message.redelivered())
            .await
            .result
            .expect("duplicate");
    }
    lab.transcript.finish();
}
cases! {calendar;
    calendar_inline,72300,1,Case::Inline; calendar_inline_redelivery,75300,20,Case::Inline;
    calendar_attachment,72303,1,Case::Attachment; calendar_attachment_redelivery,75303,20,Case::Attachment;
    calendar_invalid,72306,1,Case::Invalid; calendar_invalid_redelivery,75306,20,Case::Invalid;
    calendar_draft,72309,1,Case::Draft; calendar_draft_redelivery,75309,20,Case::Draft;
    calendar_download_failure,72312,1,Case::DownloadFailure; calendar_download_failure_redelivery,75312,20,Case::DownloadFailure;
    calendar_persist_failure,72315,1,Case::PersistFailure; calendar_persist_failure_redelivery,75315,20,Case::PersistFailure;
    calendar_lookup_failure,72318,1,Case::LookupFailure; calendar_lookup_failure_redelivery,75318,20,Case::LookupFailure;
}
