use super::*;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_link_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_link_failure", 41200).await;
    lab.sql_fault.fail_acquisition(1);
    request(
        &mut lab,
        "database failure",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{}}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_update_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_update_failure", 41203).await;
    lab.sql_fault.fail_acquisition(2);
    request(
        &mut lab,
        "database failure",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{}}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_link_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_link_failure", 41206).await;
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":"Signature"}]}),
    );
    lab.sql_fault.fail_acquisition(1);
    request(
        &mut lab,
        "database failure",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!({"settings":{}}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_token_link_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_token_link_failure", 41209).await;
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":"Signature"}]}),
    );
    lab.sql_fault.fail_acquisition(2);
    request(
        &mut lab,
        "database failure",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!({"settings":{}}),
        502,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_update_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_update_failure", 41212).await;
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":"Signature"}]}),
    );
    lab.sql_fault.fail_acquisition(3);
    request(
        &mut lab,
        "database failure",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!({"settings":{}}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn contacts_link_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "contacts_link_failure", 41215).await;
    lab.sql_fault.fail_acquisition(1);
    request(
        &mut lab,
        "database failure",
        "GET",
        CONTACTS,
        Auth::User(0),
        None,
        json!({"settings":{}}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn contacts_first_query_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "contacts_first_query_failure", 41218).await;
    lab.sql_fault.fail_acquisition(2);
    request(
        &mut lab,
        "database failure",
        "GET",
        CONTACTS,
        Auth::User(0),
        None,
        json!({"settings":{}}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn contacts_second_query_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "contacts_second_query_failure", 41221).await;
    lab.sql_fault.fail_acquisition(3);
    request(
        &mut lab,
        "database failure",
        "GET",
        CONTACTS,
        Auth::User(0),
        None,
        json!({"settings":{}}),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_link_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_link_failure", 41224).await;
    fixture::scheduled(&mut lab, 8).await;
    lab.sql_fault.fail_acquisition(1);
    request(
        &mut lab,
        "database failure",
        "GET",
        SCHEDULED,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_message_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_message_failure", 41227).await;
    fixture::scheduled(&mut lab, 8).await;
    sqlx::query("ALTER TABLE email_messages RENAME COLUMN snippet TO parity_hidden_snippet")
        .execute(&lab.db)
        .await
        .expect("scheduled fault");
    request(
        &mut lab,
        "database failure",
        "GET",
        SCHEDULED,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_sender_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_sender_failure", 41230).await;
    fixture::scheduled(&mut lab, 8).await;
    sqlx::query(
        "ALTER TABLE email_contacts RENAME COLUMN original_photo_url TO parity_hidden_photo",
    )
    .execute(&lab.db)
    .await
    .expect("scheduled fault");
    request(
        &mut lab,
        "database failure",
        "GET",
        SCHEDULED,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_recipient_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_recipient_failure", 41233).await;
    fixture::scheduled(&mut lab, 8).await;
    sqlx::query("ALTER TABLE email_message_recipients RENAME TO parity_hidden_recipients")
        .execute(&lab.db)
        .await
        .expect("scheduled fault");
    request(
        &mut lab,
        "database failure",
        "GET",
        SCHEDULED,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_schedule_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_schedule_failure", 41236).await;
    fixture::scheduled(&mut lab, 8).await;
    sqlx::query(
        "ALTER TABLE email_scheduled_messages RENAME COLUMN actor_id TO parity_hidden_actor",
    )
    .execute(&lab.db)
    .await
    .expect("scheduled fault");
    request(
        &mut lab,
        "database failure",
        "GET",
        SCHEDULED,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_labels_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_labels_failure", 41239).await;
    fixture::scheduled(&mut lab, 8).await;
    sqlx::query("ALTER VIEW email_effective_message_labels RENAME TO parity_hidden_labels")
        .execute(&lab.db)
        .await
        .expect("scheduled fault");
    request(
        &mut lab,
        "database failure",
        "GET",
        SCHEDULED,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_attachments_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_attachments_failure", 41242).await;
    fixture::scheduled(&mut lab, 8).await;
    sqlx::query("ALTER TABLE email_attachments RENAME COLUMN filename TO parity_hidden_filename")
        .execute(&lab.db)
        .await
        .expect("scheduled fault");
    request(
        &mut lab,
        "database failure",
        "GET",
        SCHEDULED,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_draft_attachments_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_draft_attachments_failure", 41245).await;
    fixture::scheduled(&mut lab, 8).await;
    sqlx::query("ALTER TABLE email_attachments_drafts RENAME TO parity_hidden_drafts")
        .execute(&lab.db)
        .await
        .expect("scheduled fault");
    request(
        &mut lab,
        "database failure",
        "GET",
        SCHEDULED,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_forwarded_attachments_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_forwarded_attachments_failure", 41248).await;
    fixture::scheduled(&mut lab, 8).await;
    sqlx::query("ALTER TABLE email_attachments_fwd RENAME TO parity_hidden_forwarded")
        .execute(&lab.db)
        .await
        .expect("scheduled fault");
    request(
        &mut lab,
        "database failure",
        "GET",
        SCHEDULED,
        Auth::User(0),
        None,
        json!(null),
        500,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_mapping_fetch_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_mapping_fetch_failure", 41251).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    sqlx::raw_sql("ALTER TABLE email_sfs_mappings RENAME TO parity_hidden_mappings")
        .execute(&lab.db)
        .await
        .expect("mapping fault");
    request(
        &mut lab,
        "rehost database failure",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_mapping_insert_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_mapping_insert_failure", 41254).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    sqlx::raw_sql("CREATE FUNCTION parity_mapping_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity mapping failure'; END $$; CREATE TRIGGER parity_mapping_failure BEFORE INSERT ON email_sfs_mappings FOR EACH ROW EXECUTE FUNCTION parity_mapping_failure();").execute(&lab.db).await.expect("mapping fault");
    request(
        &mut lab,
        "rehost database failure",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_sfs_reservation_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_sfs_reservation_failure", 41257).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    lab.stub.reply(
        "PUT",
        "/internal/file",
        503,
        json!({"message":"SFS unavailable"}),
    );
    request(
        &mut lab,
        "static file service failure",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        422,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_sfs_decode_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_sfs_decode_failure", 41260).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    lab.stub.reply(
        "PUT",
        "/internal/file",
        200,
        json!({"invalid":"reservation"}),
    );
    request(
        &mut lab,
        "static file service failure",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        422,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_sfs_upload_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_sfs_upload_failure", 41263).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    lab.stub.reply(
        "PUT",
        "/upload/image",
        500,
        json!({"message":"upload failed"}),
    );
    request(
        &mut lab,
        "static file service failure",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        422,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_mapping_fetch_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_mapping_fetch_failure", 41266).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":signature}]}),
    );
    sqlx::raw_sql("ALTER TABLE email_sfs_mappings RENAME TO parity_hidden_mappings")
        .execute(&lab.db)
        .await
        .expect("mapping fault");
    request(
        &mut lab,
        "rehost database failure",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_mapping_insert_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_mapping_insert_failure", 41269).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":signature}]}),
    );
    sqlx::raw_sql("CREATE FUNCTION parity_mapping_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'parity mapping failure'; END $$; CREATE TRIGGER parity_mapping_failure BEFORE INSERT ON email_sfs_mappings FOR EACH ROW EXECUTE FUNCTION parity_mapping_failure();").execute(&lab.db).await.expect("mapping fault");
    request(
        &mut lab,
        "rehost database failure",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        200,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_sfs_reservation_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_sfs_reservation_failure", 41272).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":signature}]}),
    );
    lab.stub.reply(
        "PUT",
        "/internal/file",
        503,
        json!({"message":"SFS unavailable"}),
    );
    request(
        &mut lab,
        "static file service failure",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        422,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_sfs_decode_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_sfs_decode_failure", 41275).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":signature}]}),
    );
    lab.stub.reply(
        "PUT",
        "/internal/file",
        200,
        json!({"invalid":"reservation"}),
    );
    request(
        &mut lab,
        "static file service failure",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        422,
    )
    .await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_sfs_upload_failure(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_sfs_upload_failure", 41278).await;
    let url = fixture::image(&lab);
    let signature = format!("<img src=\"{url}\">");
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":"primary@example.com","isPrimary":true,"signature":signature}]}),
    );
    lab.stub.reply(
        "PUT",
        "/upload/image",
        500,
        json!({"message":"upload failed"}),
    );
    request(
        &mut lab,
        "static file service failure",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        422,
    )
    .await;
    lab.transcript.finish();
}
