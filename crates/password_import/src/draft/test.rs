use super::Draft;
use crate::model::{
    DroppedPart, FolderPath, ImportedItem, ItemKind, Secret, SkipReason, SourceFolder, SourceKey,
};
use crate::vault;

fn draft() -> Draft {
    Draft::new(SourceKey::from_row_index(0), ItemKind::Login)
}

fn secret(value: &str) -> Secret {
    Secret::new(value.to_owned())
}

fn imported(draft: Draft) -> ImportedItem {
    match draft.finish() {
        Ok((item, _)) => item,
        Err(skipped) => panic!("expected an item, skipped as {:?}", skipped.reason),
    }
}

fn skip_reason(draft: Draft) -> SkipReason {
    match draft.finish() {
        Ok(_) => panic!("expected a skip"),
        Err(skipped) => skipped.reason,
    }
}

fn fields(item: &ImportedItem) -> Vec<(&str, &str, bool)> {
    item.fields
        .iter()
        .map(|field| {
            (
                field.label.as_str(),
                field.value.expose_secret(),
                field.concealed,
            )
        })
        .collect()
}

#[test]
fn a_full_login_lands_as_written() {
    let mut draft = draft();
    draft.set_name(Some("Example".to_owned()));
    draft.add_url("https://example.com/login");
    draft.add_username(secret("user-one"));
    draft.add_password(secret("not-a-real-password"));
    draft.set_notes(secret("a note"));
    draft.add_field("PIN", secret("1234"), true);

    let item = imported(draft);

    assert_eq!(item.name, "Example");
    assert_eq!(item.url.as_deref(), Some("https://example.com/login"));
    assert_eq!(item.username.expose_secret(), "user-one");
    assert_eq!(item.password.expose_secret(), "not-a-real-password");
    assert_eq!(item.notes.expose_secret(), "a note");
    assert_eq!(fields(&item), vec![("PIN", "1234", true)]);
}

#[test]
fn a_value_over_the_limit_skips_the_item_rather_than_truncating() {
    let mut at_limit = draft();
    at_limit.set_notes(secret(&"n".repeat(vault::MAX_VALUE_BYTES)));
    assert_eq!(
        imported(at_limit).notes.expose_secret().len(),
        vault::MAX_VALUE_BYTES
    );

    let mut over_limit = draft();
    over_limit.set_notes(secret(&"n".repeat(vault::MAX_VALUE_BYTES + 1)));
    assert_eq!(skip_reason(over_limit), SkipReason::TooLarge);
}

#[test]
fn a_passkey_only_item_is_skipped_and_a_passkey_beside_a_password_is_dropped() {
    let mut passkey_only = draft();
    passkey_only.add_url("https://example.com");
    passkey_only.drop_part(DroppedPart::Passkey, 1);
    assert_eq!(skip_reason(passkey_only), SkipReason::Passkey);

    let mut with_password = draft();
    with_password.add_password(secret("not-a-real-password"));
    with_password.drop_part(DroppedPart::Passkey, 1);
    let (_, dropped) = with_password.finish().expect("imported");
    assert_eq!(dropped.len(), 1);
    assert_eq!(
        dropped.first().map(|part| part.what),
        Some(DroppedPart::Passkey)
    );
}

#[test]
fn the_first_login_url_is_the_item_url_and_the_rest_are_numbered_websites() {
    let mut draft = draft();
    draft.add_url("ftp://files.example.com");
    draft.add_url("https://example.com");
    draft.add_url("https://example.com");
    draft.add_url("https://second.example.com");
    draft.add_labeled_url(Some("Hostname".to_owned()), "db.internal", false);

    let item = imported(draft);

    assert_eq!(item.url.as_deref(), Some("https://example.com"));
    assert_eq!(
        fields(&item),
        vec![
            ("Website 2", "ftp://files.example.com", false),
            ("Website 3", "https://second.example.com", false),
            ("Hostname", "db.internal", false),
        ]
    );
}

#[test]
fn a_url_with_credentials_is_never_the_item_url_and_stays_concealed() {
    let mut draft = draft();
    draft.add_url("https://user:not-a-real-password@bank.example/");
    draft.add_labeled_url(Some("Server".to_owned()), "hidden.example", true);

    let item = imported(draft);

    assert_eq!(item.url, None);
    assert_eq!(
        fields(&item),
        vec![
            (
                "Website",
                "https://user:not-a-real-password@bank.example/",
                true
            ),
            ("Server", "hidden.example", true),
        ]
    );
}

#[test]
fn the_first_default_totp_is_the_code_and_others_are_concealed_fields() {
    let mut draft = draft();
    draft.add_one_time_password(secret(
        "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256",
    ));
    draft.add_one_time_password(secret("JBSWY3DPEHPK3PXP"));
    draft.add_one_time_password(secret("KRSXG5CTMVRXEZLU"));

    let (item, dropped) = draft.finish().expect("imported");

    assert_eq!(
        item.totp.as_ref().map(|seed| seed.expose_secret()),
        Some("JBSWY3DPEHPK3PXP")
    );
    assert_eq!(
        fields(&item),
        vec![
            (
                "One-time password",
                "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256",
                true
            ),
            ("One-time password", "KRSXG5CTMVRXEZLU", true),
        ]
    );
    assert_eq!(dropped.first().map(|part| part.count), Some(2));
}

#[test]
fn fifty_one_urls_fit_and_fifty_two_make_the_item_too_large() {
    let urls = |count: usize| {
        let mut draft = draft();
        for number in 0..count {
            draft.add_url(&format!("https://site{number}.example.com"));
        }
        draft
    };

    let item = imported(urls(vault::MAX_FIELDS + 1));
    assert_eq!(item.fields.len(), vault::MAX_FIELDS);

    assert_eq!(
        skip_reason(urls(vault::MAX_FIELDS + 2)),
        SkipReason::TooLarge
    );
}

#[test]
fn urls_past_the_cap_are_not_kept() {
    let mut draft = draft();
    for number in 0..10_000 {
        draft.add_url(&format!("https://site{number}.example.com"));
    }

    assert_eq!(draft.urls.len(), vault::MAX_FIELDS + 1);
    assert!(draft.too_large);
}

#[test]
fn fields_past_the_vault_limit_are_not_kept() {
    let mut draft = draft();
    for number in 0..10_000 {
        draft.add_field("Field", secret(&number.to_string()), false);
    }

    assert_eq!(draft.fields.len(), vault::MAX_FIELDS);
    assert_eq!(skip_reason(draft), SkipReason::TooLarge);
}

#[test]
fn an_item_over_the_json_size_cap_is_too_large() {
    let with_fields = |count: usize| {
        let mut draft = draft();
        for _ in 0..count {
            draft.add_field("Key", secret(&"k".repeat(vault::MAX_VALUE_BYTES)), true);
        }
        draft
    };

    // Each field is within limits; together they pass the write size.
    assert_eq!(imported(with_fields(15)).fields.len(), 15);
    assert_eq!(skip_reason(with_fields(16)), SkipReason::TooLarge);

    // Escapes count: a value of quotes doubles as JSON.
    let mut escaped = draft();
    for _ in 0..8 {
        escaped.add_field("Key", secret(&"\"".repeat(vault::MAX_VALUE_BYTES)), true);
    }
    assert_eq!(skip_reason(escaped), SkipReason::TooLarge);
}

#[test]
fn a_folder_name_over_the_limit_skips_the_item() {
    let mut draft = draft();
    draft.set_folder(FolderPath::parse([
        "Work",
        "f".repeat(vault::MAX_FOLDER_NAME_BYTES + 1).as_str(),
    ]));
    assert_eq!(skip_reason(draft), SkipReason::TooLarge);

    let mut filed = super::Draft::new(SourceKey::from_row_index(1), ItemKind::Note);
    filed.set_notes(secret("a note"));
    filed.set_folder(FolderPath::parse(["Work", "", " Clients "]));
    let item = imported(filed);
    assert_eq!(
        item.folder.as_ref().map(FolderPath::segments),
        Some(["Work".to_owned(), "Clients".to_owned()].as_slice())
    );
    assert!(matches!(FolderPath::parse(["", " "]), SourceFolder::None));
}

#[test]
fn a_list_cut_short_at_the_source_skips_the_item() {
    let mut draft = draft();
    draft.add_password(secret("not-a-real-password"));
    draft.mark_too_large();
    assert_eq!(skip_reason(draft), SkipReason::TooLarge);
}
