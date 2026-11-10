use super::*;

const ATTACHMENT: Uuid = Uuid::from_u128(0x57000000000000000000000000004003);
const DOCUMENT: Uuid = Uuid::from_u128(0x57000000000000000000000000004004);
#[derive(Clone, Copy)]
enum Case {
    Fetch(u16),
    Concurrency,
    Refresh,
    Success,
    NoPresign,
    PresignFailure,
    Deleted,
    Existing,
    Media,
    BadMediaId,
    MediaRejected,
    MissingFilename,
    Unsupported,
    MappingFault,
    LookupFault,
    Complete,
    Failed,
    Cancelled,
}
#[expect(
    clippy::disallowed_methods,
    reason = "Attachment payloads and storage fixtures"
)]
async fn attachments(pool: PgPool, name: &'static str, shard: u32, count: u32, case: Case) {
    let mut lab = start(pool, name, shard).await;
    lab.transcript.normalizer.symbol(ATTACHMENT, "<attachment>");
    lab.transcript.normalizer.symbol(DOCUMENT, "<document>");
    let p = message_payload(&lab, "m1a").await;
    let media = matches!(
        case,
        Case::Media | Case::BadMediaId | Case::MediaRejected | Case::MappingFault
    );
    sqlx::query("INSERT INTO email_attachments(id,message_id,provider_attachment_id,filename,mime_type,size_bytes) VALUES($1,$2,'attachment-1','file.pdf','application/pdf',4)")
        .bind(ATTACHMENT).bind(lab.fixture.messages["m1a"]).execute(&lab.db).await.unwrap();
    let args = AttachmentUploadArgs {
        attachment_metadata: AttachmentUploadMetadata {
            attachment_db_id: ATTACHMENT,
            email_provider_id: "m1a".into(),
            provider_attachment_id: "attachment-1".into(),
            mime_type: if media {
                "image/png"
            } else if matches!(case, Case::Unsupported) {
                "application/unknown"
            } else {
                "application/pdf"
            }
            .into(),
            filename: if matches!(case, Case::MissingFilename) {
                None
            } else {
                Some(
                    if media {
                        "image.png"
                    } else if matches!(case, Case::Unsupported) {
                        "file"
                    } else {
                        "file.pdf"
                    }
                    .into(),
                )
            },
            internal_date_ts: chrono::DateTime::from_timestamp(1_790_000_000, 0).unwrap(),
            message_db_id: lab.fixture.messages["m1a"],
            thread_db_id: serde_json::from_value(p["thread_db_id"].clone()).unwrap(),
            sender_email: Some("sender@example.com".into()),
            subject: Some("Attachment".into()),
        },
        recipient_emails: vec!["recipient@example.com".into()],
        backfill: true,
        upload_destination: if media {
            AttachmentUploadDestination::Sfs
        } else {
            AttachmentUploadDestination::Dss
        },
    };
    persistent(
        &lab,
        "messages/m1a/attachments/attachment-1",
        200,
        json!({"data":"dGVzdA","size":4}),
    );
    if let Case::Fetch(status) = case {
        if status == 0 {
            lab.gmail
                .lock()
                .drop_endpoints
                .insert("/gmail/v1/users/me/messages/m1a/attachments/attachment-1".into());
        } else {
            persistent(
                &lab,
                "messages/m1a/attachments/attachment-1",
                status,
                if status == 200 {
                    json!({"data":false})
                } else {
                    rejection(status)
                },
            );
        }
    }
    if matches!(case, Case::Concurrency) {
        persistent(
            &lab,
            "messages/m1a/attachments/attachment-1",
            429,
            json!({"error":{"code":429,"message":"Too many concurrent requests for user."}}),
        );
    }
    if matches!(case, Case::Refresh) {
        let endpoint = "/gmail/v1/users/me/messages/m1a/attachments/attachment-1";
        lab.gmail.lock().endpoint_replies.remove(endpoint);
        lab.gmail.lock().scripted_http.extend([
            (
                "GET".into(),
                endpoint.into(),
                HttpReply::Status(401, rejection(401)),
            ),
            (
                "GET".into(),
                endpoint.into(),
                HttpReply::Status(200, json!({"data":"dGVzdA","size":4})),
            ),
        ]);
    }
    lab.gmail.lock().endpoint_headers.insert(
        "/gmail/v1/users/me/messages/m1a/attachments/attachment-1".into(),
        vec![("retry-after".into(), "3600".into())],
    );
    let mut response = json!({"error":false,"data":{"documentMetadata":{"documentId":DOCUMENT.to_string(),"documentVersionId":1,"owner":lab.fixture.users[0],"documentName":"file","fileType":"pdf"},"contentType":"application/pdf","fileType":"pdf"}});
    if !matches!(case, Case::NoPresign) {
        response["data"]["presignedUrl"] = json!(format!("{}/upload-document", lab.stub.url));
    }
    lab.stub.reply(
        "POST",
        "/internal/documents",
        if matches!(case, Case::Deleted) {
            404
        } else {
            200
        },
        if matches!(case, Case::Deleted) {
            json!({"code":"EMAIL_ATTACHMENT_NOT_FOUND"})
        } else {
            response
        },
    );
    lab.stub.reply(
        "PUT",
        "/upload-document",
        if matches!(case, Case::PresignFailure) {
            500
        } else {
            200
        },
        json!({}),
    );
    lab.stub.reply("PUT","/internal/file",if matches!(case,Case::MediaRejected){500}else{200},json!({"id":if matches!(case,Case::BadMediaId){"bad".into()}else{DOCUMENT.to_string()},"upload_url":format!("{}/upload",lab.stub.url),"file_location":"fixture"}));
    if matches!(case, Case::Existing) {
        sqlx::query("INSERT INTO \"Document\"(id,name,owner,\"fileType\") VALUES($1,'attachment.pdf',$2,'pdf')").bind(DOCUMENT.to_string()).bind(&lab.fixture.users[0]).execute(&lab.db).await.unwrap();
        sqlx::query("INSERT INTO document_email(document_id,email_attachment_id) VALUES($1,$2)")
            .bind(DOCUMENT.to_string())
            .bind(ATTACHMENT)
            .execute(&lab.db)
            .await
            .unwrap();
    }
    if matches!(case, Case::LookupFault) {
        lab.sql_fault.fail_acquisition(3);
    }
    if matches!(case, Case::MappingFault) {
        trigger(&lab, "email_attachments_sfs", "INSERT", false, "P0001").await;
    }
    if matches!(case, Case::Complete | Case::Failed | Case::Cancelled) {
        seed_job(
            &lab,
            match case {
                Case::Complete => "Complete",
                Case::Failed => "Failed",
                _ => "Cancelled",
            },
            100,
        )
        .await;
    }
    let message = delivery(&lab, "backfill_attachment", json!({"metadata":args}), count);
    step(&mut lab, "backfill attachment", &message)
        .await
        .result
        .expect("attachment policy");
    if matches!(
        case,
        Case::Success | Case::NoPresign | Case::Existing | Case::Media
    ) {
        lab.reset_admission().await;
        step(&mut lab, "attachment redelivery", &message.redelivered())
            .await
            .result
            .expect("duplicate");
    }
    lab.transcript.finish();
}
cases! {attachments;
    attachment_concurrency,72500,1,Case::Concurrency; attachment_concurrency_redelivery,75500,20,Case::Concurrency;
    attachment_refresh,72503,1,Case::Refresh; attachment_refresh_redelivery,75503,20,Case::Refresh;
    attachment_success,71800,1,Case::Success; attachment_success_redelivery,71803,20,Case::Success;
    attachment_existing,71806,1,Case::Existing;
    attachment_existing_redelivery,74806,20,Case::Existing; attachment_no_presign,71809,1,Case::NoPresign;
    attachment_no_presign_redelivery,74809,20,Case::NoPresign;
    attachment_presign_failure,71812,1,Case::PresignFailure;
    attachment_presign_failure_redelivery,74812,20,Case::PresignFailure; attachment_deleted,71815,1,Case::Deleted;
    attachment_deleted_redelivery,74815,20,Case::Deleted;
    attachment_media,71818,1,Case::Media;
    attachment_media_redelivery,74818,20,Case::Media; attachment_bad_media_id,71821,1,Case::BadMediaId;
    attachment_bad_media_id_redelivery,74821,20,Case::BadMediaId;
    attachment_media_rejected,71824,1,Case::MediaRejected;
    attachment_media_rejected_redelivery,74824,20,Case::MediaRejected; attachment_mapping_failure,71827,1,Case::MappingFault;
    attachment_mapping_failure_redelivery,74827,20,Case::MappingFault;
    attachment_no_filename,71830,1,Case::MissingFilename;
    attachment_no_filename_redelivery,74830,20,Case::MissingFilename; attachment_unsupported,71833,1,Case::Unsupported;
    attachment_unsupported_redelivery,74833,20,Case::Unsupported;
    attachment_lookup_failure,71836,1,Case::LookupFault;
    attachment_lookup_failure_redelivery,74836,20,Case::LookupFault; attachment_complete_job,71839,1,Case::Complete;
    attachment_complete_job_redelivery,74839,20,Case::Complete;
    attachment_failed_job,71842,1,Case::Failed;
    attachment_failed_job_redelivery,74842,20,Case::Failed; attachment_cancelled_job,71845,1,Case::Cancelled;
    attachment_cancelled_job_redelivery,74845,20,Case::Cancelled;
    attachment_fetch_400,71848,1,Case::Fetch(400);
    attachment_fetch_400_redelivery,74848,20,Case::Fetch(400); attachment_fetch_401,71851,1,Case::Fetch(401);
    attachment_fetch_403,71854,1,Case::Fetch(403);
    attachment_fetch_403_redelivery,74854,20,Case::Fetch(403); attachment_fetch_404,71857,1,Case::Fetch(404);
    attachment_fetch_404_redelivery,74857,20,Case::Fetch(404);
    attachment_fetch_409,71860,1,Case::Fetch(409);
    attachment_fetch_409_redelivery,74860,20,Case::Fetch(409); attachment_fetch_429,71863,1,Case::Fetch(429);
    attachment_fetch_500,71866,1,Case::Fetch(500);
    attachment_fetch_500_redelivery,74866,20,Case::Fetch(500); attachment_fetch_503,71869,1,Case::Fetch(503);
    attachment_fetch_503_redelivery,74869,20,Case::Fetch(503);
    attachment_fetch_disconnect,71872,1,Case::Fetch(0);
    attachment_fetch_disconnect_redelivery,74872,20,Case::Fetch(0); attachment_fetch_malformed,71875,1,Case::Fetch(200);
    attachment_fetch_malformed_redelivery,74875,20,Case::Fetch(200);
    attachment_fetch_401_redelivery,71878,20,Case::Fetch(401); attachment_fetch_429_redelivery,71881,20,Case::Fetch(429);
}
