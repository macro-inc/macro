use std::path::Path;

use super::list;
use crate::repo::Repo;
use crate::sources::{HttpSource, ItemRef};

const API: &str = r#"
use axum::Router;

mod health;
mod things;

const VERSION_PREFIX: &str = "/v1";

pub fn app() -> Router {
    let api = api_router();
    mount_twice(api.merge(health::router())).merge(docs())
}

fn mount_twice(inner: Router) -> Router {
    Router::new().merge(inner.clone()).nest("/gateway", inner)
}

fn docs() -> Router {
    Router::new().merge(Swagger::new("/docs"))
}

fn api_router() -> Router {
    Router::new()
        .route("/ping", axum::routing::get(ping))
        .nest(VERSION_PREFIX, things::router())
        .nest("/other", other::inbound::router::<State>())
}
"#;

const THINGS: &str = r#"
use axum::routing::{delete, get};

pub fn router() -> Router {
    let listed = Router::new().route("/", get(list).post(create));
    listed.merge(Router::new().route("/{id}", delete(remove).layer(limit())))
}
"#;

const HEALTH: &str = r#"
pub fn router() -> Router {
    Router::new().route("/health", get(health))
}
"#;

const OTHER_CRATE_ROUTER: &str = r#"
pub fn router<S>() -> Router<S> {
    Router::new().route("/items", put(upsert)).with_state(state)
}
"#;

fn write(root: &Path, file: &str, text: &str) {
    let path = root.join(file);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn source() -> HttpSource {
    HttpSource {
        root: ItemRef {
            file: "services/svc/src/api.rs".to_owned(),
            ident: "app".to_owned(),
        },
        skip: vec!["docs".to_owned()],
        mounted_again: vec!["mount_twice".to_owned()],
    }
}

#[test]
fn follows_nest_merge_const_prefix_and_other_crates() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "services/svc/Cargo.toml", "");
    write(root.path(), "services/svc/src/api.rs", API);
    write(root.path(), "services/svc/src/api/things.rs", THINGS);
    write(root.path(), "services/svc/src/api/health.rs", HEALTH);
    write(root.path(), "crates/other/Cargo.toml", "");
    write(root.path(), "crates/other/src/lib.rs", "pub mod inbound;");
    write(
        root.path(),
        "crates/other/src/inbound.rs",
        OTHER_CRATE_ROUTER,
    );

    let entries = list(&Repo::new(root.path()), &source()).unwrap();
    let mut rows: Vec<String> = entries
        .iter()
        .map(|entry| format!("{} @ {}", entry.key, entry.loc))
        .collect();
    rows.sort();

    assert_eq!(
        rows,
        [
            "DELETE /v1/{id} @ services/svc/src/api/things.rs:6",
            "GET /health @ services/svc/src/api/health.rs:3",
            "GET /ping @ services/svc/src/api.rs:24",
            "GET /v1 @ services/svc/src/api/things.rs:5",
            "POST /v1 @ services/svc/src/api/things.rs:5",
            "PUT /other/items @ crates/other/src/inbound.rs:3",
        ]
    );
}

#[test]
fn fails_on_a_router_function_it_cannot_find() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "services/svc/Cargo.toml", "");
    write(root.path(), "services/svc/src/api.rs", API);
    write(root.path(), "services/svc/src/api/things.rs", THINGS);
    write(root.path(), "services/svc/src/api/health.rs", HEALTH);

    let error = list(&Repo::new(root.path()), &source()).unwrap_err();

    assert!(
        error
            .to_string()
            .contains("services/svc/src/api.rs:26: cannot resolve `other::inbound::router`"),
        "{error}"
    );
}

#[test]
fn fails_on_a_route_path_it_cannot_read() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "services/svc/Cargo.toml", "");
    write(
        root.path(),
        "services/svc/src/api.rs",
        r#"
pub fn app() -> Router {
    Router::new().route(&format!("/{name}"), get(named))
}
"#,
    );

    let source = HttpSource {
        root: ItemRef {
            file: "services/svc/src/api.rs".to_owned(),
            ident: "app".to_owned(),
        },
        skip: Vec::new(),
        mounted_again: Vec::new(),
    };
    let error = list(&Repo::new(root.path()), &source).unwrap_err();

    assert!(
        error
            .to_string()
            .contains("services/svc/src/api.rs:3: this route path is neither"),
        "{error}"
    );
}

#[test]
fn fails_on_routes_added_outside_the_final_expression() {
    let root = tempfile::tempdir().unwrap();
    write(root.path(), "services/svc/Cargo.toml", "");
    write(
        root.path(),
        "services/svc/src/api.rs",
        r#"
pub fn app() -> Router {
    let mut router = Router::new();
    if enabled() {
        router = router.route("/beta", get(beta));
    }
    router
}
"#,
    );

    let error = list(&Repo::new(root.path()), &source()).unwrap_err();

    assert!(
        error
            .to_string()
            .contains("services/svc/src/api.rs:5: `app` adds routes in a statement"),
        "{error}"
    );
}
