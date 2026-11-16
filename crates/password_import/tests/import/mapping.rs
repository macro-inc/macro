//! Mapping rules that the golden snapshots don't single out.
use password_import::{Limits, SourceFormat, parse};

use super::support::zip;

fn pux(export_data: &str) -> Vec<u8> {
    zip(&[("export.data", export_data.as_bytes().to_vec())])
}

#[test]
fn a_repeated_csv_header_keeps_the_second_column_as_a_field() {
    let csv =
        "Title,Url,Username,Password,Password\nExample,,user-one,first-password,second-password\n";

    let export = parse(
        csv.as_bytes(),
        SourceFormat::OnePasswordCsv,
        &Limits::default(),
    )
    .expect("parses");
    let item = export.items.first().expect("one item");

    assert_eq!(item.password.expose_secret(), "first-password");
    let fields: Vec<(&str, &str)> = item
        .fields
        .iter()
        .map(|field| (field.label.as_str(), field.value.expose_secret()))
        .collect();
    assert_eq!(fields, vec![("Password", "second-password")]);
}

#[test]
fn the_primary_1password_url_wins_and_other_urls_keep_their_labels() {
    let export = pux(
        r#"{"accounts":[{"attrs":{"uuid":"account1"},"vaults":[{"attrs":{"uuid":"vault1","name":"Vault"},"items":[
            {"uuid":"item1","categoryUuid":"001","overview":{"title":"Example",
             "url":"https://primary.example.com",
             "urls":[{"label":"","url":"https://other.example.com"},
                     {"label":"Admin","url":"https://admin.example.com"},
                     {"label":"","url":"https://primary.example.com"}]}}]}]}]}"#,
    );

    let export = parse(&export, SourceFormat::OnePasswordPux, &Limits::default()).expect("parses");
    let item = export.items.first().expect("one item");

    assert_eq!(item.url.as_deref(), Some("https://primary.example.com"));
    let fields: Vec<(&str, &str)> = item
        .fields
        .iter()
        .map(|field| (field.label.as_str(), field.value.expose_secret()))
        .collect();
    assert_eq!(
        fields,
        vec![
            ("Website 2", "https://other.example.com"),
            ("Admin", "https://admin.example.com"),
        ]
    );
}

#[test]
fn the_same_item_uuid_in_two_vaults_gets_two_source_keys() {
    let item = r#"{"uuid":"sameuuid","categoryUuid":"003","overview":{"title":"Note"},"details":{"notesPlain":"a note"}}"#;
    let export = pux(&format!(
        r#"{{"accounts":[{{"attrs":{{"uuid":"account1"}},"vaults":[
            {{"attrs":{{"uuid":"vault1","name":"One"}},"items":[{item}]}},
            {{"attrs":{{"uuid":"vault2","name":"Two"}},"items":[{item}]}}]}}]}}"#
    ));

    let export = parse(&export, SourceFormat::OnePasswordPux, &Limits::default()).expect("parses");
    let keys: Vec<&str> = export
        .items
        .iter()
        .map(|item| item.source_key.as_str())
        .collect();

    assert_eq!(
        keys,
        vec!["account1:vault1:sameuuid", "account1:vault2:sameuuid"]
    );
}

#[test]
fn a_1password_vault_without_a_uuid_falls_back_to_item_positions() {
    let export = pux(
        r#"{"accounts":[{"attrs":{"uuid":"account1"},"vaults":[{"attrs":{"name":"Vault"},"items":[
            {"uuid":"item1","categoryUuid":"003","overview":{"title":"Note"},"details":{"notesPlain":"a note"}}]}]}]}"#,
    );

    let export = parse(&export, SourceFormat::OnePasswordPux, &Limits::default()).expect("parses");
    let keys: Vec<&str> = export
        .items
        .iter()
        .map(|item| item.source_key.as_str())
        .collect();

    assert_eq!(keys, vec!["item:1"]);
}

#[test]
fn a_concealed_hostname_stays_a_concealed_field_not_the_item_url() {
    let export = pux(
        r#"{"accounts":[{"attrs":{"uuid":"account1"},"vaults":[{"attrs":{"uuid":"vault1","name":"Vault"},"items":[
            {"uuid":"item1","categoryUuid":"001","overview":{"title":"Example"},
             "details":{"sections":[{"fields":[
                {"title":"Host","id":"hostname","value":{"concealed":"https://private.example.com/path"}}]}]}}]}]}]}"#,
    );

    let export = parse(&export, SourceFormat::OnePasswordPux, &Limits::default()).expect("parses");
    let item = export.items.first().expect("one item");

    assert_eq!(item.url, None);
    let fields: Vec<(&str, &str, bool)> = item
        .fields
        .iter()
        .map(|field| {
            (
                field.label.as_str(),
                field.value.expose_secret(),
                field.concealed,
            )
        })
        .collect();
    assert_eq!(
        fields,
        vec![("Host", "https://private.example.com/path", true)]
    );
}

#[test]
fn empty_1password_dates_are_not_counted_as_dropped() {
    let export = pux(
        r#"{"accounts":[{"attrs":{"uuid":"account1"},"vaults":[{"attrs":{"uuid":"vault1","name":"Vault"},"items":[
            {"uuid":"item1","categoryUuid":"002","overview":{"title":"Card"},
             "details":{"sections":[{"fields":[
                {"title":"Expires","id":"expiry","value":{"monthYear":null}},
                {"title":"Issued","id":"issued","value":{"date":null}}]}]}}]}]}]}"#,
    );

    let export = parse(&export, SourceFormat::OnePasswordPux, &Limits::default()).expect("parses");

    assert_eq!(export.items.len(), 1);
    assert!(export.dropped.is_empty());
    assert!(export.items[0].fields.is_empty());
}

#[test]
fn a_bitwarden_login_with_null_uris_keeps_its_credentials() {
    let json = r#"{"encrypted":false,"folders":[],"items":[
        {"id":"item1","type":1,"name":"Example","login":{"uris":null,"username":"user-one","password":"secret-one"}}]}"#;

    let export = parse(
        json.as_bytes(),
        SourceFormat::BitwardenJson,
        &Limits::default(),
    )
    .expect("parses");

    assert!(export.skipped.is_empty());
    let item = export.items.first().expect("one item");
    assert_eq!(item.username.expose_secret(), "user-one");
    assert_eq!(item.password.expose_secret(), "secret-one");
    assert_eq!(item.url, None);
}

#[test]
fn null_1password_lists_and_entries_read_as_empty() {
    let export = pux(r#"{"accounts":[{"attrs":{"uuid":"account1"},"vaults":[
            {"attrs":{"uuid":"vault0","name":"Empty"},"items":null},
            {"attrs":{"uuid":"vault1","name":"Vault"},"items":[
            {"uuid":"item1","categoryUuid":"001","overview":{"title":"Example","urls":null,"tags":[null,"tag-one"]},
             "details":{"loginFields":[null,{"designation":"username","value":"user-one"}],
                        "sections":[null,{"title":"Empty","fields":null}],"passwordHistory":null}}]}]}]}"#);

    let export = parse(&export, SourceFormat::OnePasswordPux, &Limits::default()).expect("parses");

    assert!(export.skipped.is_empty());
    let item = export.items.first().expect("one item");
    assert_eq!(item.username.expose_secret(), "user-one");
    let fields: Vec<(&str, &str)> = item
        .fields
        .iter()
        .map(|field| (field.label.as_str(), field.value.expose_secret()))
        .collect();
    assert_eq!(fields, vec![("Tags", "tag-one")]);
}

#[test]
fn null_bitwarden_fields_read_as_empty() {
    let json = r#"{"encrypted":false,"folders":null,"items":[
        {"id":"item1","type":2,"name":"Example","notes":"note-one","fields":null,"secureNote":{"type":0}}]}"#;

    let export = parse(
        json.as_bytes(),
        SourceFormat::BitwardenJson,
        &Limits::default(),
    )
    .expect("parses");

    assert!(export.skipped.is_empty());
    assert_eq!(export.items.len(), 1);
}

#[test]
fn a_bitwarden_csv_row_with_an_archived_date_is_skipped_as_archived() {
    let csv = "folder,favorite,type,name,notes,fields,reprompt,archivedDate,login_uri,login_username,login_password,login_totp\n\
               ,,login,Live,,,0,,https://live.example.com,user-one,secret-one,\n\
               ,,login,Old,,,0,2026-01-02T03:04:05.000Z,https://old.example.com,user-two,secret-two,\n";

    let export = parse(
        csv.as_bytes(),
        SourceFormat::BitwardenCsv,
        &Limits::default(),
    )
    .expect("parses");

    assert_eq!(export.items.len(), 1);
    assert_eq!(export.items[0].name, "Live");
    let skipped: Vec<_> = export
        .skipped
        .iter()
        .map(|skipped| skipped.reason)
        .collect();
    assert_eq!(skipped, vec![password_import::SkipReason::Archived]);
}

#[test]
fn a_bitwarden_item_with_one_collection_id_string_is_shared() {
    let json = r#"{"encrypted":false,"items":[
        {"id":"item1","type":2,"name":"Shared","collectionIds":"collection1"}]}"#;

    let export = parse(
        json.as_bytes(),
        SourceFormat::BitwardenJson,
        &Limits::default(),
    )
    .expect("parses");

    let skipped: Vec<_> = export
        .skipped
        .iter()
        .map(|skipped| skipped.reason)
        .collect();
    assert_eq!(skipped, vec![password_import::SkipReason::SharedCollection]);
}

#[test]
fn a_null_after_a_full_list_does_not_overflow_it() {
    let uris = vec![r#"{"uri":"https://example.com"}"#; 256].join(",");
    let json = format!(
        r#"{{"encrypted":false,"items":[{{"id":"item1","type":1,"name":"Example","login":{{"uris":[{uris},null],"username":"user-one"}}}}]}}"#
    );

    let export = parse(
        json.as_bytes(),
        SourceFormat::BitwardenJson,
        &Limits::default(),
    )
    .expect("parses");

    assert!(export.skipped.is_empty());
    assert_eq!(export.items.len(), 1);
}
