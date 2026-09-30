use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn schema_is_valid_and_optional_fields_default() {
    let schema = generate_validated_input_schema::<GenerateImage>().unwrap();
    assert_eq!(schema.name, "GenerateImage");
    let tool: GenerateImage = serde_json::from_value(serde_json::json!({
        "prompt": "a lighthouse at dusk"
    }))
    .unwrap();
    assert!(tool.file_name.is_none());
    assert!(tool.aspect_ratio.is_none());
    assert!(tool.project_id.is_none());
    assert!(tool.reference_images.is_none());

    let tool: GenerateImage = serde_json::from_value(serde_json::json!({
        "prompt": "a lighthouse at dusk", "fileName": "lighthouse", "aspectRatio": "widescreen"
    }))
    .unwrap();
    assert_eq!(tool.file_name.as_deref(), Some("lighthouse"));
    assert_eq!(
        tool.aspect_ratio.map(ImageAspectRatio::from),
        Some(ImageAspectRatio::Widescreen)
    );
}

#[test]
fn omitted_and_null_references_both_mean_text_only_generation() {
    for input in [
        serde_json::json!({ "prompt": "a lighthouse at dusk" }),
        serde_json::json!({ "prompt": "a lighthouse at dusk", "referenceImages": null }),
    ] {
        let tool: GenerateImage = serde_json::from_value(input).unwrap();
        assert!(tool.reference_images.is_none());
    }
}

#[test]
fn an_empty_reference_array_is_valid_and_contains_no_source_images() {
    let tool: GenerateImage = serde_json::from_value(serde_json::json!({
        "prompt": "a lighthouse at dusk", "referenceImages": []
    }))
    .unwrap();
    assert!(tool.reference_images.as_ref().is_some_and(Vec::is_empty));
    assert!(tool.reference_images.into_iter().flatten().next().is_none());
}

#[test]
fn reference_inputs_preserve_typed_identifiers_and_order() {
    let document_id = uuid::Uuid::from_u128(0x123);
    let static_file_id = uuid::Uuid::from_u128(0x456);
    let tool: GenerateImage = serde_json::from_value(serde_json::json!({
        "prompt": "edit the first photo using the second",
        "referenceImages": [
            { "type": "document", "id": document_id },
            { "type": "staticFile", "id": static_file_id },
        ]
    }))
    .unwrap();

    assert_eq!(
        tool.reference_images
            .into_iter()
            .flatten()
            .map(ImageReference::from)
            .collect::<Vec<_>>(),
        [
            ImageReference::Document(document_id),
            ImageReference::StaticFile(static_file_id)
        ]
    );
}

#[test]
fn reference_inputs_reject_unknown_sources_and_invalid_identifiers() {
    for reference in [
        serde_json::json!({ "type": "url", "id": uuid::Uuid::from_u128(0x123) }),
        serde_json::json!({ "type": "document", "id": "not-a-uuid" }),
        serde_json::json!({ "type": "staticFile", "id": "https://host/file/image" }),
        serde_json::json!({ "type": "document" }),
    ] {
        assert!(
            serde_json::from_value::<GenerateImage>(serde_json::json!({
                "prompt": "edit this photo", "referenceImages": [reference]
            }))
            .is_err()
        );
    }
}

#[test]
fn every_aspect_ratio_maps_to_a_provider_ratio() {
    for (name, ratio) in [
        ("square", "1:1"),
        ("landscape", "4:3"),
        ("portrait", "3:4"),
        ("widescreen", "16:9"),
        ("tall", "9:16"),
    ] {
        let aspect: AspectRatio = serde_json::from_value(serde_json::json!(name)).unwrap();
        assert_eq!(ImageAspectRatio::from(aspect).as_ratio(), ratio);
    }
}

#[test]
fn errors_describe_what_the_agent_can_do_about_them() {
    let description = |error: GenerateImageError| generate_error(error).description;
    assert_eq!(
        description(ImageGenerationError::Unavailable.into()),
        "image generation is not available in this workspace"
    );
    assert_eq!(
        description(ImageGenerationError::Refused("only text".to_string()).into()),
        "the image model did not return an image: only text"
    );
    assert_eq!(
        description(ImageGenerationError::Provider(anyhow::anyhow!("HTTP 429")).into()),
        "the image model request failed; try again shortly"
    );
    assert_eq!(
        description(GenerateImageError::BadRequest(
            "prompt must not be empty".to_string()
        )),
        "prompt must not be empty"
    );
    assert_eq!(
        description(SaveImageError::Unauthorized.into()),
        "you need edit access to the destination project"
    );
    assert_eq!(
        description(SaveImageError::Internal(rootcause::report!("save failed")).into()),
        "the image was generated but could not be saved to Macro"
    );
    for error in [
        ReadImageError::Unavailable,
        ReadImageError::Unauthorized,
        ReadImageError::NotImage,
    ] {
        let expected = error.to_string();
        assert_eq!(description(error.into()), expected);
    }
    assert_eq!(
        description(ReadImageError::Internal(rootcause::report!("private storage detail")).into()),
        "could not read a reference image; check its ID and access, then retry"
    );
}

#[test]
fn response_omits_an_absent_note() {
    let json = serde_json::to_value(GenerateImageResponse {
        document_id: "doc".to_string(),
        file_name: "lighthouse.png".to_string(),
        mime_type: "image/png".to_string(),
        size_bytes: 3,
        note: None,
    })
    .unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "documentId": "doc",
            "fileName": "lighthouse.png",
            "mimeType": "image/png",
            "sizeBytes": 3
        })
    );
}
