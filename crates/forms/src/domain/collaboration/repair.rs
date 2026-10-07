//! Repairs a layout document whose records cannot be read, for an explicit
//! replacement to overwrite.

use std::collections::{HashMap, HashSet};

use loro::{Container, LoroDoc, LoroMovableList, LoroValue, ValueOrContainer};

use super::{
    FORMAT_KEY, FORMAT_VERSION, LayoutDraftError, METADATA, QUESTION_ORDERS, QUESTIONS,
    QuestionRecord, SECTION_ORDER, SECTIONS, SectionRecord, check_format, child_map, is_booking,
    keys, layout_from_records, malformed, ordered_ids, read_question, read_section_with_questions,
    section_records,
};

/// Deletes what of the document cannot be read as a layout, so a replacement
/// rewrites it, and returns the sections that can be, as `read_records`
/// orders them. Readable sections keep their containers, so concurrent edits
/// to them still merge.
pub(super) fn clear_unreadable(document: &LoroDoc) -> Result<Vec<SectionRecord>, LayoutDraftError> {
    if check_format(document).is_err() {
        document
            .get_map(METADATA)
            .insert(FORMAT_KEY, FORMAT_VERSION)
            .map_err(LayoutDraftError::Edit)?;
    }
    let sections = document.get_map(SECTIONS);
    let question_orders = document.get_map(QUESTION_ORDERS);
    let questions = document.get_map(QUESTIONS);

    let mut unreadable_questions = HashSet::new();
    let mut questions_by_section: HashMap<String, HashMap<String, QuestionRecord>> = HashMap::new();
    for id in keys(&questions) {
        let location = format!("{QUESTIONS}.{id}");
        let read = child_map(&questions, &id, &location).and_then(|map| {
            let map = map.ok_or_else(|| malformed(location.clone(), "a map"))?;
            read_question(&map, id.clone(), &location)
        });
        match read {
            Ok((section_id, record)) => {
                questions_by_section
                    .entry(section_id)
                    .or_default()
                    .insert(id, record);
            }
            Err(_) => {
                questions.delete(&id).map_err(LayoutDraftError::Edit)?;
                unreadable_questions.insert(id);
            }
        }
    }
    for id in keys(&question_orders) {
        if let Some(ValueOrContainer::Container(Container::MovableList(order))) =
            question_orders.get(&id)
        {
            prune_order(&order, &unreadable_questions)?;
        }
    }

    let mut readable = HashMap::new();
    let mut unreadable_sections = HashSet::new();
    for id in keys(&sections) {
        let members = questions_by_section.remove(&id).unwrap_or_default();
        let member_ids: Vec<String> = members.keys().cloned().collect();
        // Checked as the layout models it, as the strict read is.
        let read = read_section_with_questions(&sections, &question_orders, &id, members)
            .and_then(|record| layout_from_records(vec![record]))
            .and_then(|layout| section_records(&layout));
        match read {
            Ok(records) => {
                readable.extend(records.into_iter().map(|record| (id.clone(), record)));
            }
            Err(_) => {
                sections.delete(&id).map_err(LayoutDraftError::Edit)?;
                question_orders
                    .delete(&id)
                    .map_err(LayoutDraftError::Edit)?;
                for question_id in &member_ids {
                    questions
                        .delete(question_id)
                        .map_err(LayoutDraftError::Edit)?;
                }
                unreadable_sections.insert(id);
            }
        }
    }
    let section_order = document.get_movable_list(SECTION_ORDER);
    prune_order(&section_order, &unreadable_sections)?;
    let readable_ids: Vec<String> = readable.keys().cloned().collect();
    let mut records: Vec<SectionRecord> =
        ordered_ids(&section_order, SECTION_ORDER, "a section id", &readable_ids)?
            .into_iter()
            .filter_map(|id| readable.remove(&id))
            .collect();
    records.sort_by_key(is_booking);
    Ok(records)
}

/// Deletes the entries of `order` that are not ids, or that name `removed`.
fn prune_order(order: &LoroMovableList, removed: &HashSet<String>) -> Result<(), LayoutDraftError> {
    for index in (0..order.len()).rev() {
        let kept = matches!(
            order.get(index),
            Some(ValueOrContainer::Value(LoroValue::String(id))) if !removed.contains(id.as_str())
        );
        if !kept {
            order.delete(index, 1).map_err(LayoutDraftError::Edit)?;
        }
    }
    Ok(())
}
