//! The export-only appendNodesToHTML traversal, including hoisting and callbacks.
use crate::*;
use lexical_model::*;
pub(crate) fn append_nodes_to_html<C: DomRenderConfig>(
    exporter: &HtmlExporter<C>,
    ctx: &ExportCtx<'_>,
    key: NodeKey,
    parent: &mut Vec<HtmlNode>,
) -> crate::Result<bool> {
    let mut include = exporter.config.should_include(ctx, key);
    let exclude = exporter.config.should_exclude(ctx, &exporter.registry, key);
    let sliced = if ctx.state.is_text(key) {
        ctx.selection
            .map(|selection| slice_selected_text(ctx.state, selection, key))
            .transpose()?
            .flatten()
    } else {
        None
    };
    let local = ExportCtx {
        state: ctx.state,
        theme: ctx.theme,
        selection: ctx.selection,
        text_override: sliced.as_deref(),
    };
    let output = exporter
        .config
        .export_dom(&local, &exporter.registry, key)?;
    let Some(mut element) = output.element else {
        return Ok(false);
    };
    let children = match output.children {
        Some(children) => children,
        None if ctx.state.is_element(key) => ctx.state.children_keys(key)?,
        None => Vec::new(),
    };
    let mut fragment = Vec::new();
    for child in children {
        let child_included = append_nodes_to_html(exporter, ctx, child, &mut fragment)?;
        if !include
            && child_included
            && exporter.config.extract_with_child(
                ctx,
                &exporter.registry,
                key,
                child,
                CopyDestination::Html,
            )
        {
            include = true;
        }
    }
    if include && !exclude {
        let is_fragment = matches!(element, HtmlNode::Fragment(_));
        if matches!(element, HtmlNode::Element(_) | HtmlNode::Fragment(_)) {
            if let Some(append) = output.append {
                append(&mut element, fragment);
            } else {
                match &mut element {
                    HtmlNode::Element(element) => {
                        for node in fragment {
                            element.append(node);
                        }
                    }
                    HtmlNode::Fragment(nodes) => nodes.extend(fragment),
                    _ => {}
                }
            }
        }
        let index = parent.len();
        match element {
            HtmlNode::Fragment(nodes) => parent.extend(nodes),
            node => parent.push(node),
        }
        if !is_fragment && let Some(after) = output.after {
            after(&local, parent, index)?;
        }
    } else {
        parent.extend(fragment);
    }
    Ok(include)
}
#[cfg(test)]
mod test;
