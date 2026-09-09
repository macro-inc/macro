use super::*;

#[test]
fn standard_form_preserves_nested_draft_and_applies_flat_edits() {
    let draft = json!({"subject":"Original", "recipients":[{"email":"a@example.com"}]});
    let schema = json!({"type":"object", "properties":{
        "subject":{"type":"string"}, "recipients":{"type":"array"}
    }});
    let form =
        serde_json::to_value(project_form(schema.as_object().unwrap(), &draft).unwrap()).unwrap();
    assert_eq!(form["properties"]["subject"]["default"], "Original");
    assert_eq!(form["properties"]["draft"]["type"], "string");
    assert!(form["properties"].get("recipients").is_none());
    assert!(form["properties"]["draft"].get("default").is_none());
    let edited = apply_review(&draft, &json!({"subject":"Edited", "draft":""})).unwrap();
    assert_eq!(edited["subject"], "Edited");
    assert_eq!(edited["recipients"], draft["recipients"]);
}

#[test]
fn composer_replacement_wins_over_prepopulated_flat_fields() {
    let edited = json!({"subject":"Composer", "recipients":[]});
    assert_eq!(
        apply_review(
            &json!({"subject":"Original"}),
            &json!({
                "subject":"Original", "draft":edited.to_string()
            })
        )
        .unwrap(),
        edited
    );
}

#[test]
fn malformed_accepted_content_never_falls_back_to_original() {
    for content in [
        json!(null),
        json!({"draft":{}}),
        json!({"draft":"broken"}),
        json!({"draft":"[]"}),
    ] {
        assert!(apply_review(&json!({"subject":"Original"}), &content).is_err());
    }
}

#[test]
fn email_forms_render_markdown_and_preserve_explicit_composer_html() {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let draft = json!({"body":"**Hello**"});
    let generic = reviewed_arguments("SendEmail", &draft, &json!({})).unwrap();
    let html = String::from_utf8(
        URL_SAFE_NO_PAD
            .decode(generic["body"].as_str().unwrap())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(html, "<p><strong>Hello</strong></p>\n");
    let encoded = URL_SAFE_NO_PAD.encode("<p>Edited in composer</p>");
    let composer = reviewed_arguments(
        "SendEmail",
        &draft,
        &json!({"draft":json!({"body":encoded}).to_string(),"bodyFormat":"base64url_html"}),
    )
    .unwrap();
    assert_eq!(composer["body"], encoded);
    assert!(
        reviewed_arguments("SendEmail", &draft, &json!({"bodyFormat":"base64url_html"})).is_err()
    );
    assert!(reviewed_arguments("SendEmail", &draft, &json!({"bodyFormat":"unknown"})).is_err());
}
