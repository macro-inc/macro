use super::*;

const IMAGE_ID: &str = "0198f2c4-5b6a-7c8d-9e0f-1a2b3c4d5e6f";
const VIDEO_ID: &str = "0198f2c4-5b6a-7c8d-9e0f-1a2b3c4d5e70";

#[test]
fn a_marker_on_its_own_line_becomes_an_attachment_and_leaves_the_text() {
    let reply = format!(
        "Here is the lighthouse.\n\n<m-attachment>{{\"staticFileId\":\"{IMAGE_ID}\",\"kind\":\"image\",\"width\":1184,\"height\":864}}</m-attachment>\n\nWant another angle?"
    );

    let (text, markers) = take_attachment_markers(&reply);

    assert_eq!(text, "Here is the lighthouse.\n\nWant another angle?");
    assert_eq!(
        markers,
        vec![AttachmentMarker {
            static_file_id: IMAGE_ID.parse().unwrap(),
            kind: AttachmentKind::Image,
            width: Some(1184),
            height: Some(864),
        }]
    );
}

#[test]
fn a_reply_ending_with_its_marker_ends_with_the_text_before_it() {
    let reply = format!(
        "Here is the lighthouse.\n\n<m-attachment>{{\"staticFileId\":\"{IMAGE_ID}\",\"kind\":\"image\"}}</m-attachment>\n"
    );

    let (text, markers) = take_attachment_markers(&reply);

    assert_eq!(text, "Here is the lighthouse.");
    assert_eq!(markers.len(), 1);
}

#[test]
fn a_reply_opening_with_its_marker_starts_with_the_text_after_it() {
    let reply = format!(
        "<m-attachment>{{\"staticFileId\":\"{IMAGE_ID}\",\"kind\":\"image\"}}</m-attachment>\n\nHere is the lighthouse."
    );

    let (text, markers) = take_attachment_markers(&reply);

    assert_eq!(text, "Here is the lighthouse.");
    assert_eq!(markers.len(), 1);
}

#[test]
fn every_marker_is_taken_in_order_including_one_inside_a_sentence() {
    let reply = format!(
        "Two takes: <m-attachment>{{\"staticFileId\":\"{IMAGE_ID}\",\"kind\":\"image\"}}</m-attachment> and a clip.\n<m-attachment>{{\"staticFileId\":\"{VIDEO_ID}\",\"kind\":\"video\",\"width\":1920,\"height\":1080}}</m-attachment>"
    );

    let (text, markers) = take_attachment_markers(&reply);

    assert_eq!(text, "Two takes: and a clip.");
    assert_eq!(
        markers,
        vec![
            AttachmentMarker {
                static_file_id: IMAGE_ID.parse().unwrap(),
                kind: AttachmentKind::Image,
                width: None,
                height: None,
            },
            AttachmentMarker {
                static_file_id: VIDEO_ID.parse().unwrap(),
                kind: AttachmentKind::Video,
                width: Some(1920),
                height: Some(1080),
            },
        ]
    );
}

#[test]
fn a_marker_with_an_invalid_id_is_removed_without_an_attachment() {
    let reply = "Done.\n<m-attachment>{\"staticFileId\":\"not-a-uuid\",\"kind\":\"image\"}</m-attachment>\n<m-attachment>not json</m-attachment>";

    let (text, markers) = take_attachment_markers(reply);

    assert_eq!(text, "Done.");
    assert_eq!(markers, Vec::new());
}

#[test]
fn a_reply_without_markers_is_unchanged() {
    let reply = "Plain answer with <m-document-mention>{\"documentId\":\"d\"}</m-document-mention> and `code`.\n\n- a list\n";

    let (text, markers) = take_attachment_markers(reply);

    assert_eq!(text, reply);
    assert_eq!(markers, Vec::new());
}

#[test]
fn markers_inside_code_are_left_as_written() {
    let reply = format!(
        "Paste this:\n\n```markdown\n<m-attachment>{{\"staticFileId\":\"{IMAGE_ID}\",\"kind\":\"image\"}}</m-attachment>\n```\n\nor inline `<m-attachment>{{\"staticFileId\":\"{IMAGE_ID}\",\"kind\":\"image\"}}</m-attachment>` like that."
    );

    let (text, markers) = take_attachment_markers(&reply);

    assert_eq!(text, reply);
    assert_eq!(markers, Vec::new());
}

#[test]
fn a_rendered_marker_reads_back_as_itself() {
    let marker = AttachmentMarker {
        static_file_id: IMAGE_ID.parse().unwrap(),
        kind: AttachmentKind::Image,
        width: Some(1024),
        height: Some(768),
    };

    assert_eq!(
        marker.render(),
        format!(
            "<m-attachment>{{\"staticFileId\":\"{IMAGE_ID}\",\"kind\":\"image\",\"width\":1024,\"height\":768}}</m-attachment>"
        )
    );
    assert_eq!(take_attachment_markers(&marker.render()).1, vec![marker]);
}
