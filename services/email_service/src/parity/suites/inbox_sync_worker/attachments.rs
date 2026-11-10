use super::*;

#[derive(Clone, Copy)]
enum Case {
    None,
    Unsupported,
    NoFilename,
    DocumentRejected,
    DocumentSuccess,
    NoPresign,
    PresignFailure,
    DocumentDeleted,
    Media,
    MediaBadId,
    MediaRejected,
    RateLimited,
    Transient,
    TwoRateLimited,
    ClaimsFault,
    RecipientsFault,
    Mixed,
    MissingMime,
    PlainNamed,
    PlainUnnamed,
    OctetValid,
    OctetInvalid,
    MediaNoFilename,
    ReleaseFault,
    MiddleRateLimited,
    LastRateLimited,
    MediaClaimsFault,
    MediaMappingFault,
    FetchStatus(u16),
}

#[expect(
    clippy::disallowed_methods,
    reason = "Attachment characterization seeds provider parts and database faults"
)]
async fn attachments(pool: PgPool, name: &'static str, shard: u32, retry: bool, case: Case) {
    let mut lab = start(pool, name, shard).await;
    let mut full = full_message(
        "attachment-message",
        "t1",
        &["INBOX", "UNREAD", "IMPORTANT"],
    );
    let media = matches!(
        case,
        Case::Media
            | Case::MediaBadId
            | Case::MediaRejected
            | Case::MediaNoFilename
            | Case::MediaClaimsFault
            | Case::MediaMappingFault
    );
    let mime = if media {
        "image/png"
    } else if matches!(case, Case::PlainNamed | Case::PlainUnnamed) {
        "text/plain"
    } else if matches!(case, Case::OctetValid | Case::OctetInvalid) {
        "application/octet-stream"
    } else if matches!(case, Case::Unsupported) {
        "application/unsupported"
    } else {
        "application/pdf"
    };
    let mut attachment = json!({"partId":"1","mimeType":mime,"filename":if media{"image.png"}else{"file.pdf"},"body":{"attachmentId":"attachment-1","size":4}});
    if matches!(
        case,
        Case::NoFilename | Case::PlainUnnamed | Case::MediaNoFilename
    ) {
        attachment["filename"] = json!("");
    }
    if matches!(case, Case::MissingMime) {
        attachment
            .as_object_mut()
            .expect("attachment")
            .remove("mimeType");
    }
    if matches!(case, Case::OctetInvalid) {
        attachment["filename"] = json!("file.unknown");
    }
    let count = if matches!(case, Case::MiddleRateLimited | Case::LastRateLimited) {
        3
    } else if matches!(
        case,
        Case::TwoRateLimited | Case::Mixed | Case::DocumentDeleted
    ) {
        2
    } else if matches!(case, Case::None) {
        0
    } else {
        1
    };
    let mut parts = vec![full["payload"].clone()];
    if count > 0 {
        parts.push(attachment.clone());
    }
    if count > 1 {
        attachment["partId"] = json!("2");
        attachment["body"]["attachmentId"] = json!("attachment-2");
        if matches!(case, Case::Mixed | Case::DocumentDeleted) {
            attachment["mimeType"] = json!("image/png");
            attachment["filename"] = json!("image.png");
        }
        parts.push(attachment.clone());
    }
    if count > 2 {
        attachment["partId"] = json!("3");
        attachment["body"]["attachmentId"] = json!("attachment-3");
        parts.push(attachment);
    }
    full["payload"] = json!({"mimeType":"multipart/mixed","filename":"","partId":"","parts":parts,"headers":full["payload"]["headers"].clone()});
    persistent(&lab, "messages/attachment-message", 200, full);
    for part in ["attachment-1", "attachment-2", "attachment-3"] {
        persistent(
            &lab,
            &format!("messages/attachment-message/attachments/{part}"),
            200,
            json!({"size":4,"data":"dGVzdA"}),
        );
    }
    if matches!(
        case,
        Case::RateLimited | Case::TwoRateLimited | Case::ReleaseFault
    ) {
        persistent(
            &lab,
            "messages/attachment-message/attachments/attachment-1",
            429,
            rejection(429),
        );
        lab.gmail.lock().endpoint_headers.insert(
            "/gmail/v1/users/me/messages/attachment-message/attachments/attachment-1".into(),
            vec![("retry-after".into(), "3600".into())],
        );
    }
    if let Case::FetchStatus(status) = case {
        let path = "/gmail/v1/users/me/messages/attachment-message/attachments/attachment-1";
        if status == 0 {
            lab.gmail.lock().drop_endpoints.insert(path.into());
        } else {
            persistent(
                &lab,
                "messages/attachment-message/attachments/attachment-1",
                status,
                if status == 200 {
                    json!({"data":false})
                } else {
                    rejection(status)
                },
            );
        }
    }
    if matches!(case, Case::MiddleRateLimited | Case::LastRateLimited) {
        let part = if matches!(case, Case::MiddleRateLimited) {
            "attachment-2"
        } else {
            "attachment-3"
        };
        persistent(
            &lab,
            &format!("messages/attachment-message/attachments/{part}"),
            429,
            rejection(429),
        );
        lab.gmail.lock().endpoint_headers.insert(
            format!("/gmail/v1/users/me/messages/attachment-message/attachments/{part}"),
            vec![("retry-after".into(), "3600".into())],
        );
    }
    if matches!(case, Case::Transient) {
        persistent(
            &lab,
            "messages/attachment-message/attachments/attachment-1",
            503,
            rejection(503),
        );
    }
    lab.stub.reply(
        "POST",
        "/internal/documents",
        if matches!(case, Case::DocumentDeleted) {
            404
        } else {
            500
        },
        if matches!(case, Case::DocumentDeleted) {
            json!({"code":"EMAIL_ATTACHMENT_NOT_FOUND"})
        } else {
            json!({"error":"scripted document failure"})
        },
    );
    if matches!(
        case,
        Case::DocumentSuccess | Case::NoPresign | Case::PresignFailure
    ) {
        let document = Uuid::from_u128(0x7b000000000000000000000000000002);
        lab.transcript
            .normalizer
            .symbol(document, "<uploaded-document>");
        let mut response = json!({"error":false,"data":{"documentMetadata":{
            "documentId":document.to_string(),"documentVersionId":1,"owner":lab.fixture.users[0],"documentName":"file","fileType":"pdf"
        },"contentType":"application/pdf","fileType":"pdf"}});
        if !matches!(case, Case::NoPresign) {
            response["data"]["presignedUrl"] = json!(format!("{}/document-upload", lab.stub.url));
        }
        lab.stub.reply("POST", "/internal/documents", 200, response);
        lab.stub.reply(
            "PUT",
            "/document-upload",
            if matches!(case, Case::PresignFailure) {
                500
            } else {
                200
            },
            json!({}),
        );
    }
    let media_id = Uuid::from_u128(0x7b000000000000000000000000000001);
    lab.transcript.normalizer.symbol(media_id, "<sfs-upload>");
    lab.stub.reply("PUT","/internal/file",if matches!(case,Case::MediaRejected){500}else{200},json!({"id":if matches!(case,Case::MediaBadId){"invalid".to_string()}else{media_id.to_string()},"upload_url":format!("{}/upload",lab.stub.url),"file_location":"fixture-location"}));
    match case {
        Case::ClaimsFault => {
            sqlx::query("ALTER TABLE document_email RENAME TO parity_hidden_document_email")
                .execute(&lab.db)
                .await
                .expect("claim fault");
        }
        Case::RecipientsFault => lab.sql_fault.fail_acquisition(11),
        Case::MediaClaimsFault => {
            sqlx::query("ALTER TABLE email_attachments_sfs RENAME TO parity_hidden_sfs")
                .execute(&lab.db)
                .await
                .expect("media claim fault");
        }
        Case::MediaMappingFault => trigger(&lab, "email_attachments_sfs", "INSERT", false).await,
        Case::ReleaseFault => {
            sqlx::query("CREATE FUNCTION parity_release_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.upload_claimed_at IS NOT NULL AND NEW.upload_claimed_at IS NULL THEN RAISE EXCEPTION 'parity injected release failure'; END IF; RETURN NEW; END $$").execute(&lab.db).await.expect("release fault");
            sqlx::query("CREATE TRIGGER parity_release_fault BEFORE UPDATE ON email_attachments FOR EACH ROW EXECUTE FUNCTION parity_release_fault()").execute(&lab.db).await.expect("release trigger");
        }
        _ => {}
    }
    let message = delivery(&lab, Op::Upsert, "attachment-message");
    let result = lab
        .worker_step("attachment import", queue(retry), &message)
        .await;
    result.result.expect("upload handled");
    if matches!(
        case,
        Case::Media | Case::DocumentDeleted | Case::RateLimited | Case::TwoRateLimited
    ) {
        lab.reset_admission().await;
        persistent(
            &lab,
            "messages/attachment-message/attachments/attachment-1",
            200,
            json!({"size":4,"data":"dGVzdA"}),
        );
        let again = result
            .sent
            .iter()
            .find(|sent| sent.queue_url.contains("retry"))
            .map(Delivery::from_sent)
            .unwrap_or_else(|| message.redelivered());
        lab.worker_step(
            "attachment retry from outcome",
            if result.sent.iter().any(|s| s.queue_url.contains("retry")) {
                Queue::InboxSyncRetry
            } else {
                queue(retry)
            },
            &again,
        )
        .await
        .result
        .expect("upload retry handled");
    }
    lab.transcript.finish();
}

cases! { attachments;
    attachments_none_primary, 77000, false, Case::None;
    attachments_none_retry, 77003, true, Case::None;
    attachments_unsupported_primary, 77006, false, Case::Unsupported;
    attachments_unsupported_retry, 77009, true, Case::Unsupported;
    attachments_no_filename_primary, 77012, false, Case::NoFilename;
    attachments_no_filename_retry, 77015, true, Case::NoFilename;
    attachments_document_rejected_primary, 77018, false, Case::DocumentRejected;
    attachments_document_rejected_retry, 77021, true, Case::DocumentRejected;
    attachments_document_deleted_primary, 77024, false, Case::DocumentDeleted;
    attachments_document_deleted_retry, 77027, true, Case::DocumentDeleted;
    attachments_media_primary, 77030, false, Case::Media;
    attachments_media_retry, 77033, true, Case::Media;
    attachments_media_bad_id_primary, 77036, false, Case::MediaBadId;
    attachments_media_bad_id_retry, 77039, true, Case::MediaBadId;
    attachments_media_rejected_primary, 77042, false, Case::MediaRejected;
    attachments_media_rejected_retry, 77045, true, Case::MediaRejected;
    attachments_rate_limited_primary, 77048, false, Case::RateLimited;
    attachments_rate_limited_retry, 77051, true, Case::RateLimited;
    attachments_transient_primary, 77054, false, Case::Transient;
    attachments_transient_retry, 77057, true, Case::Transient;
    attachments_two_rate_limited_primary, 77060, false, Case::TwoRateLimited;
    attachments_two_rate_limited_retry, 77063, true, Case::TwoRateLimited;
    attachments_claims_fault_primary, 77066, false, Case::ClaimsFault;
    attachments_claims_fault_retry, 77069, true, Case::ClaimsFault;
    attachments_recipients_fault_primary, 77072, false, Case::RecipientsFault;
    attachments_recipients_fault_retry, 77075, true, Case::RecipientsFault;
    attachments_mixed_primary, 77078, false, Case::Mixed;
    attachments_mixed_retry, 77081, true, Case::Mixed;
}

cases! { attachments;
 attachments_document_success_primary, 79000, false, Case::DocumentSuccess;
 attachments_document_success_retry, 79003, true, Case::DocumentSuccess;
 attachments_no_presign_primary, 79006, false, Case::NoPresign;
 attachments_no_presign_retry, 79009, true, Case::NoPresign;
 attachments_presign_failure_primary, 79012, false, Case::PresignFailure;
 attachments_presign_failure_retry, 79015, true, Case::PresignFailure;
}

cases! { attachments;
    attachments_missing_mime_primary, 81000, false, Case::MissingMime;
    attachments_missing_mime_retry, 81003, true, Case::MissingMime;
    attachments_plain_named_primary, 81006, false, Case::PlainNamed;
    attachments_plain_named_retry, 81009, true, Case::PlainNamed;
    attachments_plain_unnamed_primary, 81012, false, Case::PlainUnnamed;
    attachments_plain_unnamed_retry, 81015, true, Case::PlainUnnamed;
    attachments_octet_valid_primary, 81018, false, Case::OctetValid;
    attachments_octet_valid_retry, 81021, true, Case::OctetValid;
    attachments_octet_invalid_primary, 81024, false, Case::OctetInvalid;
    attachments_octet_invalid_retry, 81027, true, Case::OctetInvalid;
    attachments_media_no_filename_primary, 81030, false, Case::MediaNoFilename;
    attachments_media_no_filename_retry, 81033, true, Case::MediaNoFilename;
    attachments_release_fault_primary, 81036, false, Case::ReleaseFault;
    attachments_release_fault_retry, 81039, true, Case::ReleaseFault;
    attachments_middle_rate_limited_primary, 81042, false, Case::MiddleRateLimited;
    attachments_middle_rate_limited_retry, 81045, true, Case::MiddleRateLimited;
    attachments_last_rate_limited_primary, 81048, false, Case::LastRateLimited;
    attachments_last_rate_limited_retry, 81051, true, Case::LastRateLimited;
    attachments_media_claims_fault_primary, 81054, false, Case::MediaClaimsFault;
    attachments_media_claims_fault_retry, 81057, true, Case::MediaClaimsFault;
    attachments_media_mapping_fault_primary, 81060, false, Case::MediaMappingFault;
    attachments_media_mapping_fault_retry, 81063, true, Case::MediaMappingFault;
    attachments_fetch_status_400_primary, 81066, false, Case::FetchStatus(400);
    attachments_fetch_status_400_retry, 81069, true, Case::FetchStatus(400);
    attachments_fetch_status_401_primary, 81072, false, Case::FetchStatus(401);
    attachments_fetch_status_401_retry, 81075, true, Case::FetchStatus(401);
    attachments_fetch_status_403_primary, 81078, false, Case::FetchStatus(403);
    attachments_fetch_status_403_retry, 81081, true, Case::FetchStatus(403);
    attachments_fetch_status_404_primary, 81084, false, Case::FetchStatus(404);
    attachments_fetch_status_404_retry, 81087, true, Case::FetchStatus(404);
    attachments_fetch_status_409_primary, 81090, false, Case::FetchStatus(409);
    attachments_fetch_status_409_retry, 81093, true, Case::FetchStatus(409);
    attachments_fetch_status_500_primary, 81096, false, Case::FetchStatus(500);
    attachments_fetch_status_500_retry, 81099, true, Case::FetchStatus(500);
    attachments_fetch_status_503_primary, 81102, false, Case::FetchStatus(503);
    attachments_fetch_status_503_retry, 81105, true, Case::FetchStatus(503);
    attachments_fetch_status_0_primary, 81108, false, Case::FetchStatus(0);
    attachments_fetch_status_0_retry, 81111, true, Case::FetchStatus(0);
    attachments_fetch_status_200_primary, 81114, false, Case::FetchStatus(200);
    attachments_fetch_status_200_retry, 81117, true, Case::FetchStatus(200);
}
