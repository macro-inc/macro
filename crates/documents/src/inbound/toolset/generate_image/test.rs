use super::*;
use ai_toolset::schema::generate_validated_input_schema;

#[test]
fn schema_is_valid_and_optional_fields_default() {
    let schema = generate_validated_input_schema::<GenerateImage>().unwrap();
    assert_eq!(schema.name, "GenerateImage");
    let tool: GenerateImage = serde_json::from_value(serde_json::json!({
        "prompt": "a lighthouse at dusk", "fileName": "lighthouse"
    }))
    .unwrap();
    assert!(tool.aspect_ratio.is_none());
    assert!(tool.project_id.is_none());

    let tool: GenerateImage = serde_json::from_value(serde_json::json!({
        "prompt": "a lighthouse at dusk", "fileName": "lighthouse", "aspectRatio": "widescreen"
    }))
    .unwrap();
    assert_eq!(
        tool.aspect_ratio.map(ImageAspectRatio::from),
        Some(ImageAspectRatio::Widescreen)
    );
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
        description(DocumentError::BadRequest("prompt must not be empty".to_string()).into()),
        "prompt must not be empty"
    );
    assert_eq!(
        description(DocumentError::Unauthorized.into()),
        "you need edit access to the destination project"
    );
    assert_eq!(
        description(DocumentError::Gone.into()),
        "the image was generated but could not be saved to Macro"
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
