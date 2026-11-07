use super::*;
use model_entity::EntityType;
use non_empty::NonEmpty;

fn to_text(parts: FormattedParts) -> String {
    parts
        .into_parts()
        .into_inner()
        .into_iter()
        .filter_map(|p| match p {
            TextOrImage::Text(t) => Some(t),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn make_error() -> AttachmentError {
    AttachmentError::PermissionDenied(Box::new(std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "User does not have access to the requested resource",
    )))
}

fn make_resolution_error() -> ResolutionError {
    ResolutionError::new(
        EntityType::Document.with_entity_string("019dd0ff-d8ee-7dc0-8580-e0ad1e706967".to_string()),
        make_error(),
    )
}

#[test]
fn successful_attachment_content() {
    let content = AttachmentContent {
        reference: EntityType::Document.with_entity_string("abc123".to_string()),
        name: Some("Test Doc".to_string()),
        content: NonEmpty::new(vec![AttachmentPart::Content("Hello world".to_string())]).unwrap(),
    };
    let output = to_text(content.into_formatted_parts());
    assert!(output.contains("kind=document"), "should have kind");
    assert!(output.contains("id=abc123"), "should have id");
    assert!(output.contains("Hello world"), "should have content");
}

#[test]
fn resolution_error_uses_attachment_tag() {
    let output = to_text(make_resolution_error().into_formatted_parts());
    println!("=== resolution_error ===\n{output}\n");
    assert!(
        output.contains("<attachment "),
        "errors should use <attachment> tag"
    );
    assert!(
        !output.contains("unavailable_attachment"),
        "should NOT use nested unavailable_attachment tag"
    );
    assert!(output.contains("kind=document"), "should have entity kind");
    assert!(output.contains("id=019dd0ff"), "should have entity id");
}

#[test]
fn attachment_with_child_error() {
    let content = AttachmentContent {
        reference: EntityType::Document.with_entity_string("parent-doc".to_string()),
        name: Some("Parent".to_string()),
        content: NonEmpty::new(vec![
            AttachmentPart::Content("Some text".to_string()),
            AttachmentPart::Child(Box::new(Err(make_resolution_error()))),
        ])
        .unwrap(),
    };
    let output = to_text(content.into_formatted_parts());
    println!("=== attachment_with_child_error ===\n{output}\n");
    assert!(
        output.contains("  Some text"),
        "body should be indented once"
    );
    assert!(
        output.contains("    User does not have access"),
        "nested error body should be double-indented"
    );
}

#[test]
fn mixed_success_and_failure() {
    let attachments = Attachments::new(
        NonEmpty::new(vec![
            Ok(AttachmentContent {
                reference: EntityType::Document.with_entity_string("doc-1".to_string()),
                name: Some("Good Doc".to_string()),
                content: NonEmpty::new(vec![AttachmentPart::Content(
                    "Document content here".to_string(),
                )])
                .unwrap(),
            }),
            Err(make_resolution_error()),
        ])
        .unwrap(),
    );
    let output = to_text(attachments.into_formatted_parts());
    println!("=== mixed_success_and_failure ===\n{output}\n");
}

#[test]
fn xml_tag_produces_single_text_part() {
    let content = AttachmentContent {
        reference: EntityType::Document.with_entity_string("abc123".to_string()),
        name: Some("Test Doc".to_string()),
        content: NonEmpty::new(vec![AttachmentPart::Content("Hello world".to_string())]).unwrap(),
    };
    let parts: Vec<_> = content.into_formatted_parts().into_parts().into_inner();
    assert_eq!(
        parts.len(),
        1,
        "XmlTag should produce a single compacted Text part"
    );
}
