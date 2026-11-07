use crate::edit::{AnimationSpec, EditOp, NewShape};
use crate::model::presentation::Presentation;
use crate::opc::rel_type;
use crate::test_support::{deck, fonts, text_box};
use base64::Engine;

const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/// Not a playable file; the engine stores clips as they come.
const CLIP: &[u8] = b"\0\0\0\x18ftypmp42\0\0\0\0mp42isom";

fn pres() -> Presentation {
    let shape = text_box(
        2,
        0,
        0,
        914_400,
        457_200,
        "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Watch</a:t></a:r></a:p>",
    );
    Presentation::open(deck(&[&shape])).unwrap()
}

fn add(pres: &mut Presentation, shape: NewShape) -> crate::error::Result<u32> {
    let result = pres.apply(
        &[EditOp::AddShape {
            slide: 256,
            shape,
            x: 100.0,
            y: 50.0,
            w: 320.0,
            h: 0.0,
        }],
        fonts(),
    )?;
    Ok(result.created[0].shape.unwrap())
}

fn video() -> NewShape {
    NewShape::Video {
        data: base64::engine::general_purpose::STANDARD.encode(CLIP),
        content_type: "video/mp4".into(),
        poster: PNG_1X1.into(),
        description: "Product demo".into(),
    }
}

/// The slide's `p:video`/`p:audio` time nodes, as `kind:spid`.
fn media_nodes(pres: &mut Presentation) -> Vec<String> {
    let part = pres.slide_part(256).unwrap();
    let doc = pres.xml(&part).unwrap();
    doc.descendants(doc.root())
        .into_iter()
        .filter(|&n| {
            matches!(doc.local(n), "video" | "audio")
                && doc.local(doc.parent(n).unwrap()) == "childTnLst"
        })
        .map(|n| {
            let spid = doc
                .descendants(n)
                .into_iter()
                .find(|&t| doc.local(t) == "spTgt")
                .and_then(|t| doc.attr(t, "spid"))
                .unwrap_or("");
            format!("{}:{spid}", doc.local(n))
        })
        .collect()
}

#[test]
fn videos_are_embedded_outlined_and_round_trip() {
    let mut pres = pres();
    let id = add(&mut pres, video()).unwrap();
    let outline = pres.slide_outline(0).unwrap();
    let shape = outline.shapes.iter().find(|s| s.id == id).unwrap();
    let media = shape.media.clone().expect("a media outline");
    assert_eq!(media.kind, "video");
    assert_eq!(media.url, None);
    let part = media.part.clone().unwrap();
    assert!(
        part.starts_with("/ppt/media/media") && part.ends_with(".mp4"),
        "{part}"
    );
    assert_eq!(pres.media_bytes(&part).unwrap(), CLIP);
    // A 1×1 poster gives a square frame at the asked width.
    assert!((shape.w - 320.0).abs() < 0.5 && (shape.h - 320.0).abs() < 0.5);
    assert_eq!(shape.alt_text, "Product demo");
    // Media shapes carry PowerPoint's click action, not a hyperlink.
    assert_eq!(shape.link, None);
    assert_eq!(media_nodes(&mut pres), vec![format!("video:{id}")]);
    assert_eq!(pres.pkg.content_type(&part), Some("video/mp4"));

    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let outline = reopened.slide_outline(0).unwrap();
    let again = outline.shapes.iter().find(|s| s.id == id).unwrap();
    assert_eq!(again.media.as_ref(), Some(&media));
    assert_eq!(reopened.media_bytes(&part).unwrap(), CLIP);
    // Only media parts can be read this way.
    assert!(reopened.media_bytes("/ppt/slides/slide1.xml").is_err());
}

#[test]
fn audio_takes_audio_types_only() {
    let mut pres = pres();
    let audio = |content_type: &str| NewShape::Audio {
        data: base64::engine::general_purpose::STANDARD.encode(b"ID3\x04\0\0\0\0\0\0"),
        content_type: content_type.into(),
        poster: PNG_1X1.into(),
        description: String::new(),
    };
    assert!(add(&mut pres, audio("video/mp4")).is_err());
    assert!(add(&mut pres, audio("application/zip")).is_err());
    let id = add(&mut pres, audio("audio/mpeg")).unwrap();
    let outline = pres.slide_outline(0).unwrap();
    let media = outline
        .shapes
        .iter()
        .find(|s| s.id == id)
        .and_then(|s| s.media.clone())
        .unwrap();
    assert_eq!(media.kind, "audio");
    assert!(media.part.unwrap().ends_with(".mp3"));
    assert_eq!(media_nodes(&mut pres), vec![format!("audio:{id}")]);
}

#[test]
fn media_survives_animation_edits_and_leaves_with_its_shape() {
    let mut pres = pres();
    let id = add(&mut pres, video()).unwrap();
    // Animating the text box rewrites the timing around the video's node.
    pres.apply(
        &[EditOp::SetAnimations {
            slide: 256,
            animations: vec![
                serde_json::from_value::<AnimationSpec>(serde_json::json!({
                    "shapeId": 2,
                    "class": "entrance",
                    "effect": "fade",
                    "start": "onClick"
                }))
                .unwrap(),
            ],
        }],
        fonts(),
    )
    .unwrap();
    assert_eq!(media_nodes(&mut pres), vec![format!("video:{id}")]);
    assert_eq!(pres.slide_outline(0).unwrap().animations.len(), 1);

    pres.apply(
        &[EditOp::DeleteShape {
            slide: 256,
            shape: id,
        }],
        fonts(),
    )
    .unwrap();
    assert!(media_nodes(&mut pres).is_empty());
    let part = pres.slide_part(256).unwrap();
    let rels = pres.part_rels(&part).unwrap();
    assert!(
        !rels
            .iter()
            .any(|r| r.rel_type == rel_type::VIDEO || r.rel_type == rel_type::MEDIA),
        "the clip's relationships go with it"
    );
    assert!(
        !pres.pkg.part_names().any(|n| n.ends_with(".mp4")),
        "and so does the clip"
    );
}
