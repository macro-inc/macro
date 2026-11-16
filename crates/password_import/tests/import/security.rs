//! Regressions for the security review: memory and work stay bounded by
//! counts, hidden values stay hidden, and the archive is read one way only.
use password_import::{ImportError, Limits, ParsedExport, SkipReason, SourceFormat, detect, parse};

use super::support::zip;

fn pux(export_data: &str) -> Vec<u8> {
    zip(&[("export.data", export_data.as_bytes().to_vec())])
}

/// One 1Password account and vault holding `item`.
fn pux_with_item(item: &str) -> Vec<u8> {
    pux(&format!(
        r#"{{"accounts":[{{"attrs":{{"name":"Account"}},"vaults":[{{"attrs":{{"name":"Vault"}},"items":[{item}]}}]}}]}}"#
    ))
}

fn only_skip_reason(export: &ParsedExport) -> Option<SkipReason> {
    assert!(export.items.is_empty(), "expected no imported items");
    match export.skipped.as_slice() {
        [skipped] => Some(skipped.reason),
        _ => None,
    }
}

fn repeated(entry: &str, count: usize) -> String {
    vec![entry; count].join(",")
}

fn small_items(max_items: usize) -> Limits {
    Limits {
        max_items,
        ..Limits::default()
    }
}

// M1: lists are counted before anything is kept.

#[test]
fn empty_vaults_count_toward_the_item_limit() {
    let export = |vaults: usize| {
        pux(&format!(
            r#"{{"accounts":[{{"vaults":[{}]}}]}}"#,
            repeated("{}", vaults)
        ))
    };

    // One account plus nine vaults is ten entries.
    assert!(parse(&export(9), SourceFormat::OnePasswordPux, &small_items(10)).is_ok());
    assert_eq!(
        parse(&export(10), SourceFormat::OnePasswordPux, &small_items(10)).err(),
        Some(ImportError::TooManyItems)
    );
}

#[test]
fn bare_values_in_a_vault_count_toward_the_item_limit() {
    let export = pux(&format!(
        r#"{{"accounts":[{{"vaults":[{{"items":[{}]}}]}}]}}"#,
        repeated("0", 100)
    ));

    assert_eq!(
        parse(&export, SourceFormat::OnePasswordPux, &small_items(50)).err(),
        Some(ImportError::TooManyItems)
    );
}

#[test]
fn bitwarden_folders_count_toward_the_item_limit() {
    let export = format!(
        r#"{{"encrypted":false,"folders":[{}],"items":[]}}"#,
        repeated("{}", 3)
    );

    assert!(
        parse(
            export.as_bytes(),
            SourceFormat::BitwardenJson,
            &small_items(3)
        )
        .is_ok()
    );
    assert_eq!(
        parse(
            export.as_bytes(),
            SourceFormat::BitwardenJson,
            &small_items(2)
        )
        .err(),
        Some(ImportError::TooManyItems)
    );
}

#[test]
fn a_per_item_list_past_its_cap_skips_the_item() {
    let login = |fields: usize| {
        pux_with_item(&format!(
            r#"{{"uuid":"item1","categoryUuid":"001","overview":{{"title":"Example"}},"details":{{"loginFields":[{}]}}}}"#,
            repeated("{}", fields)
        ))
    };

    // Value-less login fields are left out, so 256 of them import nothing.
    let at_cap = parse(
        &login(256),
        SourceFormat::OnePasswordPux,
        &Limits::default(),
    )
    .expect("parses");
    assert_eq!(at_cap.items.len(), 1);

    let over_cap = parse(
        &login(257),
        SourceFormat::OnePasswordPux,
        &Limits::default(),
    )
    .expect("parses");
    assert_eq!(only_skip_reason(&over_cap), Some(SkipReason::TooLarge));
}

#[test]
fn bitwarden_fields_and_uris_past_their_cap_skip_the_item() {
    let item = |fields: usize, uris: usize| {
        format!(
            r#"{{"items":[{{"id":"item1","type":1,"name":"Example","fields":[{}],"login":{{"uris":[{}]}}}}]}}"#,
            repeated(r#"{"type":0}"#, fields),
            repeated("{}", uris)
        )
    };

    for (fields, uris) in [(257, 0), (0, 257)] {
        let export = parse(
            item(fields, uris).as_bytes(),
            SourceFormat::BitwardenJson,
            &Limits::default(),
        )
        .expect("parses");
        assert_eq!(only_skip_reason(&export), Some(SkipReason::TooLarge));
    }
}

#[test]
fn only_the_first_key_of_a_section_value_is_read() {
    let item = format!(
        r#"{{"uuid":"item1","categoryUuid":"003","overview":{{"title":"Note"}},"details":{{"sections":[{{"fields":[{{"title":"Code","id":"code","value":{{"string":"1234",{}}}}}]}}]}}}}"#,
        (0..1000)
            .map(|number| format!(r#""extra{number}":0"#))
            .collect::<Vec<_>>()
            .join(",")
    );

    let export = parse(
        &pux_with_item(&item),
        SourceFormat::OnePasswordPux,
        &Limits::default(),
    )
    .expect("parses");
    let fields: Vec<&str> = export
        .items
        .iter()
        .flat_map(|item| &item.fields)
        .map(|field| field.value.expose_secret())
        .collect();
    assert_eq!(fields, vec!["1234"]);
}

#[test]
fn a_csv_record_wider_than_any_export_is_refused() {
    let header = "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes";
    let row = |cells: usize| format!("{header}\n{}\n", vec!["x"; cells].join(","));

    assert!(
        parse(
            row(256).as_bytes(),
            SourceFormat::OnePasswordCsv,
            &Limits::default()
        )
        .is_ok()
    );
    assert_eq!(
        parse(
            row(257).as_bytes(),
            SourceFormat::OnePasswordCsv,
            &Limits::default()
        )
        .err(),
        Some(ImportError::InvalidCsv { row: 2 })
    );
}

// M2: URLs past what the vault could keep aren't compared.

#[test]
fn a_bitwarden_row_with_many_urls_is_too_large() {
    let header = "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp";
    let uris = (0..100_000)
        .map(|number| format!("https://h{number}.example.com"))
        .collect::<Vec<_>>()
        .join(",");
    let csv = format!("{header}\n,,login,Example,,,0,\"{uris}\",user-one,,\n");

    let export = parse(
        csv.as_bytes(),
        SourceFormat::BitwardenCsv,
        &Limits::default(),
    )
    .expect("parses");
    assert_eq!(only_skip_reason(&export), Some(SkipReason::TooLarge));
}

// M3: the column count is bounded, and short rows cost nothing per column.

#[test]
fn a_header_wider_than_any_export_is_refused() {
    let extra: String = (0..300).map(|number| format!(",Extra {number}")).collect();
    let csv = format!("Title,Url,Username,Password{extra}\nExample\n");

    assert_eq!(
        parse(
            csv.as_bytes(),
            SourceFormat::OnePasswordCsv,
            &Limits::default()
        )
        .err(),
        Some(ImportError::InvalidCsv { row: 1 })
    );
    assert_eq!(
        detect(csv.as_bytes(), &Limits::default()),
        Err(ImportError::UnknownFormat)
    );
}

// M4: a URL carrying credentials stays concealed.

#[test]
fn a_url_with_credentials_becomes_a_concealed_field() {
    let csv = "Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\n\
               Bank,https://user-one:not-a-real-password@bank.example/,user-one,pw,,false,false,,\n";

    let export = parse(
        csv.as_bytes(),
        SourceFormat::OnePasswordCsv,
        &Limits::default(),
    )
    .expect("parses");
    let item = export.items.first().expect("one item");
    assert_eq!(item.url, None);
    let website = item.fields.first().expect("the URL as a field");
    assert_eq!(website.label, "Website");
    assert!(website.concealed);
}

#[test]
fn a_concealed_section_url_stays_concealed() {
    let item = r#"{"uuid":"item1","categoryUuid":"110","overview":{"title":"Server"},"details":{"sections":[{"fields":[{"title":"Server","id":"url","value":{"concealed":"hidden.example"}}]}]}}"#;

    let export = parse(
        &pux_with_item(item),
        SourceFormat::OnePasswordPux,
        &Limits::default(),
    )
    .expect("parses");
    let field = export
        .items
        .first()
        .and_then(|item| item.fields.first())
        .expect("the hostname as a field");
    assert!(field.concealed);
}

// L1, L2: one name per entry, so the entry count is real and `export.data`
// is the one any other tool reads.

#[test]
fn duplicate_entry_names_are_refused() {
    let mut archive = zip(&[
        ("export.data", br#"{"accounts":[]}"#.to_vec()),
        ("export.dat2", br#"{"accounts":[]}"#.to_vec()),
    ]);
    replace_all(&mut archive, b"export.dat2", b"export.data");

    assert_eq!(
        parse(&archive, SourceFormat::OnePasswordPux, &Limits::default()).err(),
        Some(ImportError::InvalidZip)
    );
    assert_eq!(
        detect(&archive, &Limits::default()),
        Err(ImportError::InvalidZip)
    );
}

fn replace_all(bytes: &mut [u8], from: &[u8], to: &[u8]) {
    let mut start = 0;
    while let Some(offset) = bytes
        .get(start..)
        .and_then(|rest| rest.windows(from.len()).position(|window| window == from))
    {
        let at = start + offset;
        if let Some(target) = bytes.get_mut(at..at + to.len()) {
            target.copy_from_slice(to);
        }
        start = at + to.len();
    }
}

// L3: a byte order mark is accepted everywhere detect accepts it.

#[test]
fn json_with_a_byte_order_mark_parses() {
    let bitwarden = b"\xEF\xBB\xBF{\"encrypted\":false,\"items\":[]}";
    assert_eq!(
        detect(bitwarden, &Limits::default()),
        Ok(SourceFormat::BitwardenJson)
    );
    assert!(parse(bitwarden, SourceFormat::BitwardenJson, &Limits::default()).is_ok());

    let one_password = zip(&[("export.data", b"\xEF\xBB\xBF{\"accounts\":[]}".to_vec())]);
    assert!(
        parse(
            &one_password,
            SourceFormat::OnePasswordPux,
            &Limits::default()
        )
        .is_ok()
    );
}

// L4: an item the vault would accept field by field but not in one request.

#[test]
fn an_item_over_the_write_size_is_too_large() {
    let field = format!(
        r#"{{"name":"Key","value":"{}","type":1}}"#,
        "k".repeat(65_536)
    );
    let item = |fields: usize| {
        format!(
            r#"{{"items":[{{"id":"item1","type":2,"name":"Keys","fields":[{}]}}]}}"#,
            repeated(&field, fields)
        )
    };

    let fits = parse(
        item(15).as_bytes(),
        SourceFormat::BitwardenJson,
        &Limits::default(),
    )
    .expect("parses");
    assert_eq!(fits.items.len(), 1);

    let too_large = parse(
        item(16).as_bytes(),
        SourceFormat::BitwardenJson,
        &Limits::default(),
    )
    .expect("parses");
    assert_eq!(only_skip_reason(&too_large), Some(SkipReason::TooLarge));
}

// Folder depth: every ancestor becomes a folder, so depth is capped.

#[test]
fn a_folder_deeper_than_the_cap_skips_the_item() {
    let export = |depth: usize| {
        format!(
            r#"{{"folders":[{{"id":"f1","name":"{}"}}],"items":[{{"id":"item1","type":2,"name":"Note","notes":"a note","folderId":"f1"}}]}}"#,
            vec!["a"; depth].join("/")
        )
    };

    let at_cap = parse(
        export(password_import::FolderPath::MAX_DEPTH).as_bytes(),
        SourceFormat::BitwardenJson,
        &Limits::default(),
    )
    .expect("parses");
    assert_eq!(at_cap.folders.len(), password_import::FolderPath::MAX_DEPTH);

    let too_deep = parse(
        export(10_000).as_bytes(),
        SourceFormat::BitwardenJson,
        &Limits::default(),
    )
    .expect("parses");
    assert_eq!(only_skip_reason(&too_deep), Some(SkipReason::TooLarge));
    assert!(too_deep.folders.is_empty());
}
