use super::*;
use crate::parity::stub::WireBody;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn image_fetch_failures(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "image_fetch_failures", 41640).await;
    let gif = b"GIF89a\x01\x00\x01\x00image".to_vec();
    lab.stub
        .reply_bytes("GET", "/empty-image", 200, vec![], "image/gif");
    lab.stub.reply_bytes(
        "GET",
        "/unknown-image",
        200,
        b"unknown image type".to_vec(),
        "image/gif",
    );
    lab.stub.reply_bytes(
        "GET",
        "/pdf-image",
        200,
        b"%PDF-1.7\nnot an image".to_vec(),
        "application/pdf",
    );
    lab.stub.reply_wire(
        "/large-header",
        &[("content-length", "10485761")],
        WireBody::Stream {
            chunks: vec![vec![b'x'; 10 * 1024 * 1024 + 1]],
            fail: false,
        },
    );
    lab.stub.reply_wire(
        "/large-stream",
        &[],
        WireBody::Stream {
            chunks: vec![gif.clone(), vec![b'x'; 10 * 1024 * 1024]],
            fail: false,
        },
    );
    lab.stub.reply_wire(
        "/broken-image",
        &[],
        WireBody::Stream {
            chunks: vec![gif],
            fail: true,
        },
    );
    let redirect = format!("{}/redirect-image", lab.stub.url);
    lab.stub.reply_wire(
        "/redirect-image",
        &[("location", &redirect)],
        WireBody::Stream {
            chunks: vec![],
            fail: false,
        },
    );
    lab.stub
        .reply_wire("/timeout-image", &[], WireBody::Pending);

    request(
        &mut lab,
        "settings before image failures",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":"Original signature","read_receipts_enabled":true}}),
        200,
    )
    .await;
    for path in [
        "empty-image",
        "unknown-image",
        "pdf-image",
        "large-header",
        "large-stream",
        "broken-image",
        "redirect-image",
        "timeout-image",
    ] {
        let url = format!("{}/{path}", lab.stub.url);
        request(&mut lab, path, "PATCH", SETTINGS, Auth::User(0), None, json!({"settings":{"signature":format!("<img src=\"{url}\">"),"read_receipts_enabled":false}}), 422).await;
    }

    // A bound socket that never listens deterministically refuses connections;
    // keeping it bound prevents another scenario from reusing its port.
    let refused = tokio::net::TcpSocket::new_v4().expect("image socket");
    refused
        .bind("127.0.0.1:0".parse().expect("loopback address"))
        .expect("reserve refused image port");
    let refused_url = format!(
        "http://{}/image",
        refused.local_addr().expect("reserved address")
    );
    lab.transcript
        .normalizer
        .replace(&refused_url, "<refused-image>");
    request(&mut lab, "connection refused", "PATCH", SETTINGS, Auth::User(0), None, json!({"settings":{"signature":format!("<img src=\"{refused_url}\">"),"read_receipts_enabled":false}}), 422).await;

    let url = fixture::image(&lab);
    request(&mut lab, "fragment removed before fetch and unmapped image preserved", "PATCH", SETTINGS, Auth::User(0), None, json!({"settings":{"signature":format!("<img src=\"{url}#fragment\"><img src=\"https://static-file-service.example.com/existing\">" )}}), 200).await;
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn import_multiple_unresolved(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "import_multiple_unresolved", 41643).await;
    lab.transcript.normalizer.sort_sfs_source_sets = true;
    lab.stub.reply("GET", "/unresolved-image", 403, json!({}));
    let signature = format!(
        "<img src=\"{}/unresolved-image#one\"><img src=\"{}/unresolved-image#two\"><img src=\"{}/unresolved-image#one\">",
        lab.stub.url, lab.stub.url, lab.stub.url
    );
    let address = lab.fixture.users[0]
        .trim_start_matches("macro|")
        .to_string();
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":address,"signature":signature}]}),
    );
    // The count is distinct source URLs, not img tags. Fetching removes the
    // fragments, making both concurrent HTTP requests byte-identical rather
    // than pinning their incidental execution order.
    for name in ["two unresolved imports", "repeat unresolved import"] {
        request(
            &mut lab,
            name,
            "POST",
            IMPORT,
            Auth::User(0),
            None,
            json!(null),
            422,
        )
        .await;
    }
    request(
        &mut lab,
        "two unresolved patch images",
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
async fn image_url_edges(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "image_url_edges", 41646).await;
    request(
        &mut lab,
        "ordinary relative image is ignored",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":"<img src=\"relative.gif\">","read_receipts_enabled":true}}),
        200,
    )
    .await;
    let signature = "<img src=\"http-relative.gif\">";
    request(
        &mut lab,
        "HTTP-looking relative image rejects the whole patch",
        "PATCH",
        SETTINGS,
        Auth::User(0),
        None,
        json!({"settings":{"signature":signature,"read_receipts_enabled":false}}),
        422,
    )
    .await;
    let address = lab.fixture.users[0]
        .trim_start_matches("macro|")
        .to_string();
    fixture::gmail(
        &lab,
        json!({"sendAs":[{"sendAsEmail":address,"signature":signature}]}),
    );
    request(
        &mut lab,
        "HTTP-looking relative image rejects import",
        "POST",
        IMPORT,
        Auth::User(0),
        None,
        json!(null),
        422,
    )
    .await;
    let image = fixture::image(&lab);
    let long_url = format!("{image}?padding={}", "x".repeat(2100));
    for name in [
        "long source URL is uploaded without caching",
        "long source URL uploads again",
    ] {
        request(
            &mut lab,
            name,
            "PATCH",
            SETTINGS,
            Auth::User(0),
            None,
            json!({"settings":{"signature":format!("<img src=\"{long_url}\">" )}}),
            200,
        )
        .await;
    }
    lab.transcript.finish();
}
