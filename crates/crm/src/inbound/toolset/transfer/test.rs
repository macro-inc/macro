use ai_toolset::schema::generate_validated_input_schema;

use super::*;

#[test]
fn every_csv_tool_schema_is_valid_for_strict_tool_use() {
    for (name, validated) in [
        (
            "ImportCompaniesCsv",
            generate_validated_input_schema::<ImportCompaniesCsv>(),
        ),
        (
            "ImportPipelineCsv",
            generate_validated_input_schema::<ImportPipelineCsv>(),
        ),
        (
            "ExportPipelineCsv",
            generate_validated_input_schema::<ExportPipelineCsv>(),
        ),
    ] {
        let validated = validated.unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(validated.name, name);
        // The deferred-tool catalog shows only the first sentence.
        let first = validated.description.split(". ").next().unwrap_or_default();
        assert!(first.contains("CSV"), "{name}: {first}");
    }
}

#[test]
fn a_csv_comes_as_text_or_a_file_but_not_both() {
    let file = Uuid::now_v7();
    assert_eq!(
        csv_input(&Some("Domain\nacme.com".into()), None).unwrap(),
        CsvInput::Text("Domain\nacme.com".into())
    );
    assert_eq!(csv_input(&None, Some(file)).unwrap(), CsvInput::File(file));
    assert!(csv_input(&None, None).is_err());
    assert!(csv_input(&Some(String::new()), Some(file)).is_err());
}
