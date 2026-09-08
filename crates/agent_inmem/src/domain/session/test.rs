use agent_client_protocol::schema::v1::{ContentBlock, ResourceLink, TextContent};
use attachment::AttachmentPart;
use attachment::image::ImageData;

use super::*;

fn link(name: &str, uri: &str, mime: Option<&str>) -> ContentBlock {
    ContentBlock::ResourceLink(ResourceLink::new(name, uri).mime_type(mime.map(str::to_owned)))
}

#[test]
fn a_prompt_reads_its_text_and_its_file_links_off_the_blocks() {
    let prompt = UserPrompt::from_blocks(&[
        ContentBlock::Text(TextContent::new("what is ")),
        link("a.png", "https://x/file/1", Some("image/png")),
        ContentBlock::Text(TextContent::new("this?")),
        link("b.txt", "https://x/file/2", None),
    ]);
    assert_eq!(prompt.text, "what is this?");
    assert_eq!(prompt.attachments.len(), 2);
    assert_eq!(prompt.attachments[0].name, "a.png");
    assert_eq!(prompt.attachments[1].uri, "https://x/file/2");
}

#[test]
fn images_become_image_urls_and_other_files_are_named_to_the_model() {
    let prompt = UserPrompt::from_blocks(&[
        ContentBlock::Text(TextContent::new("look")),
        link("a.png", "https://x/file/1", Some("image/png")),
        link("spec.pdf", "https://x/file/2", Some("application/pdf")),
    ]);
    let message = prompt.to_chat_message();
    assert_eq!(message.content.message_text(), "look");
    let attachments = message.attachments.expect("files attach to the message");
    let contents: Vec<_> = attachments
        .parts()
        .iter()
        .map(|resolved| resolved.as_ref().expect("links always resolve"))
        .collect();
    assert_eq!(contents.len(), 2);

    // The static file id is what the reference names.
    assert_eq!(contents[0].reference.entity_id, "1");
    assert_eq!(contents[0].name.as_deref(), Some("a.png"));
    assert!(matches!(
        &contents[0].content[0],
        AttachmentPart::Image(ImageData::StaticUrl(url)) if url == "https://x/file/1"
    ));

    let AttachmentPart::Content(text) = &contents[1].content[0] else {
        panic!(
            "a non-image file is described in text: {:?}",
            contents[1].content[0]
        );
    };
    assert!(text.contains("spec.pdf") && text.contains("application/pdf"));
    assert!(text.contains("https://x/file/2"));
}

#[test]
fn a_text_only_prompt_attaches_nothing() {
    let message = UserPrompt::text("hi").to_chat_message();
    assert_eq!(message.content.message_text(), "hi");
    assert!(message.attachments.is_none());
}

#[test]
fn a_plain_http_image_is_named_rather_than_handed_over_as_an_image_url() {
    // Providers refuse http image URLs, and the attachment stays in history
    // for the rest of the session - so it must never reach them as an image.
    let prompt = UserPrompt::from_blocks(&[link(
        "a.png",
        "http://localhost:8100/file/1",
        Some("image/png"),
    )]);
    let message = prompt.to_chat_message();
    let attachments = message.attachments.expect("the file still attaches");
    let content = attachments.parts()[0].as_ref().expect("links resolve");
    let AttachmentPart::Content(text) = &content.content[0] else {
        panic!(
            "an http image is described, not embedded: {:?}",
            content.content[0]
        );
    };
    assert!(text.contains("a.png") && text.contains("http://localhost:8100/file/1"));
}
