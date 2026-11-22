use super::*;

#[test]
fn commit_flush_reports_first_deferred_failure_before_secondary_native_error() -> Result<()> {
    let editor = Editor::builder(EditorMode::Headless)
        .transform::<Text>(|_, _| {
            ForeignReadOperation::defer(Error::Invariant("first flush failure"))?;
            Err(Error::Invariant("secondary native failure"))
        })
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    host.begin_update(TagSet::default())?;
    host.with_update(|_, tx| {
        let paragraph = tx.create(Paragraph::default())?.key();
        let text = tx.create_text("unpublished")?.key();
        tx.append(paragraph, &[text])?;
        tx.append(NodeKey::ROOT, &[paragraph])?;
        Ok(())
    })?;
    let error = host.commit().expect_err("failed commit");
    assert_eq!(error.to_string(), "first flush failure");
    assert!(host.pending.is_none());
    assert_eq!(host.state().root_text_content().as_ref(), "");
    assert!(!ForeignReadOperation::is_active());
    host.begin_update(TagSet::default())?;
    host.discard_update()?;
    Ok(())
}

#[test]
fn commit_preparation_reports_first_deferred_failure_before_secondary_artifact_error() -> Result<()>
{
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut host = Session::new(editor);
    host.begin_update(TagSet::default())?;
    host.with_update(|_, tx| {
        let paragraph = tx.create(Paragraph::default())?.key();
        tx.append(NodeKey::ROOT, &[paragraph])?;
        Ok(())
    })?;
    let result: Result<(Commit, ())> = host.commit_prepared(|_, _| {
        ForeignReadOperation::defer(Error::Invariant("first preparation failure"))?;
        Err(fail("secondary artifact failure"))
    });
    assert_eq!(
        result.expect_err("failed preparation").to_string(),
        "first preparation failure"
    );
    assert!(host.pending.is_none());
    assert_eq!(host.state().root_text_content().as_ref(), "");
    assert!(!ForeignReadOperation::is_active());
    host.begin_update(TagSet::default())?;
    host.discard_update()?;
    Ok(())
}
