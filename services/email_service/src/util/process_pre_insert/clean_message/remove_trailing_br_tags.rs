use ego_tree::{NodeId, Tree};
use models_email::service::message::Message;
use models_email::service::thread::Thread;
use scraper::{Html, Node};

pub fn remove_trailing_br_tags_threads(threads: &mut [Thread]) {
    for thread in threads.iter_mut() {
        for message in thread.messages.iter_mut() {
            remove_trailing_br_tags(message);
        }
    }
}

// removes any trailing brs from body_html_sanitized
#[tracing::instrument(skip(message))]
pub fn remove_trailing_br_tags(message: &mut Message) {
    // Clean body_html_sanitized if it exists
    if let Some(body_html_sanitized) = message.body_html_sanitized.as_ref() {
        let mut document = Html::parse_fragment(body_html_sanitized);
        let root = document.root_element().id();
        detach_trailing_insignificant_nodes(&mut document.tree, root);
        // This runs after sanitization, so the result must come from the
        // parser's own serializer: writing text or attribute values back by
        // hand turns escaped text (`&lt;script&gt;`) into markup.
        message.body_html_sanitized = Some(document.root_element().inner_html());
    }
}

/// Detaches the trailing nodes under `root` that show nothing (`<br>`s,
/// whitespace, comments, containers left empty), stopping at the last node
/// that does show something.
fn detach_trailing_insignificant_nodes(tree: &mut Tree<Node>, root: NodeId) {
    // Walks down the last children instead of recursing: mail can nest
    // elements deeper than the stack allows.
    let mut container = root;
    loop {
        let Some(node) = tree.get(container) else {
            return;
        };

        let Some(last) = node.last_child() else {
            // Nothing is left in this container, so it shows nothing either.
            let Some(parent) = node.parent().filter(|_| container != root) else {
                return;
            };
            let emptied = container;
            container = parent.id();
            detach(tree, emptied);
            continue;
        };

        let last_id = last.id();
        let is_element = last.value().is_element();
        let is_content = match last.value() {
            // `<img>` tags are always considered content.
            Node::Element(element) => element.name().eq_ignore_ascii_case("img"),
            Node::Text(text) => !text.trim().is_empty(),
            _ => false,
        };

        if is_content {
            return;
        }
        if is_element {
            // Any other element is content only if something is left in it.
            container = last_id;
        } else {
            detach(tree, last_id);
        }
    }
}

fn detach(tree: &mut Tree<Node>, node: NodeId) {
    if let Some(mut node) = tree.get_mut(node) {
        node.detach();
    }
}

#[cfg(test)]
mod test;
