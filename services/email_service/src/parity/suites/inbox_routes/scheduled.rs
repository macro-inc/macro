use super::*;

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_pages(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_pages", 41015).await;
    fixture::scheduled(&mut lab, 110).await;
    for (name, query) in [
        ("default page", ""),
        ("explicit maximum", "?limit=1000"),
        ("first item", "?limit=1&offset=0"),
        ("second item", "?limit=1&offset=1"),
        ("past end", "?offset=1000"),
        ("maximum offset", "?offset=4294967295"),
        ("ignored query field", "?unknown=1&limit=2"),
    ] {
        request(
            &mut lab,
            name,
            "GET",
            &format!("{SCHEDULED}{query}"),
            Auth::User(0),
            None,
            json!(null),
            200,
        )
        .await;
    }
    for (name, inbox, auth, status) in [
        (
            "second inbox",
            Some(lab.fixture.links[2]),
            Auth::User(0),
            200,
        ),
        (
            "delegated empty inbox",
            Some(lab.fixture.links[1]),
            Auth::User(0),
            200,
        ),
        (
            "Outlook empty inbox",
            Some(fixture::OUTLOOK),
            Auth::User(0),
            200,
        ),
        ("internal", None, Auth::Internal, 200),
        (
            "inaccessible",
            Some(lab.fixture.links[0]),
            Auth::User(2),
            404,
        ),
    ] {
        request(
            &mut lab,
            name,
            "GET",
            &format!("{SCHEDULED}?limit=1"),
            auth,
            inbox,
            json!(null),
            status,
        )
        .await;
    }
    lab.transcript.finish();
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn scheduled_bounds(pool: PgPool) {
    if !crate::parity::process_per_test() {
        return;
    }
    let mut lab = start(pool, "scheduled_bounds", 41018).await;
    for (name, query, status) in [
        ("zero", "?limit=0", 400),
        ("over maximum", "?limit=1001", 400),
        ("negative limit", "?limit=-1", 400),
        ("overflow limit", "?limit=4294967296", 400),
        ("negative offset", "?offset=-1", 400),
        ("overflow offset", "?offset=4294967296", 400),
        ("empty limit", "?limit=", 400),
        ("nonnumeric", "?limit=nan", 400),
        ("fractional", "?limit=1.5", 400),
        ("duplicate", "?limit=1&limit=2", 400),
        ("empty result", "?offset=0&limit=1000", 200),
    ] {
        request(
            &mut lab,
            name,
            "GET",
            &format!("{SCHEDULED}{query}"),
            Auth::User(0),
            None,
            json!(null),
            status,
        )
        .await;
    }
    lab.transcript.finish();
}
