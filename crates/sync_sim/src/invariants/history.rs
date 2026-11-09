use super::*;

/// Match redo to observed history stack lineage, including repeated equal trees.
/// Remote changes that alter a tree are covered by cursor-transform literals;
/// compare actual endpoint identities and offsets, never cursor encoding bytes.
pub fn redo_restores_selection(outcome: &Outcome) -> Result<(), Failure> {
    type Entry<'a> = (u64, &'a serde_json::Value);
    let mut clients =
        std::collections::BTreeMap::<_, (Vec<Option<Entry<'_>>>, Vec<Option<Entry<'_>>>)>::new();
    for event in &outcome.events {
        let Fact::EditorSelectionObserved {
            client,
            session,
            state,
            selection,
            undo_depth,
            redo_depth,
            history,
            changed,
        } = &event.fact
        else {
            continue;
        };
        let (undo, redo) = clients.entry((client, session)).or_default();
        if *history == 1 {
            while undo.len() > *undo_depth {
                redo.push(undo.pop().flatten());
            }
        } else if *history == 2 {
            while redo.len() > *redo_depth {
                let entry = redo.pop().flatten();
                if *changed
                    && let Some((tree, expected)) = entry
                    && tree == *state
                    && expected != selection
                {
                    return Err(Failure::new(
                        "redo_restores_selection",
                        format!(
                            "{client:?}/{session:?}: redo selection {selection} differs from committed {expected}"
                        ),
                    ));
                }
                undo.push(entry);
            }
        } else if *changed && *undo_depth > 0 {
            undo.resize(*undo_depth, None);
            undo[*undo_depth - 1] = Some((*state, selection));
        }
        undo.resize(*undo_depth, None);
        redo.resize(*redo_depth, None);
    }
    Ok(())
}
