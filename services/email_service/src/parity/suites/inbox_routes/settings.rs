use super::*;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_fields(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_fields", 41000).await;
    for (name, settings) in [
        ("new settings with defaults", json!({})),
        (
            "signature only",
            json!({"signature":"<p>Signature</p><script>bad()</script>"}),
        ),
        (
            "signature unchanged",
            json!({"signature":"<p>Signature</p>"}),
        ),
        (
            "enable replies",
            json!({"signature_on_replies_forwards":true}),
        ),
        (
            "disable replies",
            json!({"signature_on_replies_forwards":false}),
        ),
        (
            "disable read receipts",
            json!({"read_receipts_enabled":false}),
        ),
        (
            "enable read receipts",
            json!({"read_receipts_enabled":true}),
        ),
        (
            "all fields",
            json!({"signature":"Combined","signature_on_replies_forwards":true,"read_receipts_enabled":false}),
        ),
        (
            "explicit null leaves fields unchanged",
            json!({"signature":null,"signature_on_replies_forwards":null,"read_receipts_enabled":null}),
        ),
        ("empty signature clears", json!({"signature":""})),
        ("unknown fields ignored", json!({"unknown":123})),
    ] {
        request(
            &mut lab,
            name,
            "PATCH",
            SETTINGS,
            Auth::User(0),
            None,
            json!({"settings":settings}),
            200,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_inboxes(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_inboxes", 41003).await;
    for (name, auth, inbox, status) in [
        (
            "second own inbox",
            Auth::User(0),
            Some(lab.fixture.links[2]),
            200,
        ),
        (
            "delegated inbox",
            Auth::User(0),
            Some(lab.fixture.links[1]),
            200,
        ),
        ("owner of delegated inbox", Auth::User(1), None, 200),
        ("Outlook inbox", Auth::User(0), Some(fixture::OUTLOOK), 200),
        ("internal caller", Auth::Internal, None, 200),
        (
            "inaccessible inbox",
            Auth::User(2),
            Some(lab.fixture.links[0]),
            404,
        ),
        ("no primary", Auth::User(2), None, 400),
        ("missing inbox", Auth::User(0), Some(MISSING), 404),
    ] {
        request(
            &mut lab,
            name,
            "PATCH",
            SETTINGS,
            auth,
            inbox,
            json!({"settings":{"signature":name}}),
            status,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_rejections(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_rejections", 41006).await;
    assert_eq!(
        lab.request(
            "absent content type",
            "PATCH",
            SETTINGS,
            Auth::User(0),
            RequestBody::Empty
        )
        .await,
        415
    );
    for body in [
        json!({}),
        json!({"settings":null}),
        json!([]),
        json!({"settings":{"signature":true}}),
        json!({"settings":{"read_receipts_enabled":"yes"}}),
        json!({"settings":{"signature_on_replies_forwards":1}}),
    ] {
        request(
            &mut lab,
            "invalid field type",
            "PATCH",
            SETTINGS,
            Auth::User(0),
            None,
            body,
            422,
        )
        .await;
    }
    for (name, bytes, content_type, status) in [
        ("malformed", b"{".to_vec(), "application/json", 400),
        ("empty", vec![], "application/json", 400),
        ("wrong media type", b"{}".to_vec(), "text/plain", 415),
    ] {
        assert_eq!(
            lab.request(
                name,
                "PATCH",
                SETTINGS,
                Auth::User(0),
                RequestBody::Raw {
                    bytes,
                    content_type
                }
            )
            .await,
            status
        );
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_images(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_images", 41009).await;
    let url = fixture::image(&lab);
    let signature = format!("<p>Images</p><img src=\"{url}\"><img src=\"{url}\">");
    request(
        &mut lab,
        "upload duplicate image once",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        200,
    )
    .await;
    request(
        &mut lab,
        "reuse cached mapping",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature}}),
        200,
    )
    .await;
    request(&mut lab,"skip SFS and Barracuda and relative images","PATCH",SETTINGS,Auth::User(0),None,json!({"settings":{"signature":"<img src=\"https://static-file-service.example.com/a\"><img src=\"https://linkprotect.cudasvc.com/a\"><img src=\"cid:image\"><img src=\"/relative\"><img>"}}),200).await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn patch_unresolved(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "patch_unresolved", 41012).await;
    let url = format!("{}/unavailable", lab.stub.url);
    lab.stub
        .reply("GET", "/unavailable", 403, json!({"error":"private image"}));
    request(&mut lab,"unresolved image rejects whole patch","PATCH",SETTINGS,Auth::User(0),None,json!({"settings":{"signature":format!("<img src=\"{url}\">"),"read_receipts_enabled":false}}),422).await;
    request(
        &mut lab,
        "invalid remote URL is stripped by sanitizer",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":"<img src=\"http://[broken\">"}}),
        200,
    )
    .await;
    lab.transcript.finish();
}
