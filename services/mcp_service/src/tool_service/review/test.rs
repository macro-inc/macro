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

#[test]
fn email_form_is_readable_and_only_shows_relevant_fields() {
    let draft = json!({"to":[{"email":"wolf@example.com","name":"Wolf"}],
        "subject":"Frogs","body":"Hello\n\nFrogs!","cc":[],"includeSignature":null});
    let form = serde_json::to_value(email_form(&draft).unwrap()).unwrap();
    let fields = form["properties"].as_object().unwrap();
    assert_eq!(
        fields.keys().map(String::as_str).collect::<Vec<_>>(),
        ["replacementBody", "subject", "to"]
    );
    assert_eq!(fields["to"]["default"], "wolf@example.com");
    assert!(fields["replacementBody"].get("default").is_none());
    assert!(!fields.contains_key("body"));
    assert_eq!(
        email_message(&draft),
        "Send this email?\n\nTo: wolf@example.com\nSubject: Frogs\n\nHello\n\nFrogs!"
    );
    let form = serde_json::to_value(
        email_form(&json!({
            "to":[],"bcc":[{"email":"private@example.com"}],
            "includeSignature":false,"replyingToId":"message-id"
        }))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(form["properties"]["bcc"]["default"], "private@example.com");
    assert_eq!(form["properties"]["includeSignature"]["default"], false);
    assert_eq!(form["properties"]["replyingToId"]["default"], "message-id");
}

#[test]
fn email_address_edits_preserve_names_clear_cc_and_reject_invalid_input() {
    let draft = json!({"body":"Hello", "to":[{"email":"wolf@example.com","name":"Wolf"}],
        "cc":[{"email":"old@example.com"}]});
    let edited = reviewed_arguments(
        "SendEmail",
        &draft,
        &json!({
            "to":"wolf@example.com, new@example.com", "cc":""
        }),
    )
    .unwrap();
    assert_eq!(
        edited["to"],
        json!([{"email":"wolf@example.com","name":"Wolf"},{"email":"new@example.com"}])
    );
    assert_eq!(edited["cc"], json!([]));
    for invalid in [
        json!(""),
        json!("not-an-address"),
        json!("a@example.com\nBcc:x@example.com"),
        json!(42),
    ] {
        assert!(reviewed_arguments("SendEmail", &draft, &json!({"to":invalid})).is_err());
    }
    // Composer JSON replaces the whole draft, even when other fields were prefilled.
    let edited = reviewed_arguments("SendEmail", &draft, &json!({
        "to":"not-an-address", "draft":json!({"body":"Edited","to":[{"email":"composer@example.com"}]}).to_string()
    })).unwrap();
    assert_eq!(edited["to"], json!([{"email":"composer@example.com"}]));
}

#[test]
fn optional_replacement_body_keeps_or_replaces_the_previewed_message() {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let draft = json!({"body":"Original\n\nmessage"});
    for (content, expected) in [
        (json!({}), "<p>Original</p>\n<p>message</p>\n"),
        (
            json!({"replacementBody":"  "}),
            "<p>Original</p>\n<p>message</p>\n",
        ),
        (
            json!({"replacementBody":"**Edited**"}),
            "<p><strong>Edited</strong></p>\n",
        ),
    ] {
        let result = reviewed_arguments("SendEmail", &draft, &content).unwrap();
        let body = URL_SAFE_NO_PAD
            .decode(result["body"].as_str().unwrap())
            .unwrap();
        assert_eq!(String::from_utf8(body).unwrap(), expected);
        assert!(result.get("replacementBody").is_none());
    }
    assert!(reviewed_arguments("SendEmail", &draft, &json!({"replacementBody":42})).is_err());
}
