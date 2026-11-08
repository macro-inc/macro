//! `TypesafeApiUrl`: typeSafe API base, which serves the Jev decision models. TypeSafe's

service_url::service_url! {
    /// TypeSafe API base, which serves the Jev decision models. TypeSafe's
    /// host in every environment; override it to run against the model
    /// stand-in of `crates/testing/email_e2e`. Only `email_focus_worker` reads it
    /// so far: the other services still use `jev_classifier`'s own constant.
    pub struct TypesafeApiUrl {
        local: "https://api.typesafe.ai",
        dev: "https://api.typesafe.ai",
        prod: "https://api.typesafe.ai",
    }
}
