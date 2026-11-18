use super::*;
use std::collections::BTreeSet;

pub(super) fn update(tx: &mut Transaction<'_>, commit: &Commit) -> crate::ModelResult<()> {
    let previous_count = tx.extension::<DraftCommentMarks>()?.count;
    let previous = commit.prev.view();
    let next = commit.next.view();
    let count = if commit.full_reconcile {
        next.descendants(NodeKey::ROOT)
            .filter(|(key, _)| live_draft(next, *key))
            .count()
    } else {
        let mut affected = BTreeSet::new();
        let mut visited_previous = BTreeSet::new();
        let mut visited_next = BTreeSet::new();
        for key in commit.changes.mutations.keys().copied() {
            if comment_node(previous, key).is_some() || comment_node(next, key).is_some() {
                affected.insert(key);
            }
            // Clean descendants need no work while the subtree stays attached.
            // GC can remove them without publishing individual mutations, so
            // attachment changes must inspect the edited subtree in both states.
            if (previous.is_element(key) || next.is_element(key))
                && previous.is_attached(key) != next.is_attached(key)
            {
                collect_comments(previous, key, &mut visited_previous, &mut affected);
                collect_comments(next, key, &mut visited_next, &mut affected);
            }
        }
        let mut removed = 0;
        let mut added = 0;
        for key in affected {
            match (live_draft(previous, key), live_draft(next, key)) {
                (true, false) => removed += 1,
                (false, true) => added += 1,
                _ => {}
            }
        }
        previous_count
            .checked_sub(removed)
            .and_then(|value| value.checked_add(added))
            .ok_or(Error::Invariant("draft comment count diverged"))?
    };
    if count != previous_count {
        tx.extension_mut::<DraftCommentMarks>()?.count = count;
    }
    Ok(())
}

fn collect_comments(
    view: StateRef<'_>,
    root: NodeKey,
    visited: &mut BTreeSet<NodeKey>,
    comments: &mut BTreeSet<NodeKey>,
) {
    let mut stack = vec![root];
    while let Some(key) = stack.pop() {
        if !visited.insert(key) {
            continue;
        }
        if comment_node(view, key).is_some() {
            comments.insert(key);
        }
        stack.extend(view.children(key));
    }
}

fn comment_node<'state>(view: StateRef<'state>, key: NodeKey) -> Option<&'state CommentNode> {
    #[cfg(test)]
    WORK.with(|work| work.borrow_mut().0 += 1);
    let node = view.get::<CommentNode>(key);
    #[cfg(test)]
    if node.is_some() {
        WORK.with(|work| work.borrow_mut().1 += 1);
    }
    node
}

fn live_draft(view: StateRef<'_>, key: NodeKey) -> bool {
    comment_node(view, key).is_some_and(|mark| mark.is_draft && view.is_attached(key))
}

#[cfg(test)]
thread_local! {
    static WORK: std::cell::RefCell<(usize, usize)> = const { std::cell::RefCell::new((0, 0)) };
}

#[cfg(test)]
mod test;
