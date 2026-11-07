//! List export classes, checklist attributes and nested-item folding.
use super::*;
use crate::list::{ListItemNode, ListNode, ListNodeTagType, ListType};
impl ExportDom for ListNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        list_export_dom(self, ctx, key)
    }
}
/// Export a list container without ElementNode indentation attributes.
pub fn list_export_dom<'a>(
    list: &ListNode,
    ctx: &ExportCtx<'a>,
    key: NodeKey,
) -> lexical_html::Result<DomExportOutput<'a>> {
    let ordered = list.tag() == ListNodeTagType::Ol;
    let mut el = HtmlElement::new(if ordered { "ol" } else { "ul" });
    if list.start() != 1 {
        el.set_attribute("start", list.start().to_string());
    }
    if let Some(theme) = &ctx.theme.list {
        let depth = crate::list::utils::get_list_depth(
            ctx.state,
            ctx.state
                .view()
                .cast::<ListNode>(key)
                .ok_or(lexical_model::Error::NodeTypeMismatch(key))?,
        )? - 1;
        let levels = if ordered {
            &theme.ol_depth
        } else {
            &theme.ul_depth
        };
        add_class_names(
            &mut el,
            &[if ordered {
                theme.ol.as_deref()
            } else {
                theme.ul.as_deref()
            }],
        );
        if list.list_type() == ListType::Check {
            add_class_names(&mut el, &[theme.checklist.as_deref()]);
        }
        if !levels.is_empty() {
            add_class_names(
                &mut el,
                &[levels
                    .get(depth as usize % levels.len())
                    .map(String::as_str)],
            );
        }
        if depth > 1 {
            add_class_names(
                &mut el,
                &[theme
                    .nested
                    .as_ref()
                    .and_then(|nested| nested.list.as_deref())],
            );
        }
    }
    if list.start() != 1 {
        el.set_attribute("start", list.start().to_string());
    }
    if list.list_type() == ListType::Check {
        el.set_attribute("__lexicalListType", "check");
    }
    Ok(DomExportOutput::element(el))
}
impl ExportDom for ListItemNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        let mut el = HtmlElement::new("li");
        let st = ctx.state;
        let check = st
            .parent(key)
            .and_then(|p| st.view().get::<ListNode>(p))
            .is_some_and(|list| list.list_type() == ListType::Check);
        let first_list = st
            .first_child(key)
            .is_some_and(|child| st.is::<ListNode>(child));
        if check && !first_list {
            el.set_attribute("role", "checkbox");
            el.set_attribute("tabIndex", "-1");
            el.set_attribute(
                "aria-checked",
                if self.checked == Some(true) {
                    "true"
                } else {
                    "false"
                },
            );
        }
        if let Some(theme) = &ctx.theme.list {
            add_class_names(&mut el, &[theme.listitem.as_deref()]);
            if check {
                add_class_names(
                    &mut el,
                    &[if self.checked == Some(true) {
                        theme.listitem_checked.as_deref()
                    } else {
                        theme.listitem_unchecked.as_deref()
                    }],
                );
            }
            if st.children(key).any(|child| st.is::<ListNode>(child)) {
                add_class_names(
                    &mut el,
                    &[theme
                        .nested
                        .as_ref()
                        .and_then(|nested| nested.listitem.as_deref())],
                );
            }
        }
        let data = st.element_data(key)?;
        set_dom_style_from_css(&mut el, &data.style);
        for (name, value) in lexical_model::style_object_from_css(&data.text_style) {
            el.style_set_property(&format!("--listitem-marker-{name}"), &value);
        }
        if let Some(align) = element_format_str(data.format) {
            el.style_set_property("text-align", align);
        }
        if let Some(dir) = data.direction {
            el.set_attribute(
                "dir",
                match dir {
                    lexical_model::TextDirection::Ltr => "ltr",
                    lexical_model::TextDirection::Rtl => "rtl",
                },
            );
        }
        let mut output = DomExportOutput::element(el);
        if first_list {
            output.after = Some(Box::new(|_, siblings, index| {
                let previous = siblings
                    .get(..index)
                    .ok_or(lexical_html::Error::InvalidExport("missing list siblings"))?
                    .iter()
                    .rposition(|node| matches!(node, HtmlNode::Element(_)));
                if let Some(previous) = previous
                    && matches!(siblings.get(previous), Some(HtmlNode::Element(el)) if el.tag.eq_ignore_ascii_case("li"))
                {
                    let current = siblings
                        .get_mut(index)
                        .ok_or(lexical_html::Error::InvalidExport("missing list item"))?;
                    if let HtmlNode::Element(current) = current {
                        let children = std::mem::take(&mut current.children);
                        if let Some(HtmlNode::Element(el)) = siblings.get_mut(previous) {
                            el.children.extend(children);
                        }
                        let mut position = 0;
                        siblings.retain(|_| {
                            let keep = position != index;
                            position += 1;
                            keep
                        });
                    }
                }
                Ok(())
            }));
        }
        Ok(output)
    }
}
