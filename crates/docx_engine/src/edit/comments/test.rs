use super::super::test_util::*;
use super::super::*;
use crate::test_support::Parts;

const BODY: &str = r#"<w:p><w:r><w:t xml:space="preserve">The </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>Purchase Price</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:t xml:space="preserve"> is due.</w:t></w:r></w:p><w:p><w:r><w:t>Closing</w:t></w:r><w:r><w:commentReference w:id="2"/></w:r></w:p>"#;

const COMMENTS: &str = r#"<w:comment w:id="0" w:author="Opposing Counsel" w:date="2026-09-30T10:00:00Z" w:initials="OC"><w:p w14:paraId="1A2B3C4D"><w:r><w:t>Should this include</w:t></w:r><w:r><w:tab/><w:t>fees?</w:t></w:r></w:p></w:comment><w:comment w:id="1" w:author="Us" w:date="2026-10-01T09:00:00Z"><w:p w14:paraId="5E6F7A8B"><w:r><w:t>No.</w:t></w:r></w:p></w:comment><w:comment w:id="2" w:author="Us"><w:p w14:paraId="0C0C0C0C"><w:r><w:t>Date to be confirmed.</w:t></w:r></w:p></w:comment>"#;

const THREADS: &str = r#"<w15:commentEx w15:paraId="1A2B3C4D" w15:done="1"/><w15:commentEx w15:paraId="5E6F7A8B" w15:paraIdParent="1A2B3C4D" w15:done="0"/>"#;

#[test]
fn word_comments_come_with_their_text_threads_and_ranges() {
    // The reply has no range of its own here; it is left out of the body
    // but still listed under its parent.
    let body = BODY.replace(
        r#"<w:r><w:commentReference w:id="0"/></w:r>"#,
        r#"<w:r><w:commentReference w:id="0"/></w:r><w:r><w:commentReference w:id="1"/></w:r>"#,
    );
    let s = open_with(
        &body,
        &Parts {
            comments: Some(COMMENTS),
            comments_extended: Some(THREADS),
            ..Parts::default()
        },
    );
    let comments = s.document_comments();
    let ids: Vec<&str> = comments.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, vec!["0", "1", "2"]);
    let first = &comments[0];
    assert_eq!(first.author, "Opposing Counsel");
    assert_eq!(first.initials.as_deref(), Some("OC"));
    assert_eq!(first.text, "Should this include\tfees?");
    assert!(first.done);
    assert_eq!(first.parent, None);
    // The range covers "Purchase Price" (after the start marker).
    let p0 = para(&s, 0);
    assert_eq!(first.from, Pos::new(p0.clone(), 5));
    assert_eq!(first.to, Pos::new(p0, 19));
    // The reply is threaded under the first comment.
    assert_eq!(comments[1].parent.as_deref(), Some("0"));
    assert!(!comments[1].done);
    // A comment on a point (a reference without a range).
    let p1 = para(&s, 1);
    assert_eq!(comments[2].from, Pos::new(p1.clone(), 7));
    assert_eq!(comments[2].to, Pos::new(p1, 7));
    assert_eq!(comments[2].date, None);
}

#[test]
fn documents_without_comments_have_none() {
    let s = open(&p("Plain"));
    assert!(s.document_comments().is_empty());
}
