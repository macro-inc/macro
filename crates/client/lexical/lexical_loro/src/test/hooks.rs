use super::*;
#[derive(Clone)]
pub(super) struct Ids {
    pub peer: &'static str,
    pub next: u32,
}
pub(super) struct AssignIds;
impl Plugin for AssignIds {
    fn name(&self) -> &'static str {
        "ids"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(
        &self,
        _: &mut Transaction<'_>,
        _: &Command,
    ) -> std::result::Result<Handled, lexical_model::Error> {
        Ok(Handled::No)
    }
    fn after_commit(
        &self,
        tx: &mut Transaction<'_>,
        commit: &Commit,
    ) -> std::result::Result<(), lexical_model::Error> {
        for (key, mutation) in &commit.changes.mutations {
            if *key == NodeKey::ROOT
                || *mutation == Mutation::Destroyed
                || !tx.is_attached(*key)
                || !tx.get_state(*key, &ID)?.is_empty()
            {
                continue;
            }
            let counter = tx.extension_mut::<Ids>()?;
            counter.next += 1;
            let id = format!("{}-{}", counter.peer, counter.next);
            tx.set_state(*key, &ID, id)?;
        }
        Ok(())
    }
}
#[test]
fn after_commit_ids_in_the_same_output_are_written_even_with_local_status_tag() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .extension_state(Ids {
            peer: "peer-a",
            next: 0,
        })
        .plugin(AssignIds)
        .build()
        .expect("editor");
    let doc = new_doc(1)?;
    let mut projection = LoroProjection::initialize(&doc, editor.state(), &PLAIN, 0)?;
    let (text, commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("created")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.add_tag(UpdateTag::Custom("local-status".into()));
        Ok(t)
    })?;
    assert_eq!(commit.chain().count(), 2);
    assert!(!editor.state().view().get_state(text, &ID)?.is_empty());
    assert!(
        projection
            .local_commit(&doc, &[commit], LOCAL_ORIGIN, 1)?
            .changed
    );
    projection
        .check(&doc, editor.state())
        .expect("follow-up ids visible");
    let map = projection.index.map(&doc, text.key())?;
    assert_eq!(
        schema::read_value(&map.get("$").expect("state"))?,
        json!({"id":"peer-a-1"})
    );
    Ok(())
}
