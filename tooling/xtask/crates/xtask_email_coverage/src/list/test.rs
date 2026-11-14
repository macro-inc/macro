use super::{apply_overrides, default_providers};
use crate::row::{Kind, Providers, Row};
use crate::sources::ProvidersOverride;

#[test]
fn providers_come_from_the_key_before_the_path() {
    assert_eq!(
        default_providers(
            "POST /outlook/webhook/{attempt}",
            "services/email_service/src/api/outlook.rs"
        ),
        Providers::Outlook
    );
    assert_eq!(
        default_providers(
            "gmail-ops:DeleteLabel",
            "crates/models_email/src/gmail/gmail_ops.rs"
        ),
        Providers::Gmail
    );
    assert_eq!(
        default_providers("Route", "crates/outlook_emulator/src/fault.rs"),
        Providers::Outlook
    );
    assert_eq!(
        default_providers(
            "POST /email/init",
            "services/email_service/src/api/email.rs"
        ),
        Providers::Both
    );
}

#[test]
fn an_override_that_matches_no_row_is_an_error() {
    let mut rows = [Row {
        kind: Kind::Queue,
        key: "backfill:Init".to_owned(),
        providers: Providers::Both,
        matcher: "/backfillOperation/init".to_owned(),
        source: "backfill.rs:65".to_owned(),
    }];
    let covering = ProvidersOverride {
        kind: Kind::Queue,
        key: "backfill:*".to_owned(),
        providers: Providers::Gmail,
        reason: "Gmail only".to_owned(),
    };
    let stale = ProvidersOverride {
        kind: Kind::Http,
        key: "backfill:Init".to_owned(),
        providers: Providers::Gmail,
        reason: "wrong kind".to_owned(),
    };

    apply_overrides(&mut rows, &[covering]).unwrap();
    assert_eq!(rows[0].providers, Providers::Gmail);

    let error = apply_overrides(&mut rows, &[stale]).unwrap_err();
    assert!(error.to_string().contains("matches no row"), "{error}");
}
