use super::*;
use base64::Engine;

#[derive(Clone, Copy)]
enum Case {
    Inline,
    Attachment,
    Both,
    Invalid,
    DownloadFailure,
    PersistFailure,
    Draft,
}

#[expect(
    clippy::disallowed_methods,
    reason = "Invitation failure fixtures mutate only their isolated schema"
)]
async fn calendar(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let ics = if matches!(case, Case::Invalid) {
        "not a calendar"
    } else {
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Fixture//EN\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:parity-event@example.com\r\nDTSTAMP:20260921T140000Z\r\nDTSTART:20260922T140000Z\r\nDTEND:20260922T150000Z\r\nSUMMARY:Fixture meeting\r\nORGANIZER:mailto:organizer@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
    };
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(ics);
    let labels = if matches!(case, Case::Draft) {
        vec!["DRAFT"]
    } else {
        vec!["INBOX"]
    };
    let mut full = full_message("calendar-message", "t1", &labels);
    let mut part = json!({"partId":"1","mimeType":"text/calendar","filename":"invite.ics","headers":[{"name":"Content-Type","value":"text/calendar; method=REQUEST"}],"body":{"size":ics.len()}});
    if matches!(case, Case::Attachment | Case::DownloadFailure) {
        part["body"]["attachmentId"] = json!("calendar-part");
    } else {
        part["body"]["data"] = json!(encoded);
    }
    let mut parts = vec![full["payload"].clone(), part];
    if matches!(case, Case::Both) {
        parts.push(json!({"partId":"2","mimeType":"text/calendar","filename":"invite.ics","body":{"size":ics.len(),"attachmentId":"calendar-part"}}));
    }
    full["payload"] = json!({"mimeType":"multipart/mixed","filename":"","partId":"","headers":full["payload"]["headers"].clone(),"parts":parts});
    persistent(&lab, "messages/calendar-message", 200, full);
    persistent(
        &lab,
        "messages/calendar-message/attachments/calendar-part",
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
    if matches!(case, Case::PersistFailure) {
        sqlx::query(
            "ALTER TABLE email_message_calendar_invites RENAME TO parity_hidden_invitations",
        )
        .execute(&lab.db)
        .await
        .expect("invitation fault");
    }
    let message = delivery(&lab, Op::Upsert, "calendar-message");
    lab.worker_step("calendar discovery", queue(retry), &message)
        .await
        .result
        .expect("mail survives calendar result");
    duplicate(&mut lab, retry, &message).await;
    lab.transcript.finish();
}

cases! { calendar;
 calendar_inline_primary, 79500, false, Case::Inline;
 calendar_inline_retry, 79503, true, Case::Inline;
 calendar_attachment_primary, 79506, false, Case::Attachment;
 calendar_attachment_retry, 79509, true, Case::Attachment;
 calendar_both_primary, 79512, false, Case::Both;
 calendar_both_retry, 79515, true, Case::Both;
 calendar_invalid_primary, 79518, false, Case::Invalid;
 calendar_invalid_retry, 79521, true, Case::Invalid;
 calendar_download_failure_primary, 79524, false, Case::DownloadFailure;
 calendar_download_failure_retry, 79527, true, Case::DownloadFailure;
 calendar_persist_failure_primary, 79530, false, Case::PersistFailure;
 calendar_persist_failure_retry, 79533, true, Case::PersistFailure;
 calendar_draft_primary, 79536, false, Case::Draft;
 calendar_draft_retry, 79539, true, Case::Draft;
}
