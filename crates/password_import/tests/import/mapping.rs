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
