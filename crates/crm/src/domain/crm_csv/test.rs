use super::*;

#[test]
fn reads_a_companies_export() {
    let table = parse_csv(
        "\u{feff}\"Company\",\"Domains\",\"Stage\",\"Owner\",\"Revenue\"\r\n\
         \"Acme\",\"acme.com; acme.io\",\"Lead\",\"jane@macro.com\",\"\"\r\n\
         \"'=Formula\",\"https://www.formula.co/about\",\"\",\"\",\"\"\r\n\
         \"No domain\",\"\",\"Lead\",\"\",\"\"\r\n\
         \"Acme again\",\"ACME.com\",\"\",\"\",\"\"\r\n",
    )
    .unwrap();
    let rows = record_rows(&table, PipelineRecordType::Company).unwrap();
    assert_eq!(rows.skipped, 1);
    assert_eq!(rows.other_headers, ["Stage", "Owner", "Revenue"]);
    assert_eq!(
        rows.rows,
        [
            RecordRow {
                name: "Acme".into(),
                key: "acme.com".into(),
                values: vec![
                    ("Stage".into(), "Lead".into()),
                    ("Owner".into(), "jane@macro.com".into()),
                ],
            },
            RecordRow {
                name: "=Formula".into(),
                key: "formula.co".into(),
                values: vec![],
            },
            RecordRow {
                name: "Acme again".into(),
                key: "acme.com".into(),
                values: vec![],
            },
        ]
    );
    let companies: Vec<&str> = unique_companies(&rows.rows)
        .iter()
        .map(|row| row.name.as_str())
        .collect();
    assert_eq!(companies, ["Acme", "=Formula"]);
    let pipeline = company_pipeline_rows(&rows.rows);
    assert_eq!(pipeline.len(), 1);
    assert_eq!(pipeline[0].key, "acme.com");
}

#[test]
fn names_contacts_by_email() {
    let table = parse_csv(
        "Contact,Email,Stage\nJane,JANE@Acme.com,Demo\n,raj@beta.io,\nBad,not-an-email,Lead\n",
    )
    .unwrap();
    let rows = record_rows(&table, PipelineRecordType::Contact).unwrap();
    assert_eq!(rows.skipped, 1);
    assert_eq!(
        rows.rows
            .iter()
            .map(|row| (row.name.as_str(), row.key.as_str()))
            .collect::<Vec<_>>(),
        [("Jane", "jane@acme.com"), ("raj@beta.io", "raj@beta.io")]
    );
}

#[test]
fn needs_the_column_that_names_each_record() {
    let table = parse_csv("Company,Stage\nAcme,Lead\n").unwrap();
    assert!(matches!(
        record_rows(&table, PipelineRecordType::Company),
        Err(CsvError::Invalid(message)) if message.contains("Domain column")
    ));
}

#[test]
fn round_trips_an_export() {
    let headers = vec![
        "Company".to_owned(),
        "Domain".to_owned(),
        "Notes".to_owned(),
    ];
    let rows = vec![vec![
        " =SUM(A1)".to_owned(),
        "acme.com".to_owned(),
        "said \"hi\", twice".to_owned(),
    ]];
    let text = encode_csv(&headers, &rows);
    assert_eq!(
        text,
        "Company,Domain,Notes\n' =SUM(A1),acme.com,\"said \"\"hi\"\", twice\"\n"
    );
    let table = parse_csv(&text).unwrap();
    let rows = record_rows(&table, PipelineRecordType::Company).unwrap();
    assert_eq!(rows.rows[0].name, "=SUM(A1)");
    assert_eq!(
        rows.rows[0].values,
        [("Notes".to_owned(), "said \"hi\", twice".to_owned())]
    );
}

#[test]
fn refuses_files_beyond_the_row_limit() {
    let text = format!(
        "Domain\n{}",
        (0..=MAX_CSV_ROWS)
            .map(|i| format!("c{i}.com\n"))
            .collect::<String>()
    );
    assert!(
        matches!(parse_csv(&text), Err(CsvError::Invalid(message)) if message.contains("10000"))
    );
}

#[test]
fn accepts_only_bare_domains() {
    assert_eq!(
        imported_domain("Mail.Acme.co.uk"),
        Some("mail.acme.co.uk".into())
    );
    assert_eq!(imported_domain("jane@acme.com"), Some("acme.com".into()));
    assert_eq!(imported_domain("localhost"), None);
    assert_eq!(imported_domain("-acme.com"), None);
    assert_eq!(imported_domain("acme.c0m"), None);
}
