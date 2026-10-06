use super::*;
use crate::testing::design_system::{Builder, design_system_file, variables_file};
use crate::testing::simple_file;

fn open(bytes: &[u8]) -> Document {
    Document::open(bytes).expect("the file opens")
}

fn page<'a>(outline: &'a DesignOutline, name: &str) -> &'a PageOutline {
    outline
        .pages
        .iter()
        .find(|p| p.name == name)
        .unwrap_or_else(|| panic!("page {name} in {outline:#?}"))
}

fn frame<'a>(frames: &'a [FrameOutline], name: &str) -> &'a FrameOutline {
    frames
        .iter()
        .find(|f| f.name == name)
        .unwrap_or_else(|| panic!("frame {name} in {frames:#?}"))
}

fn characters(frame: &FrameOutline) -> Vec<&str> {
    frame.texts.iter().map(|t| t.characters.as_str()).collect()
}

/// A page with a section holding a frame, a frame beside it with hidden
/// and repeated text, and an empty second page.
fn sectioned_file() -> Vec<u8> {
    let mut b = Builder::new("Sections");
    let create = |b: &mut Builder, parent: &str, node: &str| -> String {
        b.op(&format!(
            r#"[{{"op":"create","parent":"{parent}","node":{node}}}]"#
        ))[0]
            .clone()
    };
    let text = |characters: &str, x: f64, y: f64| {
        format!(
            r#"{{"type":"TEXT","name":"Label","x":{x},"y":{y},"width":1,"height":1,"props":{{"characters":"{characters}","fontSize":12}}}}"#
        )
    };
    let section = create(
        &mut b,
        "0:1",
        r#"{"type":"SECTION","name":"Onboarding","x":0,"y":0,"width":800,"height":600}"#,
    );
    let welcome = create(
        &mut b,
        &section,
        r#"{"type":"FRAME","name":"Welcome","x":40,"y":40,"width":360,"height":640}"#,
    );
    create(&mut b, &welcome, &text("Get started", 60.0, 300.0));
    create(&mut b, &welcome, &text("Hello there", 60.0, 100.0));
    create(&mut b, &section, &text("Section note", 500.0, 40.0));
    let pricing = create(
        &mut b,
        "0:1",
        r#"{"type":"FRAME","name":"Pricing","x":1000,"y":0,"width":400,"height":300}"#,
    );
    create(&mut b, &pricing, &text("Monthly", 1020.0, 20.0));
    create(&mut b, &pricing, &text("Monthly", 1220.0, 20.0));
    let hidden = create(&mut b, &pricing, &text("Secret draft", 1020.0, 200.0));
    b.op(&format!(
        r#"[{{"op":"set","ids":["{hidden}"],"props":{{"visible":false}}}}]"#
    ));
    create(
        &mut b,
        "0:0",
        r#"{"type":"CANVAS","name":"Archive","x":0,"y":0,"width":0,"height":0}"#,
    );
    b.save()
}

#[test]
fn outlines_frames_with_their_text_in_reading_order() {
    let doc = open(&sectioned_file());
    let outline = outline(&doc, &OutlineOptions::default());
    assert_eq!(outline.page_count, 2);
    assert!(!outline.truncated);
    let first = &outline.pages[0];
    assert_eq!(first.number, 1);

    let section = frame(&first.frames, "Onboarding");
    assert_eq!(section.node_type, NodeType::Section);
    assert_eq!(characters(section), ["Section note"]);
    let welcome = frame(&section.frames, "Welcome");
    assert_eq!((welcome.width, welcome.height), (360.0, 640.0));
    assert_eq!(characters(welcome), ["Hello there", "Get started"]);

    let pricing = frame(&first.frames, "Pricing");
    assert_eq!(pricing.x, 1000.0);
    assert_eq!(characters(pricing), ["Monthly"], "hidden text is left out");
    assert_eq!(pricing.texts[0].count, 2);
    assert!(page(&outline, "Archive").frames.is_empty());
}

#[test]
fn outline_can_select_pages() {
    let doc = open(&sectioned_file());
    let outline = outline(
        &doc,
        &OutlineOptions {
            pages: Some(vec![2]),
            ..OutlineOptions::default()
        },
    );
    assert_eq!(outline.page_count, 2);
    assert_eq!(outline.pages.len(), 1);
    assert_eq!(outline.pages[0].name, "Archive");
    assert_eq!(outline.pages[0].number, 2);
}

#[test]
fn outline_stops_at_its_budget() {
    let doc = open(&sectioned_file());
    let outline = outline(
        &doc,
        &OutlineOptions {
            pages: None,
            max_chars: 30,
        },
    );
    assert!(outline.truncated);
    let texts: usize = outline
        .pages
        .iter()
        .flat_map(|p| &p.frames)
        .map(|f| f.texts.len() + f.frames.iter().map(|g| g.texts.len()).sum::<usize>())
        .sum();
    assert!(texts < 4, "{outline:#?}");
}

#[test]
fn outlines_the_design_system() {
    let doc = open(&design_system_file());
    let outline = outline(&doc, &OutlineOptions::default());

    let screen = frame(&page(&outline, "Screens").frames, "Screen");
    let used: Vec<&str> = screen.components.iter().map(|c| c.name.as_str()).collect();
    assert!(used.contains(&"Card"), "{used:?}");
    assert!(
        used.iter()
            .any(|n| n.ends_with(" / Type=Primary, Size=Medium")),
        "variants are named with their set: {used:?}"
    );
    let texts = characters(screen);
    assert!(texts.contains(&"Welcome"), "{texts:?}");
    assert!(
        texts.contains(&"Card title"),
        "instance text counts: {texts:?}"
    );

    let card = outline
        .components
        .iter()
        .find(|c| c.name == "Card")
        .expect("the card component");
    assert!(!card.is_set);
    assert_eq!(card.page, "Components");
    let kinds: Vec<(&str, &str)> = card
        .properties
        .iter()
        .map(|p| (p.name.as_str(), p.kind.as_str()))
        .collect();
    assert!(kinds.contains(&("Title", "TEXT")), "{kinds:?}");
    assert!(kinds.contains(&("Show icon", "BOOL")), "{kinds:?}");
    let title = card.properties.iter().find(|p| p.name == "Title").unwrap();
    assert_eq!(title.default.as_deref(), Some("Card title"));

    let set = outline
        .components
        .iter()
        .find(|c| c.is_set)
        .expect("the button set");
    assert_eq!(set.variants.len(), 2);
    let type_values = &set
        .variant_properties
        .iter()
        .find(|v| v.name == "Type")
        .expect("the Type property")
        .values;
    assert_eq!(type_values, &["Primary", "Secondary"]);
    assert!(
        !outline
            .components
            .iter()
            .any(|c| c.name.starts_with("Type=")),
        "variants are listed with their set, not alone"
    );

    let styles: Vec<(&str, &str)> = outline
        .styles
        .iter()
        .map(|s| (s.name.as_str(), s.style_type))
        .collect();
    assert!(styles.contains(&("Brand/Primary", "FILL")), "{styles:?}");
    assert!(styles.contains(&("Heading", "TEXT")), "{styles:?}");
    assert!(styles.contains(&("Elevation/1", "EFFECT")), "{styles:?}");
}

#[test]
fn outlines_variables() {
    let doc = open(&variables_file());
    let outline = outline(&doc, &OutlineOptions::default());
    let theme = outline
        .variables
        .iter()
        .find(|c| c.name == "Theme")
        .expect("the Theme collection");
    assert_eq!(theme.modes, ["Light", "Dark"]);
    let names: Vec<(&str, &str)> = theme
        .variables
        .iter()
        .map(|v| (v.name.as_str(), v.kind))
        .collect();
    assert!(names.contains(&("Surface", "COLOR")), "{names:?}");
    assert!(names.contains(&("Brand", "COLOR")), "{names:?}");
}

#[test]
fn text_by_page_has_frame_names_and_distinct_text() {
    let doc = open(&sectioned_file());
    let pages = text_by_page(&doc);
    assert_eq!(pages.len(), 2);
    let lines: Vec<&str> = pages[0].text.lines().collect();
    assert_eq!(lines[0], pages[0].name);
    for expected in ["Onboarding", "Welcome", "Hello there", "Pricing", "Monthly"] {
        assert!(lines.contains(&expected), "{expected} in {lines:?}");
    }
    assert!(!lines.contains(&"Label"), "layer names are not indexed");
    assert!(
        !lines.contains(&"Secret draft"),
        "hidden text is not indexed"
    );
    assert_eq!(lines.iter().filter(|l| **l == "Monthly").count(), 1);
    assert_eq!(pages[1].text, "Archive");
    assert_ne!(pages[0].id, pages[1].id);
}

#[test]
fn text_by_page_includes_instance_text() {
    let doc = open(&design_system_file());
    let screens = text_by_page(&doc)
        .into_iter()
        .find(|p| p.name == "Screens")
        .unwrap();
    assert!(screens.text.contains("Card title"), "{}", screens.text);
    assert!(screens.text.contains("Screen"), "{}", screens.text);
}

#[test]
fn files_without_text_still_outline() {
    let doc = open(&simple_file());
    let outline = outline(&doc, &OutlineOptions::default());
    let only = frame(&outline.pages[0].frames, "Frame");
    assert!(only.texts.is_empty());
    assert_eq!(text_by_page(&doc)[0].text, "Page 1\nFrame");
}
