use super::tool::*;
use ai::generate_tool_input_schema;
use ai::tool::types::toolset::tool_object::validate_tool_schema;
use cool_asserts::assert_matches;
use email::inbound::ApiPaginatedThreadCursor;
use models_email::service::thread::PreviewViewStandardLabel;

// run `cargo test -p ai_tools list::email::tests::print_input_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the input schema"]
fn print_input_schema() {
    let schema = generate_tool_input_schema!(ListEmails);
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

// run `cargo test -p ai_tools list::email::tests::print_output_schema -- --nocapture --include-ignored`
#[test]
#[ignore = "prints the output schema"]
fn print_output_schema() {
    let generator = ai::tool::minimized_output_schema_generator();
    let schema = generator.into_root_schema_for::<ApiPaginatedThreadCursor>();
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}

#[test]
fn test_list_emails_schema_validation() {
    let schema = generate_tool_input_schema!(ListEmails);

    // Test using the actual validate_tool_schema function
    let result = validate_tool_schema(&schema);
    assert!(result.is_ok(), "{:?}", result);

    let (name, ..) = result.unwrap();
    assert_eq!(
        name, "ListEmails",
        "Tool name should match the schemars title"
    );
}

#[test]
fn it_iterates_defaults() {
    let data = ListEmails {
        view: ViewSelection::default(),
        limit: default_limit(),
        cursor: None,
        sort_method: default_sort_method(),
    };
    let params: Vec<_> = data.iter_params().collect();
    assert_matches!(params, [("limit", l), ("sort_method", s)] => {
        assert_eq!(l, "20");
        assert_eq!(s, "viewed_at");
    });
}

#[test]
fn it_iterates_limit() {
    let data = ListEmails {
        view: ViewSelection::default(),
        limit: 420,
        cursor: None,
        sort_method: default_sort_method(),
    };
    let params: Vec<_> = data.iter_params().collect();
    assert_matches!(params, [("limit", l), ("sort_method", s)] => {
        assert_eq!(l, "420");
        assert_eq!(s, "viewed_at");
    });
}

#[test]
fn it_iterates_cursor() {
    let data = ListEmails {
        view: ViewSelection::default(),
        limit: default_limit(),
        cursor: Some("some_cursor".to_string()),
        sort_method: default_sort_method(),
    };
    let params: Vec<_> = data.iter_params().collect();
    assert_matches!(params, [("limit", l), ("cursor", c), ("sort_method", s)] => {
        assert_eq!(l, "20");
        assert_eq!(c, "some_cursor");
        assert_eq!(s, "viewed_at");
    });
}

#[test]
fn it_iterates_sort() {
    let data = ListEmails {
        view: ViewSelection::default(),
        limit: default_limit(),
        cursor: None,
        sort_method: ApiSortMethod::CreatedAt,
    };
    let params: Vec<_> = data.iter_params().collect();
    assert_matches!(params, [("limit", l), ("sort_method", s)] => {
        assert_eq!(l, "20");
        assert_eq!(s, "created_at");
    });
}

#[test]
fn it_iterates_all() {
    let data = ListEmails {
        view: ViewSelection {
            standard_label: Some(PreviewViewStandardLabel::Inbox),
            user_label: None,
        },
        limit: 420,
        cursor: Some("some_cursor".to_string()),
        sort_method: ApiSortMethod::CreatedAt,
    };
    let params: Vec<_> = data.iter_params().collect();
    assert_matches!(params, [("limit", l), ("cursor", c), ("sort_method", s)] => {
        assert_eq!(l, "420");
        assert_eq!(c, "some_cursor");
        assert_eq!(s, "created_at");
    });
}
