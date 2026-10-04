use super::{AUTHORS_REL, LEGACY_AUTHORS_REL, MODERN_COMMENTS_REL};
use crate::edit::{EditOp, EditResult, Editor};
use crate::inspect::CommentOutline;
use crate::model::field::FieldTime;
use crate::model::presentation::Presentation;
use crate::opc::rel_type;
use crate::test_support::{deck, fonts, text_box};

const P188_NS: &str = "http://schemas.microsoft.com/office/powerpoint/2018/8/main";
const PC_NS: &str = "http://schemas.microsoft.com/office/powerpoint/2013/main/command";
const AC_NS: &str = "http://schemas.microsoft.com/office/drawing/2013/main/command";
const A_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P_NS: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const P15_NS: &str = "http://schemas.microsoft.com/office/powerpoint/2012/main";
const MODERN_TYPE: &str = "application/vnd.ms-powerpoint.comments+xml";
const AUTHORS_TYPE: &str = "application/vnd.ms-powerpoint.authors+xml";

const ANN: &str = "{11111111-2222-4333-8444-555555555555}";
const BEN: &str = "{66666666-7777-4888-8999-AAAAAAAAAAAA}";

fn shape(id: u32, text: &str) -> String {
    text_box(
        id,
        1_270_000,
        635_000,
        2_540_000,
        635_000,
        &format!("<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>{text}</a:t></a:r></a:p>"),
    )
}

/// Two slides (ids 256 and 257), each with text box 2.
fn two_slides() -> Presentation {
    let a = shape(2, "Revenue");
    let b = shape(2, "Costs");
    let mut pres = Presentation::open(deck(&[&a, &b])).unwrap();
    pres.set_clock(Some(FieldTime::from_unix(1_790_000_000, 0)));
    pres
}

fn apply(pres: &mut Presentation, ops: Vec<EditOp>) -> EditResult {
    pres.apply(&ops, fonts()).unwrap()
}

fn comments(pres: &mut Presentation, index: usize) -> Vec<CommentOutline> {
    pres.slide_outline(index).unwrap().comments
}

fn add(slide: u32, text: &str, author: &str) -> EditOp {
    EditOp::AddComment {
        slide,
        text: text.into(),
        author: author.into(),
        initials: None,
        x: None,
        y: None,
        shape: None,
    }
}

/// Adds parts (`(name, xml, content type)`) and relationships
/// (`(source part, type, target part)`) to a deck, as another program would.
fn inject(pres: &mut Presentation, parts: &[(&str, String, &str)], rels: &[(&str, &str, &str)]) {
    for (name, xml, ct) in parts {
        pres.pkg.write(name, xml.as_bytes().to_vec(), Some(ct));
    }
    for (source, ty, target) in rels {
        pres.rels_mut(source).unwrap().add_internal(ty, target);
    }
    pres.flush();
}

fn reopen(pres: &mut Presentation) -> Presentation {
    Presentation::open(pres.save().unwrap()).unwrap()
}

fn part_text(pres: &Presentation, part: &str) -> String {
    String::from_utf8(pres.read_bytes(part).unwrap()).unwrap()
}

/// Names of the parts in the package under `prefix`.
fn parts_under(pres: &Presentation, prefix: &str) -> Vec<String> {
    pres.pkg
        .part_names()
        .filter(|n| n.starts_with(prefix))
        .map(str::to_owned)
        .collect()
}

fn rel_count(pres: &mut Presentation, part: &str, ty: &str) -> usize {
    pres.part_rels(part)
        .unwrap()
        .iter()
        .filter(|r| r.rel_type == ty)
        .count()
}

fn modern_part(created: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p188:cmLst xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p188="{P188_NS}"><p188:cm id="{{A1B2C3D4-0000-4000-8000-000000000001}}" authorId="{ANN}" created="{created}" status="resolved"><pc:sldMkLst xmlns:pc="{PC_NS}"><pc:docMk/><pc:sldMk cId="3409046735" sldId="256"/></pc:sldMkLst><p188:pos x="1270000" y="635000"/><p188:replyLst><p188:reply id="{{A1B2C3D4-0000-4000-8000-000000000002}}" authorId="{BEN}" created="2023-05-01T11:00:00.000"><p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Agreed.</a:t></a:r></a:p></p188:txBody></p188:reply></p188:replyLst><p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>First line</a:t></a:r></a:p><a:p><a:r><a:rPr lang="en-US"/><a:t>Second line</a:t></a:r></a:p></p188:txBody></p188:cm><p188:cm id="{{A1B2C3D4-0000-4000-8000-000000000003}}" authorId="{BEN}" created="2023-05-02T09:30:00.000"><ac:deMkLst xmlns:ac="{AC_NS}"><pc:docMk xmlns:pc="{PC_NS}"/><pc:sldMk xmlns:pc="{PC_NS}" cId="3409046735" sldId="256"/><ac:spMk id="2" creationId="{{0F0E0D0C-0B0A-4908-8706-050403020100}}"/></ac:deMkLst><p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>About this box</a:t></a:r></a:p></p188:txBody></p188:cm><p188:cm id="{{A1B2C3D4-0000-4000-8000-000000000004}}" authorId="{{99999999-9999-4999-8999-999999999999}}" created="2023-05-03T08:00:00.000"><ac:txMkLst xmlns:ac="{AC_NS}"><pc:docMk xmlns:pc="{PC_NS}"/><pc:sldMk xmlns:pc="{PC_NS}" cId="3409046735" sldId="256"/><ac:spMk id="2" creationId="{{0F0E0D0C-0B0A-4908-8706-050403020100}}"/><ac:txMk cp="0" len="7"><ac:context len="8" hash="1234"/></ac:txMk></ac:txMkLst><p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>On the word</a:t></a:r></a:p></p188:txBody></p188:cm></p188:cmLst>"#
    )
}

fn modern_authors() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p188:authorLst xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p188="{P188_NS}"><p188:author id="{ANN}" name="Ann Lee" initials="AL" userId="ann@example.com" providerId="AD"/><p188:author id="{BEN}" name="Ben Ray" initials="BR" userId="Ben Ray" providerId="None"/></p188:authorLst>"#
    )
}

/// A deck whose first slide has threaded comments as PowerPoint 365 writes them.
fn with_modern_comments() -> Presentation {
    let mut pres = two_slides();
    let slide = pres.slide_part(256).unwrap();
    let main = pres.main_part.clone();
    inject(
        &mut pres,
        &[
            (
                "/ppt/comments/modernComment_100_CB3A4F4F.xml",
                modern_part("2023-05-01T10:00:00.123"),
                MODERN_TYPE,
            ),
            ("/ppt/authors.xml", modern_authors(), AUTHORS_TYPE),
        ],
        &[
            (
                &slide,
                MODERN_COMMENTS_REL,
                "/ppt/comments/modernComment_100_CB3A4F4F.xml",
            ),
            (&main, AUTHORS_REL, "/ppt/authors.xml"),
        ],
    );
    reopen(&mut pres)
}

fn legacy_part() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:cmLst xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}"><p:cm authorId="0" dt="2016-02-03T09:00:00.000" idx="1"><p:pos x="400" y="300"/><p:text>Check the date format.</p:text></p:cm><p:cm authorId="1" dt="2016-02-03T10:00:00.000" idx="1"><p:pos x="400" y="300"/><p:text>Fixed.</p:text><p:extLst><p:ext uri="{{C676402C-5697-4E1C-873F-D02D1690AC5C}}"><p15:threadingInfo xmlns:p15="{P15_NS}" timeZoneBias="-60"><p15:parentCm authorId="0" idx="1"/></p15:threadingInfo></p:ext></p:extLst></p:cm><p:cm authorId="0" dt="2016-02-04T09:00:00.000" idx="2"><p:pos x="10" y="10"/><p:text>Second thread.</p:text></p:cm></p:cmLst>"#
    )
}

fn legacy_authors() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:cmAuthorLst xmlns:a="{A_NS}" xmlns:r="{R_NS}" xmlns:p="{P_NS}"><p:cmAuthor id="0" name="Corpus Reviewer" initials="CR" lastIdx="2" clrIdx="0"/><p:cmAuthor id="1" name="Second Reader" initials="SR" lastIdx="1" clrIdx="1"/></p:cmAuthorLst>"#
    )
}

/// A deck whose second slide has comments in the pre-2021 format.
fn with_legacy_comments() -> Presentation {
    let mut pres = two_slides();
    let slide = pres.slide_part(257).unwrap();
    let main = pres.main_part.clone();
    inject(
        &mut pres,
        &[
            (
                "/ppt/comments/comment1.xml",
                legacy_part(),
                "application/vnd.openxmlformats-officedocument.presentationml.comments+xml",
            ),
            (
                "/ppt/commentAuthors.xml",
                legacy_authors(),
                "application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml",
            ),
        ],
        &[
            (&slide, rel_type::COMMENTS, "/ppt/comments/comment1.xml"),
            (&main, LEGACY_AUTHORS_REL, "/ppt/commentAuthors.xml"),
        ],
    );
    reopen(&mut pres)
}

#[test]
fn reads_threaded_comments_as_powerpoint_writes_them() {
    let mut pres = with_modern_comments();
    let list = comments(&mut pres, 0);
    assert_eq!(list.len(), 3);

    let first = &list[0];
    assert_eq!(first.id, "{A1B2C3D4-0000-4000-8000-000000000001}");
    assert_eq!(
        (first.author.as_str(), first.initials.as_str()),
        ("Ann Lee", "AL")
    );
    assert_eq!(first.text, "First line\nSecond line");
    assert_eq!(first.created.as_deref(), Some("2023-05-01T10:00:00.123Z"));
    assert!(first.resolved && !first.legacy);
    assert_eq!((first.x, first.y), (Some(100.0), Some(50.0)));
    assert_eq!(first.shape, None);
    assert_eq!(first.replies.len(), 1);
    assert_eq!(first.replies[0].author, "Ben Ray");
    assert_eq!(first.replies[0].text, "Agreed.");

    // Attached to a shape, and to text in a shape.
    assert_eq!(list[1].shape, Some(2));
    assert!(!list[1].resolved);
    assert_eq!(list[2].shape, Some(2));
    // An author missing from the list.
    assert_eq!(list[2].author, "Unknown");
    assert!(comments(&mut pres, 1).is_empty());
}

#[test]
fn reads_legacy_comments_with_replies() {
    let mut pres = with_legacy_comments();
    let list = comments(&mut pres, 1);
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, "legacy-0-1");
    assert_eq!(list[0].author, "Corpus Reviewer");
    assert_eq!(list[0].initials, "CR");
    assert_eq!(list[0].text, "Check the date format.");
    assert!(list[0].legacy);
    // Master units: 8 per point.
    assert_eq!((list[0].x, list[0].y), (Some(50.0), Some(37.5)));
    assert_eq!(list[0].created.as_deref(), Some("2016-02-03T09:00:00.000"));
    assert_eq!(list[0].replies.len(), 1);
    assert_eq!(list[0].replies[0].author, "Second Reader");
    assert_eq!(list[0].replies[0].text, "Fixed.");
    assert_eq!(list[1].id, "legacy-0-2");
}

#[test]
fn new_comments_are_written_as_powerpoint_365_writes_them() {
    let mut pres = two_slides();
    let result = apply(&mut pres, vec![add(256, "Check this\nnumber", "Ann Lee")]);
    assert_eq!(result.changed_slides, vec![256]);

    let mut pres = reopen(&mut pres);
    let list = comments(&mut pres, 0);
    assert_eq!(list.len(), 1);
    let c = &list[0];
    assert_eq!((c.author.as_str(), c.initials.as_str()), ("Ann Lee", "AL"));
    assert_eq!(c.text, "Check this\nnumber");
    assert!(c.id.starts_with('{') && c.id.ends_with('}') && c.id.len() == 38);
    assert_eq!(c.created.as_deref(), Some("2026-09-21T14:13:20.000Z"));
    assert_eq!((c.shape, c.x, c.y), (None, None, None));

    // Parts, relationships, and content types.
    let slide = pres.slide_part(256).unwrap();
    let parts = parts_under(&pres, "/ppt/comments/");
    assert_eq!(parts.len(), 1);
    let part = &parts[0];
    let cid = {
        let doc = pres.xml(&slide).unwrap();
        let ext = doc
            .descendants(doc.root())
            .into_iter()
            .find(|&n| doc.local(n) == "creationId")
            .unwrap();
        doc.attr_i64(ext, "val").unwrap()
    };
    assert_eq!(
        part,
        &format!("/ppt/comments/modernComment_100_{cid:X}.xml")
    );
    assert_eq!(pres.pkg.content_type(part), Some(MODERN_TYPE));
    assert_eq!(
        pres.pkg.content_type("/ppt/authors.xml"),
        Some(AUTHORS_TYPE)
    );
    assert_eq!(rel_count(&mut pres, &slide, MODERN_COMMENTS_REL), 1);
    let main = pres.main_part.clone();
    assert_eq!(rel_count(&mut pres, &main, AUTHORS_REL), 1);

    // The slide names its comments part.
    let slide_xml = part_text(&pres, &slide);
    let rid = pres
        .part_rels(&slide)
        .unwrap()
        .iter()
        .find(|r| r.rel_type == MODERN_COMMENTS_REL)
        .unwrap()
        .id
        .clone();
    assert!(slide_xml.contains(&format!(
        "<p:ext uri=\"{{6950BFC3-D8DA-4A85-94F7-54DA5524770B}}\"><p188:commentRel xmlns:p188=\"{P188_NS}\" r:id=\"{rid}\"/></p:ext>"
    )));
    assert!(
        slide_xml.contains("<p:ext uri=\"{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}\"><p14:creationId")
    );
    // The extension list stays the slide's last child.
    assert!(slide_xml.trim_end().ends_with("</p:extLst></p:sld>"));

    let xml = part_text(&pres, part);
    assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"));
    assert!(xml.contains(&format!("<p188:cm id=\"{}\" authorId=\"", c.id)));
    assert!(xml.contains(&format!(
        "<pc:sldMkLst xmlns:pc=\"{PC_NS}\"><pc:docMk/><pc:sldMk cId=\"{cid}\" sldId=\"256\"/></pc:sldMkLst><p188:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Check this</a:t></a:r></a:p>"
    )));
    let authors = part_text(&pres, "/ppt/authors.xml");
    assert!(
        authors
            .contains("name=\"Ann Lee\" initials=\"AL\" userId=\"Ann Lee\" providerId=\"None\"/>")
    );
}

#[test]
fn comments_on_shapes_and_positions() {
    let mut pres = two_slides();
    apply(
        &mut pres,
        vec![
            EditOp::AddComment {
                slide: 256,
                text: "About the box".into(),
                author: "Ann Lee".into(),
                initials: Some("A".into()),
                x: None,
                y: None,
                shape: Some(2),
            },
            EditOp::AddComment {
                slide: 256,
                text: "Over here".into(),
                author: "Ann Lee".into(),
                initials: None,
                x: Some(120.0),
                y: Some(40.5),
                shape: None,
            },
        ],
    );
    let mut pres = reopen(&mut pres);
    let list = comments(&mut pres, 0);
    assert_eq!(list[0].shape, Some(2));
    assert_eq!((list[1].x, list[1].y), (Some(120.0), Some(40.5)));
    // One author entry for both comments (the first initials win).
    assert_eq!(list[1].initials, "A");

    let slide = pres.slide_part(256).unwrap();
    let slide_xml = part_text(&pres, &slide);
    let creation = slide_xml
        .split("<a16:creationId ")
        .nth(1)
        .and_then(|s| s.split("id=\"").nth(1))
        .and_then(|s| s.split('"').next())
        .unwrap()
        .to_owned();
    assert!(slide_xml.contains(
        "<a:extLst><a:ext uri=\"{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}\"><a16:creationId xmlns:a16=\"http://schemas.microsoft.com/office/drawing/2014/main\""
    ));
    let part = parts_under(&pres, "/ppt/comments/").remove(0);
    let xml = part_text(&pres, &part);
    assert!(
        xml.contains(&format!(
            "<ac:deMkLst xmlns:ac=\"{AC_NS}\" xmlns:pc=\"{PC_NS}\"><pc:docMk/><pc:sldMk cId=\""
        )),
        "{xml}"
    );
    assert!(xml.contains(&format!(
        "<ac:spMk id=\"2\" creationId=\"{creation}\"/></ac:deMkLst>"
    )));
    assert!(xml.contains("<p188:pos x=\"1524000\" y=\"514350\"/>"));
    let authors = part_text(&pres, "/ppt/authors.xml");
    assert_eq!(authors.matches("<p188:author ").count(), 1);
}

#[test]
fn replies_edits_resolving_and_deleting() {
    let mut pres = with_modern_comments();
    let thread = "{A1B2C3D4-0000-4000-8000-000000000003}";
    apply(
        &mut pres,
        vec![
            EditOp::ReplyComment {
                slide: 256,
                comment: thread.into(),
                text: "On it".into(),
                author: "Cat Diaz".into(),
                initials: None,
            },
            EditOp::ResolveComment {
                slide: 256,
                comment: thread.into(),
                resolved: true,
            },
            EditOp::ResolveComment {
                slide: 256,
                comment: "{A1B2C3D4-0000-4000-8000-000000000001}".into(),
                resolved: false,
            },
            EditOp::EditComment {
                slide: 256,
                comment: "{A1B2C3D4-0000-4000-8000-000000000002}".into(),
                text: "Agreed, thanks.".into(),
            },
        ],
    );
    let mut pres = reopen(&mut pres);
    let list = comments(&mut pres, 0);
    assert!(!list[0].resolved);
    assert_eq!(list[0].replies[0].text, "Agreed, thanks.");
    assert!(list[1].resolved);
    assert_eq!(list[1].replies.len(), 1);
    let reply = list[1].replies[0].clone();
    assert_eq!(
        (reply.author.as_str(), reply.initials.as_str()),
        ("Cat Diaz", "CD")
    );
    assert_eq!(reply.text, "On it");
    // The new author joins PowerPoint's authors list.
    let authors = part_text(&pres, "/ppt/authors.xml");
    assert!(authors.contains("name=\"Ann Lee\"") && authors.contains("name=\"Cat Diaz\""));

    // Replies cannot be replied to or resolved.
    let err = pres.apply(
        &[EditOp::ResolveComment {
            slide: 256,
            comment: reply.id.clone(),
            resolved: true,
        }],
        fonts(),
    );
    assert!(err.is_err());

    // Deleting a reply keeps the thread; deleting the last thread drops the part.
    apply(
        &mut pres,
        vec![EditOp::DeleteComment {
            slide: 256,
            comment: reply.id,
        }],
    );
    let list = comments(&mut pres, 0);
    assert_eq!(list.len(), 3);
    assert!(list[1].replies.is_empty());
    let part = "/ppt/comments/modernComment_100_CB3A4F4F.xml";
    assert!(!part_text(&pres, part).contains("replyLst></p188:cm"));
    apply(
        &mut pres,
        list.iter()
            .map(|c| EditOp::DeleteComment {
                slide: 256,
                comment: c.id.clone(),
            })
            .collect(),
    );
    assert!(comments(&mut pres, 0).is_empty());
    let mut pres = reopen(&mut pres);
    assert!(parts_under(&pres, "/ppt/comments/").is_empty());
    assert_ne!(pres.pkg.content_type(part), Some(MODERN_TYPE));
    let slide = pres.slide_part(256).unwrap();
    assert_eq!(rel_count(&mut pres, &slide, MODERN_COMMENTS_REL), 0);
    assert!(!part_text(&pres, &slide).contains("commentRel"));
    // Authors stay, as in PowerPoint.
    assert!(pres.pkg.has_part("/ppt/authors.xml"));
}

#[test]
fn slides_written_by_us_lose_the_comment_reference_when_emptied() {
    let mut pres = two_slides();
    apply(&mut pres, vec![add(257, "One", "Ann Lee")]);
    let id = comments(&mut pres, 1)[0].id.clone();
    apply(
        &mut pres,
        vec![EditOp::DeleteComment {
            slide: 257,
            comment: id,
        }],
    );
    let slide = pres.slide_part(257).unwrap();
    let xml = part_text(&pres, &slide);
    assert!(!xml.contains("commentRel"));
    // The creation id stays; it identifies the slide.
    assert!(xml.contains("p14:creationId"));
    assert!(parts_under(&pres, "/ppt/comments/").is_empty());
}

#[test]
fn legacy_comments_survive_and_can_be_edited_and_deleted() {
    let mut pres = with_legacy_comments();
    let before = part_text(&pres, "/ppt/comments/comment1.xml");
    // A threaded comment elsewhere leaves the legacy part untouched.
    apply(&mut pres, vec![add(256, "New style", "Ann Lee")]);
    let mut pres = reopen(&mut pres);
    assert_eq!(part_text(&pres, "/ppt/comments/comment1.xml"), before);
    assert!(pres.pkg.has_part("/ppt/commentAuthors.xml"));
    assert_eq!(comments(&mut pres, 1).len(), 2);
    assert_eq!(comments(&mut pres, 0).len(), 1);

    // No replies or resolving in the old format.
    for op in [
        EditOp::ReplyComment {
            slide: 257,
            comment: "legacy-0-1".into(),
            text: "x".into(),
            author: "Ann Lee".into(),
            initials: None,
        },
        EditOp::ResolveComment {
            slide: 257,
            comment: "legacy-0-1".into(),
            resolved: true,
        },
    ] {
        let err = pres.apply(&[op], fonts()).unwrap_err().to_string();
        assert!(err.contains("legacy"), "{err}");
    }

    apply(
        &mut pres,
        vec![EditOp::EditComment {
            slide: 257,
            comment: "legacy-0-2".into(),
            text: "Edited & kept".into(),
        }],
    );
    assert_eq!(comments(&mut pres, 1)[1].text, "Edited & kept");
    // Deleting a thread takes its replies along.
    apply(
        &mut pres,
        vec![EditOp::DeleteComment {
            slide: 257,
            comment: "legacy-0-1".into(),
        }],
    );
    let list = comments(&mut pres, 1);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "legacy-0-2");
    apply(
        &mut pres,
        vec![EditOp::DeleteComment {
            slide: 257,
            comment: "legacy-0-2".into(),
        }],
    );
    let mut pres = reopen(&mut pres);
    assert!(!pres.pkg.has_part("/ppt/comments/comment1.xml"));
    let slide = pres.slide_part(257).unwrap();
    assert_eq!(rel_count(&mut pres, &slide, rel_type::COMMENTS), 0);
}

#[test]
fn delete_all_comments_on_a_slide_or_everywhere() {
    let mut pres = with_legacy_comments();
    apply(
        &mut pres,
        vec![add(256, "A", "Ann Lee"), add(257, "B", "Ann Lee")],
    );
    assert_eq!(comments(&mut pres, 1).len(), 3);
    apply(
        &mut pres,
        vec![EditOp::DeleteAllComments { slide: Some(257) }],
    );
    assert!(comments(&mut pres, 1).is_empty());
    assert_eq!(comments(&mut pres, 0).len(), 1);
    assert!(!pres.pkg.has_part("/ppt/comments/comment1.xml"));
    apply(&mut pres, vec![EditOp::DeleteAllComments { slide: None }]);
    assert!(comments(&mut pres, 0).is_empty());
    assert!(parts_under(&pres, "/ppt/comments/").is_empty());
    reopen(&mut pres);
}

#[test]
fn copied_and_deleted_slides_keep_comment_parts_consistent() {
    let mut pres = two_slides();
    apply(&mut pres, vec![add(256, "Keep me", "Ann Lee")]);
    let result = apply(&mut pres, vec![EditOp::DuplicateSlide { slide: 256 }]);
    let copy = result.created[0].slide;
    // The copy has no comments and no reference to the original's part.
    let index = pres.slides().iter().position(|s| s.id == copy).unwrap();
    assert!(comments(&mut pres, index).is_empty());
    let copy_part = pres.slide_part(copy).unwrap();
    assert!(!part_text(&pres, &copy_part).contains("commentRel"));
    assert_eq!(rel_count(&mut pres, &copy_part, MODERN_COMMENTS_REL), 0);
    assert_eq!(comments(&mut pres, 0).len(), 1);

    // Copy and paste across decks.
    let payload = pres.copy_slides(&[256]).unwrap();
    let mut other = two_slides();
    let pasted = apply(
        &mut other,
        vec![EditOp::PasteSlides {
            after: None,
            payload: serde_json::to_string(&payload).unwrap(),
        }],
    );
    let pasted = other.slide_part(pasted.created[0].slide).unwrap();
    assert!(!part_text(&other, &pasted).contains("commentRel"));
    assert!(parts_under(&other, "/ppt/comments/").is_empty());

    // Deleting the slide deletes its comments part.
    apply(&mut pres, vec![EditOp::DeleteSlide { slide: 256 }]);
    let mut pres = reopen(&mut pres);
    assert!(parts_under(&pres, "/ppt/comments/").is_empty());
    for i in 0..pres.slides().len() {
        assert!(comments(&mut pres, i).is_empty());
    }
}

#[test]
fn comment_edits_are_undo_steps() {
    let mut ed = Editor::new(two_slides());
    ed.apply(&[add(256, "Undo me", "Ann Lee")], None, fonts())
        .unwrap();
    assert_eq!(comments(ed.presentation_mut(), 0).len(), 1);
    let id = comments(ed.presentation_mut(), 0)[0].id.clone();
    let result = ed
        .apply(
            &[EditOp::EditComment {
                slide: 256,
                comment: id,
                text: "Changed".into(),
            }],
            None,
            fonts(),
        )
        .unwrap();
    // Editing only the comments part still reports the slide.
    assert_eq!(result.changed_slides, vec![256]);
    ed.undo().unwrap();
    assert_eq!(comments(ed.presentation_mut(), 0)[0].text, "Undo me");
    ed.undo().unwrap();
    assert!(comments(ed.presentation_mut(), 0).is_empty());
}

#[test]
fn bad_comment_ops_are_refused() {
    let mut pres = two_slides();
    for op in [
        add(256, "  ", "Ann Lee"),
        add(256, "Text", " "),
        add(999, "Text", "Ann Lee"),
        EditOp::AddComment {
            slide: 256,
            text: "x".into(),
            author: "Ann Lee".into(),
            initials: None,
            x: None,
            y: None,
            shape: Some(77),
        },
        EditOp::DeleteComment {
            slide: 256,
            comment: "{00000000-0000-4000-8000-000000000000}".into(),
        },
    ] {
        assert!(pres.apply(&[op], fonts()).is_err());
    }
    // Nothing was left behind by the refused batches.
    assert!(parts_under(&pres, "/ppt/comments/").is_empty());
    assert!(!pres.pkg.has_part("/ppt/authors.xml"));
}

#[test]
fn ops_read_null_optional_fields_as_omitted() {
    let op: EditOp = serde_json::from_str(
        r#"{"op":"addComment","slide":256,"text":"Hi","author":"AI","initials":null,"x":null,"y":null,"shape":null}"#,
    )
    .unwrap();
    assert_eq!(op, add(256, "Hi", "AI"));
    let op: EditOp = serde_json::from_str(r#"{"op":"deleteAllComments","slide":null}"#).unwrap();
    assert_eq!(op, EditOp::DeleteAllComments { slide: None });
}
