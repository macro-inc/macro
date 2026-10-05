use super::*;
use crate::document::Document;
use crate::edit::{History, Op};
use crate::library::{self as lib, AssetKind, Change};
use crate::model::{Guid, NodeType, PaintKind};
use crate::save::{blank, save};
use crate::scene::Scene;
use crate::testing::design_system::{design_system_file, variables_file};

#[test]
fn values_replace_their_key() {
    let list = with_value(None, "a", Some("1")).unwrap();
    let list = with_value(Some(&list), "a", Some("2")).unwrap();
    assert_eq!(list.len(), 1);
    assert!(with_value(Some(&list), "a", None).is_none());
}

/// A file being edited.
struct File {
    doc: Document,
    history: History,
    original: Vec<u8>,
}

impl File {
    fn open(bytes: Vec<u8>) -> File {
        File {
            doc: Document::open(&bytes).expect("the file opens"),
            history: History::default(),
            original: bytes,
        }
    }

    fn op(&mut self, json: &str) -> Vec<String> {
        let ops: Vec<Op> = serde_json::from_str(json).expect("operations parse");
        self.history
            .apply(&mut self.doc, &ops, None)
            .expect("operations apply")
            .created
    }

    fn reopen(&self) -> File {
        File::open(save(&self.doc, &self.original).expect("the file saves"))
    }

    fn import(&mut self, package: &crate::save::Copied, spec: &str) -> Vec<String> {
        let spec: LibrarySpec = serde_json::from_str(spec).expect("the spec parses");
        self.history
            .import_library(
                &mut self.doc,
                &self.original,
                &package.document,
                Some(&package.images),
                &spec,
            )
            .expect("the library imports")
            .created
    }

    fn named(&self, name: &str) -> NodeIdx {
        (0..self.doc.nodes.len() as NodeIdx)
            .find(|&i| !self.doc.node(i).removed && self.doc.props(i).name() == name)
            .unwrap_or_else(|| panic!("no layer named {name}"))
    }

    fn id(&self, i: NodeIdx) -> String {
        self.doc.props(i).guid.unwrap().to_string()
    }

    fn key_of(&self, name: &str) -> String {
        lib::published(&self.doc)
            .assets
            .into_iter()
            .find(|a| a.name == name)
            .unwrap_or_else(|| panic!("{name} is not published"))
            .key
    }
}

fn published_library() -> File {
    let mut l = File::open(design_system_file());
    l.op(r#"[{"op":"publishLibrary","seed":"lib-1","note":"First version"}]"#);
    l
}

/// The fill color of the first paint.
fn color(p: &crate::model::Props) -> Option<String> {
    match p.fills().first()?.kind {
        PaintKind::Solid(c) => Some(c.hex()),
        _ => None,
    }
}

#[test]
fn publishing_lists_changes_until_published() {
    let mut l = File::open(design_system_file());
    let before = lib::status(&l.doc);
    assert!(!before.published);
    assert!(before.assets > 0);
    assert!(before.changes.iter().all(|c| c.change == Change::New));
    let names: Vec<&str> = before.changes.iter().map(|c| c.name.as_str()).collect();
    for name in [
        "Card",
        "Icon/Star",
        "Brand/Primary",
        "Heading",
        "Elevation/1",
    ] {
        assert!(names.contains(&name), "{name} is listed in {names:?}");
    }
    // A component set is listed, not its variants.
    assert!(
        before
            .changes
            .iter()
            .any(|c| c.kind == AssetKind::ComponentSet)
    );
    assert!(!names.contains(&"Type=Primary, Size=Medium"));

    l.op(r#"[{"op":"publishLibrary","seed":"lib-1","note":"First version"}]"#);
    let after = lib::status(&l.doc);
    assert!(after.published);
    assert!(after.changes.is_empty(), "{:?}", after.changes);
    assert_eq!(after.note.as_deref(), Some("First version"));

    // Keys are Figma's 40 hex digits, and saving keeps every version.
    let card = l.named("Card");
    let key = l.doc.props(card).key.clone().unwrap();
    assert_eq!(key.len(), 40);
    assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
    let reopened = l.reopen();
    let status = lib::status(&reopened.doc);
    assert!(status.published);
    assert!(status.changes.is_empty(), "{:?}", status.changes);
    let card = reopened.named("Card");
    let link = reopened.doc.props(card).library.clone().unwrap();
    assert_eq!(link.publishable, Some(true));
    assert!(link.published_version.is_some());
    assert_eq!(reopened.doc.props(card).key.as_deref(), Some(&*key));

    // Changing a component (and the one nested in Card) shows up; deleting
    // a style shows as removed; undo puts the publish back.
    let mut l = reopened;
    let star_shape = l
        .doc
        .node(l.named("Icon/Star"))
        .children
        .first()
        .copied()
        .unwrap();
    let id = l.id(star_shape);
    l.op(&format!(
        r#"[{{"op":"set","ids":["{id}"],"props":{{"fills":[{{"color":"00FF00"}}]}}}}]"#
    ));
    let style = l.id(l.named("Elevation/1"));
    l.op(&format!(r#"[{{"op":"deleteStyle","ids":["{style}"]}}]"#));
    let changes = lib::status(&l.doc).changes;
    let find = |name: &str| changes.iter().find(|c| c.name == name).map(|c| c.change);
    assert_eq!(find("Icon/Star"), Some(Change::Changed));
    assert_eq!(find("Card"), Some(Change::Changed), "Card holds a star");
    assert_eq!(find("Elevation/1"), Some(Change::Removed));
    assert_eq!(find("Icon/Heart"), None);
}

#[test]
fn private_assets_are_keyed_but_not_listed() {
    let mut l = File::open(design_system_file());
    let heart = l.id(l.named("Icon/Heart"));
    l.op(&format!(
        r#"[{{"op":"set","ids":["{heart}"],"props":{{"name":"_Heart"}}}},
            {{"op":"publishLibrary","seed":"lib-1"}}]"#
    ));
    let heart = l.named("_Heart");
    assert!(l.doc.props(heart).key.is_some());
    assert_eq!(
        l.doc.props(heart).library.as_ref().unwrap().publishable,
        Some(false)
    );
    assert!(
        !lib::published(&l.doc)
            .assets
            .iter()
            .any(|a| a.name == "_Heart")
    );
}

/// The library, and a blank file with an instance of its Card placed.
fn card_in_app() -> (File, File, String) {
    let l = published_library();
    let card = l.key_of("Card");
    let package = lib::package(&l.doc, &l.original, std::slice::from_ref(&card)).unwrap();
    let mut app = File::open(blank("App"));
    let created = app.import(
        &package,
        &format!(
            r#"{{"library":"lib-1","then":[{{"op":"instantiate","component":"key:{card}","parent":"0:1","x":40,"y":60}}]}}"#
        ),
    );
    assert_eq!(created.len(), 1, "the instance is created");
    (l, app, created[0].clone())
}

#[test]
fn inserting_copies_the_component_and_what_it_uses() {
    let (l, app, instance) = card_in_app();
    let uses = lib::uses(&app.doc);
    let card_key = l.key_of("Card");
    let card = uses
        .copies
        .iter()
        .find(|c| c.key == card_key)
        .expect("Card is copied");
    assert_eq!(card.library.as_deref(), Some("lib-1"));
    assert_eq!(card.kind, AssetKind::Component);
    let published = lib::published(&l.doc);
    let version = &published
        .assets
        .iter()
        .find(|a| a.key == card_key)
        .unwrap()
        .version;
    assert_eq!(card.version.as_ref(), Some(version));
    // Its icon (an instance inside) came along as a library component too.
    assert!(uses.copies.iter().any(|c| c.name == "Icon/Star"));

    // The copy is on the internal canvas, in the library's own sessions.
    let copy = app.doc.find(Guid::parse(&card.id).unwrap()).unwrap();
    let canvas = app.doc.node(copy).parent.unwrap();
    assert_eq!(app.doc.props(canvas).internal_only, Some(true));
    assert!(app.doc.props(copy).guid.unwrap().session >= LIBRARY_SESSIONS);
    assert_eq!(
        app.doc.props(copy).library.as_ref().unwrap().publish_id,
        l.doc.props(l.named("Card")).guid
    );

    // The instance shows the copy's layers, as the library's card does.
    let page = app.doc.pages[0];
    let scene = Scene::build(&app.doc, page);
    let at = scene.find(&app.doc, &instance).unwrap();
    let names: Vec<&str> = scene
        .node(at)
        .children
        .iter()
        .map(|&c| scene.props(&app.doc, c).name())
        .collect();
    assert_eq!(names, ["Background", "Title", "Icon"]);

    // Saving keeps the copies as Figma's library components, and a new
    // session starts below the library sessions.
    let reopened = app.reopen();
    assert!(reopened.doc.next_guid.session < LIBRARY_SESSIONS);
    let copy = reopened
        .doc
        .find(Guid::parse(&card.id).unwrap())
        .expect("the copy is saved");
    let p = reopened.doc.props(copy);
    assert_eq!(p.node_type(), NodeType::Symbol);
    assert_eq!(p.key.as_deref(), Some(card_key.as_str()));
    let link = p.library.as_ref().unwrap();
    assert_eq!(link.source.as_deref(), Some("lib-1"));
    assert_eq!(
        link.version.as_ref(),
        Some(version).map(|v| v.as_str().into()).as_ref()
    );
    assert_eq!(link.publishable, Some(false));
    assert_eq!(lib::uses(&reopened.doc).copies.len(), uses.copies.len());
    let scene = Scene::build(&reopened.doc, reopened.doc.pages[0]);
    let at = scene.find(&reopened.doc, &instance).unwrap();
    assert_eq!(scene.node(at).children.len(), 3);

    // Inserting it again reuses the copy.
    let mut app = reopened;
    let package = lib::package(&l.doc, &l.original, std::slice::from_ref(&card_key)).unwrap();
    let before = lib::uses(&app.doc).copies.len();
    app.import(
        &package,
        &format!(
            r#"{{"library":"lib-1","then":[{{"op":"instantiate","component":"key:{card_key}","parent":"0:1","x":300,"y":60}}]}}"#
        ),
    );
    assert_eq!(lib::uses(&app.doc).copies.len(), before);
}

#[test]
fn an_update_replaces_the_copy_and_keeps_overrides() {
    let (mut l, mut app, instance) = card_in_app();
    let card_key = l.key_of("Card");
    // Override the title in the app.
    let card_copy = lib::uses(&app.doc)
        .copies
        .into_iter()
        .find(|c| c.key == card_key)
        .unwrap()
        .id;
    let copy = app.doc.find(Guid::parse(&card_copy).unwrap()).unwrap();
    let title = app.doc.node(copy).children[1];
    let title_id = app.id(title);
    app.op(&format!(
        r#"[{{"op":"set","ids":["I{instance};{title_id}"],"props":{{"characters":"Hello"}}}}]"#
    ));

    // The library changes Card's background and publishes.
    let background = l.id(l.doc.node(l.named("Card")).children[0]);
    l.op(&format!(
        r#"[{{"op":"set","ids":["{background}"],"props":{{"fills":[{{"color":"FF0000"}}]}}}}]"#
    ));
    assert!(
        lib::status(&l.doc)
            .changes
            .iter()
            .any(|c| c.name == "Card" && c.change == Change::Changed)
    );
    l.op(r#"[{"op":"publishLibrary","seed":"lib-1","note":"Red cards"}]"#);
    let new_version = lib::published(&l.doc)
        .assets
        .into_iter()
        .find(|a| a.key == card_key)
        .unwrap()
        .version;
    let old_background = color(app.doc.props(app.doc.node(copy).children[0]));

    // Inserting without updating keeps the old copy.
    let package = lib::package(&l.doc, &l.original, std::slice::from_ref(&card_key)).unwrap();
    app.import(&package, r#"{"library":"lib-1"}"#);
    assert_eq!(
        color(app.doc.props(app.doc.node(copy).children[0])),
        old_background
    );

    app.import(&package, r#"{"library":"lib-1","update":true}"#);
    let background = app.doc.node(copy).children[0];
    assert_eq!(color(app.doc.props(background)).as_deref(), Some("FF0000"));
    assert_eq!(
        app.doc
            .props(copy)
            .library
            .as_ref()
            .unwrap()
            .version
            .as_deref(),
        Some(new_version.as_str())
    );
    // The same layers (ids) as before, so the instance keeps its override.
    assert_eq!(app.doc.node(copy).children[1], title);
    let scene = Scene::build(&app.doc, app.doc.pages[0]);
    let at = scene.find(&app.doc, &instance).unwrap();
    let kids = &scene.node(at).children;
    assert_eq!(
        color(scene.props(&app.doc, kids[0])).as_deref(),
        Some("FF0000")
    );
    let text = scene.props(&app.doc, kids[1]).text_content.clone().unwrap();
    assert_eq!(&*text.characters, "Hello");

    // Saved, the update stays; undone, the old version is back.
    let reopened = app.reopen();
    let background = reopened
        .doc
        .node(reopened.doc.find(Guid::parse(&card_copy).unwrap()).unwrap())
        .children[0];
    assert_eq!(
        color(reopened.doc.props(background)).as_deref(),
        Some("FF0000")
    );
    app.history.undo(&mut app.doc).unwrap();
    assert_eq!(
        color(app.doc.props(app.doc.node(copy).children[0])),
        old_background
    );
    let undone = app.reopen();
    let background = undone
        .doc
        .node(undone.doc.find(Guid::parse(&card_copy).unwrap()).unwrap())
        .children[0];
    assert_eq!(color(undone.doc.props(background)), old_background);
}

#[test]
fn library_styles_apply_and_update() {
    let mut l = published_library();
    let brand = l.key_of("Brand/Primary");
    let package = lib::package(&l.doc, &l.original, std::slice::from_ref(&brand)).unwrap();
    let mut app = File::open(blank("App"));
    let rect = app.op(
        r#"[{"op":"create","parent":"0:1","node":{"type":"RECTANGLE","x":0,"y":0,"width":50,"height":50}}]"#,
    )[0]
    .clone();
    app.import(
        &package,
        &format!(
            r#"{{"library":"lib-1","then":[{{"op":"applyStyle","ids":["{rect}"],"kind":"FILL","style":"key:{brand}"}}]}}"#
        ),
    );
    let r = app.doc.find(Guid::parse(&rect).unwrap()).unwrap();
    assert_eq!(color(app.doc.props(r)).as_deref(), Some("7B61FF"));
    let style = app.doc.props(r).fill_style.unwrap();
    assert!(
        app.doc
            .props(app.doc.find(style).unwrap())
            .library_source()
            .is_some()
    );
    // Library styles are not the file's own.
    let styles = crate::inspect::local_styles(&app.doc);
    assert!(styles.iter().any(|s| s.name == "Brand/Primary" && s.remote));

    let style_id = l.id(l.named("Brand/Primary"));
    l.op(&format!(
        r#"[{{"op":"editStyle","style":"{style_id}","props":{{"fills":[{{"color":"00AA00"}}]}}}},
            {{"op":"publishLibrary","seed":"lib-1"}}]"#
    ));
    let package = lib::package(&l.doc, &l.original, std::slice::from_ref(&brand)).unwrap();
    app.import(&package, r#"{"library":"lib-1","update":true}"#);
    assert_eq!(color(app.doc.props(r)).as_deref(), Some("00AA00"));
    let reopened = app.reopen();
    let r = reopened.doc.find(Guid::parse(&rect).unwrap()).unwrap();
    assert_eq!(color(reopened.doc.props(r)).as_deref(), Some("00AA00"));
    assert!(reopened.doc.props(r).fill_style.is_some());
}

#[test]
fn library_variables_bind_and_update() {
    let mut l = File::open(variables_file());
    l.op(r#"[{"op":"publishLibrary","seed":"vars"}]"#);
    let brand = l.key_of("Brand");
    let package = lib::package(&l.doc, &l.original, std::slice::from_ref(&brand)).unwrap();
    // A file whose schema has variables (its own Theme too).
    let mut app = File::open(variables_file());
    let rect = app.op(
        r#"[{"op":"create","parent":"1:1","node":{"type":"RECTANGLE","x":0,"y":200,"width":50,"height":50}}]"#,
    )[0]
    .clone();
    app.import(
        &package,
        &format!(
            r#"{{"library":"vars","then":[{{"op":"bindVariable","ids":["{rect}"],"field":"FILL","index":0,"variable":"key:{brand}"}}]}}"#
        ),
    );
    let r = app.doc.find(Guid::parse(&rect).unwrap()).unwrap();
    assert_eq!(color(app.doc.props(r)).as_deref(), Some("0000FF"));
    // Brand aliases Surface in Dark: both came, with their collection.
    let copies = lib::uses(&app.doc).copies;
    for kind in [AssetKind::Variable, AssetKind::Collection] {
        assert!(copies.iter().any(|c| c.kind == kind), "{kind:?}");
    }
    assert!(copies.iter().any(|c| c.name == "Surface"));

    let reopened = app.reopen();
    let r = reopened.doc.find(Guid::parse(&rect).unwrap()).unwrap();
    let var = reopened.doc.props(r).fills()[0].color_var.unwrap();
    let v = reopened
        .doc
        .props(reopened.doc.find(var).unwrap())
        .variable
        .clone()
        .unwrap();
    assert_eq!(v.values.len(), 2);
    assert!(reopened.doc.find(v.set.unwrap()).is_some());
    // The copies keep their node types, as Figma reads them.
    let saved = save(&app.doc, &app.original).unwrap();
    let container = crate::container::Container::open_without_images(&saved).unwrap();
    let schema = crate::kiwi::Schema::decode(&container.schema).unwrap();
    let records =
        crate::edit::paste::decode_records(&schema, &container.message).unwrap();
    let type_of = |g: Guid| match records[&g].get(&schema, "type") {
        Some(crate::kiwi::Value::Enum(def, v)) => schema.enum_name(*def, *v).map(str::to_owned),
        _ => None,
    };
    assert_eq!(type_of(var).as_deref(), Some("VARIABLE"));
    assert_eq!(type_of(v.set.unwrap()).as_deref(), Some("VARIABLE_SET"));
}

#[test]
fn copies_reach_other_people() {
    use crate::collab::Collab;
    let l = published_library();
    let card = l.key_of("Card");
    let package = lib::package(&l.doc, &l.original, std::slice::from_ref(&card)).unwrap();
    let bytes = blank("App");
    let mut a = File::open(bytes.clone());
    let mut b = File::open(bytes);
    let (mut ca, _) = Collab::new(&mut a.doc, 2_000_000, Some(0));
    let (mut cb, _) = Collab::new(&mut b.doc, 3_000_000, Some(0));
    let spec: LibrarySpec = serde_json::from_str(&format!(
        r#"{{"library":"lib-1","then":[{{"op":"instantiate","component":"key:{card}","parent":"0:1","x":0,"y":0}}]}}"#
    ))
    .unwrap();
    let mut applied = a
        .history
        .import_library(
            &mut a.doc,
            &a.original,
            &package.document,
            Some(&package.images),
            &spec,
        )
        .unwrap();
    ca.record(&mut a.doc, &mut applied.touched, false);
    let changes = ca.changes(&a.doc);
    cb.apply(&mut b.doc, &changes);
    let ua = lib::uses(&a.doc).copies;
    let ub = lib::uses(&b.doc).copies;
    assert_eq!(ua.len(), ub.len());
    for (x, y) in ua.iter().zip(&ub) {
        assert_eq!(
            (&x.key, &x.version, &x.library),
            (&y.key, &y.version, &y.library)
        );
    }
    let instance = &applied.created[0];
    let scene = Scene::build(&b.doc, b.doc.pages[0]);
    let at = scene.find(&b.doc, instance).expect("the instance arrived");
    assert_eq!(scene.node(at).children.len(), 3);
    // The other person's save keeps the copies too.
    let reopened = b.reopen();
    assert_eq!(lib::uses(&reopened.doc).copies.len(), ua.len());
}

#[test]
fn enabled_libraries_are_stored_on_the_document() {
    let mut app = File::open(blank("App"));
    app.op(r#"[{"op":"setLibraries","libraries":[{"id":"lib-1","name":"Design system"}]}]"#);
    assert_eq!(lib::enabled(&app.doc).len(), 1);
    let reopened = app.reopen();
    let enabled = lib::enabled(&reopened.doc);
    assert_eq!(enabled[0].name, "Design system");
    app.history.undo(&mut app.doc).unwrap();
    assert!(lib::enabled(&app.doc).is_empty());
}

#[test]
fn copies_have_thumbnails() {
    let (_, app, _) = card_in_app();
    let copy = lib::uses(&app.doc).copies[0].id.clone();
    let png = lib::thumbnail(
        &app.doc,
        &mut crate::images::ImageStore::default(),
        Guid::parse(&copy).unwrap(),
        64,
    )
    .expect("a copy on the internal canvas draws");
    assert!(png.starts_with(b"\x89PNG"));
}
