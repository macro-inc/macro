use crate::edit::{EditOp, EditResult, Editor};
use crate::inspect::{MasterLayoutOutline, ShapeOutline, SlideOutline};
use crate::model::masters::MASTER_ID_BASE;
use crate::model::presentation::Presentation;
use crate::test_support::fonts;
use serde_json::json;

/// A corpus deck: slide 1 uses "Title Slide", slide 2 "Title and Content",
/// slides 3-8 "Title Only"; eight of its eleven layouts are unused.
fn kitchen_sink() -> Presentation {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/corpus/generated/kitchen-sink-financial.pptx"
    );
    Presentation::open(std::fs::read(path).unwrap()).unwrap()
}

fn apply(pres: &mut Presentation, ops: serde_json::Value) -> EditResult {
    let ops: Vec<EditOp> = serde_json::from_value(ops).unwrap();
    pres.apply(&ops, fonts()).unwrap()
}

fn refused(pres: &mut Presentation, ops: serde_json::Value) -> String {
    let ops: Vec<EditOp> = serde_json::from_value(ops).unwrap();
    pres.apply(&ops, fonts()).unwrap_err().to_string()
}

fn layout(pres: &mut Presentation, name: &str) -> MasterLayoutOutline {
    let outline = pres.outline().unwrap();
    outline.masters[0]
        .layouts
        .iter()
        .find(|l| l.name == name)
        .cloned()
        .unwrap_or_else(|| panic!("no layout {name}"))
}

fn layout_names(pres: &mut Presentation) -> Vec<String> {
    pres.outline().unwrap().masters[0]
        .layouts
        .iter()
        .map(|l| l.name.clone())
        .collect()
}

fn page(pres: &mut Presentation, id: u32) -> SlideOutline {
    pres.slide_outline(id as usize).unwrap()
}

fn placeholder<'a>(page: &'a SlideOutline, kind: &str) -> &'a ShapeOutline {
    page.shapes
        .iter()
        .find(|s| s.placeholder.as_deref() == Some(kind))
        .unwrap_or_else(|| panic!("no {kind} placeholder"))
}

fn reopen(pres: &mut Presentation) -> Presentation {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
    reopened
}

fn render(pres: &mut Presentation, index: usize) -> Vec<u8> {
    pres.render_slide(index, 320, fonts())
        .unwrap()
        .to_straight_rgba()
}

#[test]
fn the_outline_lists_the_master_and_its_layouts_with_their_slides() {
    let mut pres = kitchen_sink();
    let outline = pres.outline().unwrap();
    assert_eq!(outline.masters.len(), 1);
    let master = &outline.masters[0];
    assert!(master.id >= MASTER_ID_BASE);
    assert_eq!(master.name, "Office Theme");
    assert_eq!(master.layouts.len(), 11);
    assert_eq!(
        master.placeholders,
        ["title", "body", "dt", "ftr", "sldNum"]
    );
    let title_only = master
        .layouts
        .iter()
        .find(|l| l.name == "Title Only")
        .unwrap();
    assert_eq!(title_only.slide_ids, [258, 259, 260, 261, 262, 263]);
    assert_eq!(title_only.kind, "titleOnly");
    assert_eq!(title_only.placeholders, ["title", "dt", "ftr", "sldNum"]);
    let blank = master.layouts.iter().find(|l| l.name == "Blank").unwrap();
    assert!(blank.slide_ids.is_empty());
    // Slides name their layout by id too.
    assert_eq!(outline.slides[2].layout_id, Some(title_only.id));
}

#[test]
fn a_layout_reads_like_a_slide_by_its_id() {
    let mut pres = kitchen_sink();
    let content = layout(&mut pres, "Title and Content");
    let outline = page(&mut pres, content.id);
    assert_eq!(outline.id, content.id);
    assert_eq!(outline.index, 2, "the master, then its layouts");
    assert_eq!(outline.layout, "Title and Content");
    assert_eq!(outline.layout_id, Some(content.id));
    assert!(outline.notes.is_none());
    let body = placeholder(&outline, "obj");
    assert_eq!(body.placeholder_index, Some(1));
    assert_eq!(body.paragraphs[0].text, "Click to edit Master text styles");
    // Caret layout of the layout's title, styled by the master's title style.
    let title = placeholder(&outline, "title").id;
    let text = pres
        .text_layout(content.id as usize, title, None, fonts())
        .unwrap()
        .unwrap();
    assert_eq!(text.paragraphs[0], "Click to edit Master title style");
    assert_eq!(text.styles[0].runs[0].size, 44.0);
    // The master itself, with its own text styles.
    let master = pres.outline().unwrap().masters[0].id;
    let outline = page(&mut pres, master);
    assert_eq!(outline.index, 0);
    assert_eq!(outline.layout, "Office Theme");
    assert_eq!(outline.layout_id, None);
    let title = placeholder(&outline, "title").id;
    let text = pres
        .text_layout(master as usize, title, None, fonts())
        .unwrap()
        .unwrap();
    assert_eq!(text.styles[0].runs[0].size, 44.0);
    // Pages render, and a slide number placeholder shows its ‹#› field.
    assert!(render(&mut pres, master as usize).iter().any(|&b| b != 255));
    let number = placeholder(&outline, "sldNum").id;
    let text = pres
        .text_layout(master as usize, number, None, fonts())
        .unwrap()
        .unwrap();
    assert_eq!(text.paragraphs[0], "‹#›");
    // Ids that are neither slides nor masters are refused.
    assert!(pres.slide_outline(MASTER_ID_BASE as usize + 999).is_err());
    assert!(pres.slide_outline(99).is_err());
}

#[test]
fn editing_a_layout_changes_only_the_slides_that_use_it() {
    let mut pres = kitchen_sink();
    let title_only = layout(&mut pres, "Title Only");
    let title = placeholder(&page(&mut pres, title_only.id), "title").id;
    let using = pres.slides().iter().position(|s| s.id == 258).unwrap();
    let other = pres.slides().iter().position(|s| s.id == 256).unwrap();
    let (before_using, before_other) = (render(&mut pres, using), render(&mut pres, other));
    let result = apply(
        &mut pres,
        json!([{"op": "formatText", "slide": title_only.id, "shape": title,
                "props": {"bold": true, "color": "C00000", "size": 40}}]),
    );
    assert_eq!(result.changed_slides, title_only.slide_ids);
    assert_eq!(result.changed_layouts, [title_only.id]);
    assert!(!result.structure_changed);
    assert_ne!(render(&mut pres, using), before_using);
    assert_eq!(render(&mut pres, other), before_other);
    // The slide's title inherits the layout's formatting.
    let slide = pres.slide_outline(using).unwrap();
    let slide_title = placeholder(&slide, "title").id;
    let text = pres
        .text_layout(using, slide_title, None, fonts())
        .unwrap()
        .unwrap();
    let run = &text.styles[0].runs[0];
    assert!(run.bold);
    assert_eq!(run.color.as_deref(), Some("#C00000"));
    // The slide's own size wins over the layout's.
    assert_eq!(run.size, 28.0);
    // A slide whose title has no size of its own takes the layout's.
    let result = apply(
        &mut pres,
        json!([{"op": "addSlide", "layout": "Title Only", "title": "New"}]),
    );
    let added = pres
        .slides()
        .iter()
        .position(|s| s.id == result.created[0].slide)
        .unwrap();
    let added_title = placeholder(&pres.slide_outline(added).unwrap(), "title").id;
    let text = pres
        .text_layout(added, added_title, None, fonts())
        .unwrap()
        .unwrap();
    assert_eq!(text.styles[0].runs[0].size, 40.0);
    // Paragraph formatting carries over too.
    apply(
        &mut pres,
        json!([{"op": "formatParagraphs", "slide": title_only.id, "shape": title,
                "props": {"align": "right"}}]),
    );
    let text = pres
        .text_layout(using, slide_title, None, fonts())
        .unwrap()
        .unwrap();
    assert_eq!(text.styles[0].align, "right");
    // Formatting part of the text stays with the layout's own text.
    apply(
        &mut pres,
        json!([{"op": "formatText", "slide": title_only.id, "shape": title,
                "start": {"paragraph": 0, "offset": 0}, "end": {"paragraph": 0, "offset": 5},
                "props": {"italic": true}}]),
    );
    let text = pres
        .text_layout(using, slide_title, None, fonts())
        .unwrap()
        .unwrap();
    assert!(!text.styles[0].runs[0].italic);
    // It survives a save.
    let mut reopened = reopen(&mut pres);
    let text = reopened
        .text_layout(using, slide_title, None, fonts())
        .unwrap()
        .unwrap();
    assert!(text.styles[0].runs[0].bold);
    assert_eq!(text.styles[0].align, "right");
}

#[test]
fn editing_the_master_changes_every_slide_and_page() {
    let mut pres = kitchen_sink();
    let outline = pres.outline().unwrap();
    let master = outline.masters[0].id;
    let before = render(&mut pres, 2);
    let result = apply(
        &mut pres,
        json!([{"op": "addShape", "slide": master,
                "shape": {"kind": "shape", "preset": "rect"},
                "x": 0, "y": 0, "w": 40, "h": 40}]),
    );
    let created = result.created[0].shape.unwrap();
    assert_eq!(result.changed_slides.len(), outline.slides.len());
    assert_eq!(
        result.changed_layouts.len(),
        1 + outline.masters[0].layouts.len()
    );
    assert!(
        page(&mut pres, master)
            .shapes
            .iter()
            .any(|s| s.id == created)
    );
    // Hiding background graphics on a layout keeps master shapes off it.
    let title_only = layout(&mut pres, "Title Only");
    assert_ne!(render(&mut pres, 2), before);
    let result = apply(
        &mut pres,
        json!([{"op": "setLayoutOptions", "layout": title_only.id,
                "hideBackgroundGraphics": true}]),
    );
    assert!(
        result.structure_changed,
        "Slide Master view shows the option"
    );
    assert!(layout(&mut pres, "Title Only").hide_background_graphics);
    assert_eq!(render(&mut pres, 2), before);
}

#[test]
fn backgrounds_set_on_a_layout_show_on_its_slides() {
    let mut pres = kitchen_sink();
    let title_only = layout(&mut pres, "Title Only");
    apply(
        &mut pres,
        json!([{"op": "setBackground", "slide": title_only.id,
                "fill": {"kind": "solid", "color": "00FF00"}}]),
    );
    let green = |pixels: Vec<u8>| pixels.chunks(4).filter(|p| *p == [0, 255, 0, 255]).count();
    let using = pres.slides().iter().position(|s| s.id == 258).unwrap();
    assert!(green(render(&mut pres, using)) > 1000);
    assert_eq!(
        &render(&mut pres, title_only.id as usize)[..4],
        &[0, 255, 0, 255]
    );
    assert_eq!(green(render(&mut pres, 0)), 0);
}

#[test]
fn insert_layout_adds_a_titled_layout_with_footers() {
    let mut pres = kitchen_sink();
    let blank = layout(&mut pres, "Blank");
    let before = pres.master_pages().unwrap();
    let result = apply(&mut pres, json!([{"op": "addLayout", "after": blank.id}]));
    assert!(result.structure_changed);
    let id = result.created[0].slide;
    assert!(before.iter().all(|p| p.id < id), "ids grow upward");
    let names = layout_names(&mut pres);
    let at = names.iter().position(|n| n == "Blank").unwrap();
    assert_eq!(names[at + 1], "Custom Layout");
    let added = layout(&mut pres, "Custom Layout");
    assert_eq!(added.id, id);
    assert_eq!(added.kind, "cust");
    assert_eq!(added.placeholders, ["title", "dt", "ftr", "sldNum"]);
    // Its title takes the master's place.
    let master = pres.outline().unwrap().masters[0].id;
    let master_title = placeholder(&page(&mut pres, master), "title").clone();
    let title = placeholder(&page(&mut pres, id), "title").clone();
    assert_eq!(
        (title.x, title.y, title.w),
        (master_title.x, master_title.y, master_title.w)
    );
    // A second one is numbered, as PowerPoint names it.
    apply(&mut pres, json!([{"op": "addLayout", "master": master}]));
    assert_eq!(layout_names(&mut pres).last().unwrap(), "1_Custom Layout");
    // Slides can use it, and PowerPoint's rules for ids and relationships hold.
    apply(
        &mut pres,
        json!([{"op": "addSlide", "layout": "Custom Layout", "title": "Hi"}]),
    );
    let mut reopened = reopen(&mut pres);
    assert_eq!(layout(&mut reopened, "Custom Layout").slide_ids.len(), 1);
    assert_eq!(layout_names(&mut reopened).len(), 13);
}

#[test]
fn duplicate_layout_copies_it_next_to_the_original() {
    let mut pres = kitchen_sink();
    let content = layout(&mut pres, "Title and Content");
    let result = apply(
        &mut pres,
        json!([{"op": "addLayout", "duplicate": content.id}]),
    );
    let id = result.created[0].slide;
    let names = layout_names(&mut pres);
    let at = names.iter().position(|n| n == "Title and Content").unwrap();
    assert_eq!(names[at + 1], "1_Title and Content");
    let copy = layout(&mut pres, "1_Title and Content");
    assert_eq!(copy.id, id);
    assert_eq!(copy.placeholders, content.placeholders);
    assert!(copy.slide_ids.is_empty());
    // The copy is a part of its own.
    let body = placeholder(&page(&mut pres, id), "obj").id;
    apply(
        &mut pres,
        json!([{"op": "setText", "slide": id, "shape": body, "text": "Copy"}]),
    );
    let original = page(&mut pres, content.id);
    assert_ne!(placeholder(&original, "obj").paragraphs[0].text, "Copy");
    reopen(&mut pres);
}

#[test]
fn layouts_and_masters_are_renamed() {
    let mut pres = kitchen_sink();
    let blank = layout(&mut pres, "Blank");
    let master = pres.outline().unwrap().masters[0].id;
    let result = apply(
        &mut pres,
        json!([{"op": "renameLayout", "layout": blank.id, "name": "Empty"},
               {"op": "renameLayout", "layout": master, "name": "Quarterly"}]),
    );
    assert!(result.structure_changed);
    let mut reopened = reopen(&mut pres);
    let outline = reopened.outline().unwrap();
    assert_eq!(outline.masters[0].name, "Quarterly");
    assert!(outline.masters[0].layouts.iter().any(|l| l.name == "Empty"));
    assert!(outline.layouts.iter().any(|l| l.name == "Empty"));
    assert!(
        refused(
            &mut pres,
            json!([{"op": "renameLayout", "layout": blank.id, "name": " "}])
        )
        .contains("empty")
    );
}

#[test]
fn only_unused_layouts_are_deleted() {
    let mut pres = kitchen_sink();
    let title_only = layout(&mut pres, "Title Only");
    let error = refused(
        &mut pres,
        json!([{"op": "deleteLayout", "layout": title_only.id}]),
    );
    assert!(
        error.contains("slides 3, 4, 5, 6, 7 and 8 use it"),
        "{error}"
    );
    let blank = layout(&mut pres, "Blank");
    let part = pres
        .master_pages()
        .unwrap()
        .into_iter()
        .find(|p| p.id == blank.id)
        .unwrap()
        .part;
    let result = apply(
        &mut pres,
        json!([{"op": "deleteLayout", "layout": blank.id}]),
    );
    assert!(result.structure_changed);
    assert!(!layout_names(&mut pres).contains(&"Blank".to_owned()));
    assert!(!pres.package().has_part(&part));
    let overridden = pres
        .package()
        .content_types()
        .overrides()
        .any(|(name, _)| name.eq_ignore_ascii_case(&part));
    assert!(!overridden);
    let mut reopened = reopen(&mut pres);
    assert_eq!(layout_names(&mut reopened).len(), 10);
    // The deck's only master stays.
    let master = pres.outline().unwrap().masters[0].id;
    assert!(
        refused(&mut pres, json!([{"op": "deleteLayout", "layout": master}])).contains("slides")
    );
}

#[test]
fn inserted_placeholders_are_inherited_by_new_slides() {
    let mut pres = kitchen_sink();
    let title_only = layout(&mut pres, "Title Only");
    let result = apply(
        &mut pres,
        json!([
            {"op": "insertPlaceholder", "layout": title_only.id, "kind": "picture",
             "x": 60, "y": 150, "w": 300, "h": 200},
            {"op": "insertPlaceholder", "layout": title_only.id, "kind": "content",
             "x": 400, "y": 150, "w": 280, "h": 200, "vertical": null},
        ]),
    );
    let picture = result.created[0].shape.unwrap();
    let content = result.created[1].shape.unwrap();
    let outline = page(&mut pres, title_only.id);
    let pic = outline.shapes.iter().find(|s| s.id == picture).unwrap();
    assert_eq!(pic.placeholder.as_deref(), Some("pic"));
    assert_eq!(pic.paragraphs[0].text, "Picture");
    let obj = outline.shapes.iter().find(|s| s.id == content).unwrap();
    assert_eq!(obj.placeholder.as_deref(), Some("obj"));
    assert_eq!(obj.paragraphs.len(), 5);
    assert_ne!(pic.placeholder_index, obj.placeholder_index);
    assert!(pic.placeholder_index.unwrap() > 12);
    // A new slide gets both, inheriting their place.
    let result = apply(
        &mut pres,
        json!([{"op": "addSlide", "layout": "Title Only"}]),
    );
    let slide = result.created[0].slide;
    let index = pres.slides().iter().position(|s| s.id == slide).unwrap();
    let new = pres.slide_outline(index).unwrap();
    let new_pic = placeholder(&new, "pic");
    assert_eq!(new_pic.placeholder_index, pic.placeholder_index);
    assert_eq!(
        (new_pic.x, new_pic.y, new_pic.w, new_pic.h),
        (60.0, 150.0, 300.0, 200.0)
    );
    assert!(new_pic.paragraphs.is_empty());
    let new_obj = placeholder(&new, "obj");
    assert_eq!((new_obj.x, new_obj.y), (400.0, 150.0));
    // Masters take no inserted placeholders.
    let master = pres.outline().unwrap().masters[0].id;
    assert!(
        refused(
            &mut pres,
            json!([{"op": "insertPlaceholder", "layout": master, "kind": "text",
                "x": 0, "y": 0, "w": 10, "h": 10}])
        )
        .contains("not a slide layout")
    );
    reopen(&mut pres);
}

#[test]
fn title_and_footer_options_add_and_remove_placeholders() {
    let mut pres = kitchen_sink();
    let blank = layout(&mut pres, "Blank");
    assert_eq!(blank.placeholders, ["dt", "ftr", "sldNum"]);
    apply(
        &mut pres,
        json!([{"op": "setLayoutOptions", "layout": blank.id, "title": true, "footers": false}]),
    );
    assert_eq!(layout(&mut pres, "Blank").placeholders, ["title"]);
    apply(
        &mut pres,
        json!([{"op": "setLayoutOptions", "layout": blank.id, "title": false, "footers": true}]),
    );
    assert_eq!(
        layout(&mut pres, "Blank").placeholders,
        ["dt", "ftr", "sldNum"]
    );
    reopen(&mut pres);
}

#[test]
fn duplicated_layout_placeholders_get_their_own_index() {
    let mut pres = kitchen_sink();
    let content = layout(&mut pres, "Title and Content");
    let body = placeholder(&page(&mut pres, content.id), "obj").clone();
    let result = apply(
        &mut pres,
        json!([{"op": "duplicateShape", "slide": content.id, "shape": body.id}]),
    );
    let copy = result.created[0].shape.unwrap();
    let outline = page(&mut pres, content.id);
    let copy = outline.shapes.iter().find(|s| s.id == copy).unwrap();
    assert_ne!(copy.placeholder_index, body.placeholder_index);
}

#[test]
fn slide_operations_refuse_masters_and_layouts() {
    let mut pres = kitchen_sink();
    let blank = layout(&mut pres, "Blank");
    for op in [
        json!({"op": "deleteSlide", "slide": blank.id}),
        json!({"op": "setNotes", "slide": blank.id, "text": "x"}),
        json!({"op": "setSlideLayout", "slide": blank.id, "layout": "Blank"}),
    ] {
        let error = refused(&mut pres, json!([op]));
        assert!(error.contains("slide master or layout"), "{error}");
    }
}

#[test]
fn layout_edits_undo_and_redo() {
    let mut editor = Editor::new(kitchen_sink());
    let blank = layout(editor.presentation_mut(), "Blank");
    let ops: Vec<EditOp> = serde_json::from_value(json!([
        {"op": "addLayout", "after": blank.id},
        {"op": "renameLayout", "layout": blank.id, "name": "Nothing"},
    ]))
    .unwrap();
    editor.apply(&ops, None, fonts()).unwrap();
    assert_eq!(layout_names(editor.presentation_mut()).len(), 12);
    let undone = editor.undo().unwrap();
    assert!(undone.structure_changed);
    let names = layout_names(editor.presentation_mut());
    assert_eq!(names.len(), 11);
    assert!(names.contains(&"Blank".to_owned()));
    editor.redo().unwrap();
    assert!(layout_names(editor.presentation_mut()).contains(&"Nothing".to_owned()));
}

#[test]
fn collaborators_receive_new_and_edited_layouts() {
    let mut seeding = kitchen_sink();
    seeding.enable_collab(1);
    let entries = crate::collab::Entries::from_changes(&seeding.collab_changes().unwrap());
    let mut a = Presentation::from_entries(entries.clone(), 2).unwrap();
    let mut b = Presentation::from_entries(entries, 3).unwrap();
    let blank = layout(&mut a, "Blank");
    apply(
        &mut a,
        json!([{"op": "addLayout", "after": blank.id, "name": "Shared"},
               {"op": "setLayoutOptions", "layout": blank.id, "title": true}]),
    );
    let changes = a.collab_changes().unwrap();
    let result = b.apply_collab_changes(&changes).unwrap();
    assert!(result.structure_changed);
    assert!(result.changed_layouts.contains(&blank.id));
    assert_eq!(layout_names(&mut b), layout_names(&mut a));
    assert_eq!(layout(&mut b, "Blank").placeholders[0], "title");
    let shared = layout(&mut b, "Shared");
    assert!(shared.id >= MASTER_ID_BASE);
    reopen(&mut b);
}

/// Saves a deck with new, duplicated, renamed, and deleted layouts and
/// inserted placeholders, and has LibreOffice convert it to PDF. Needs
/// `soffice` (LibreOffice with Impress).
#[test]
#[ignore = "needs LibreOffice (soffice)"]
fn libreoffice_opens_a_deck_with_edited_layouts() {
    let mut pres = kitchen_sink();
    let blank = layout(&mut pres, "Blank");
    let content = layout(&mut pres, "Title and Content");
    let result = apply(
        &mut pres,
        json!([
            {"op": "addLayout", "after": blank.id, "name": "Quarter"},
            {"op": "addLayout", "duplicate": content.id},
            {"op": "deleteLayout", "layout": blank.id},
        ]),
    );
    let quarter = result.created[0].slide;
    apply(
        &mut pres,
        json!([
            {"op": "insertPlaceholder", "layout": quarter, "kind": "picture",
             "x": 60, "y": 150, "w": 300, "h": 200},
            {"op": "insertPlaceholder", "layout": quarter, "kind": "text",
             "x": 400, "y": 150, "w": 280, "h": 200},
            {"op": "addSlide", "layout": "Quarter", "title": "From a new layout"},
        ]),
    );
    let bytes = reopen(&mut pres).save().unwrap();
    let dir = std::env::temp_dir().join(format!("pptx-masters-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("layouts.pptx");
    std::fs::write(&input, bytes).unwrap();
    let status = std::process::Command::new("soffice")
        .arg(format!(
            "-env:UserInstallation=file://{}",
            dir.join("profile").display()
        ))
        .args(["--headless", "--convert-to", "pdf", "--outdir"])
        .arg(&dir)
        .arg(&input)
        .status();
    let Ok(status) = status else {
        eprintln!("soffice is not installed; skipping");
        return;
    };
    assert!(status.success());
    let pdf = std::fs::metadata(dir.join("layouts.pdf")).unwrap();
    assert!(pdf.len() > 1000);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn masters_and_layouts_listed_without_ids_get_lasting_ones() {
    // PowerPoint 2008 for Mac lists masters and layouts without ids.
    let mut pres = Presentation::open(crate::test_support::deck(&[""])).unwrap();
    for part in [
        "/ppt/presentation.xml",
        "/ppt/slideMasters/slideMaster1.xml",
    ] {
        let doc = pres.xml_mut(part).unwrap();
        for node in doc.descendants(doc.root()) {
            if matches!(doc.local(node), "sldMasterId" | "sldLayoutId") {
                doc.remove_attr(node, "id");
            }
        }
    }
    let mut pres = Presentation::open(pres.save().unwrap()).unwrap();
    let pages = pres.master_pages().unwrap();
    let ids: Vec<(u32, bool)> = pages.iter().map(|p| (p.id, p.stored)).collect();
    assert_eq!(ids, [(MASTER_ID_BASE, false), (MASTER_ID_BASE + 1, false)]);
    assert_eq!(pages[1].master, MASTER_ID_BASE);
    assert!(pres.integrity_problems().unwrap().is_empty());
    // They read and render by those ids, and keep them when the lists change.
    let layout = MASTER_ID_BASE + 1;
    assert_eq!(page(&mut pres, layout).layout, "Title and Content");
    let result = apply(&mut pres, json!([{"op": "addLayout", "after": layout}]));
    assert_eq!(result.created[0].slide, MASTER_ID_BASE + 2);
    let mut reopened = reopen(&mut pres);
    let pages = reopened.master_pages().unwrap();
    let ids: Vec<(u32, bool)> = pages.iter().map(|p| (p.id, p.stored)).collect();
    assert_eq!(
        ids,
        [
            (MASTER_ID_BASE, true),
            (MASTER_ID_BASE + 1, true),
            (MASTER_ID_BASE + 2, true)
        ]
    );
}
