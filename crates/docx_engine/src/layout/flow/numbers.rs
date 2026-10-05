//! List labels and note numbers of the body. Both count through the whole
//! document; between layouts they are counted again only when the list
//! items or note references they come from changed.

use super::super::format::{Formats, ParaFormat, TableCtx};
use super::note_id;
use crate::document::Document;
use crate::hash::FxMap;
use crate::model::block::{Block, BlockId, BlockKind};
use crate::model::content::{OBJECT_CHAR, key};
use crate::model::numbering::{Counters, Label, format_number};
use crate::model::props::RunProps;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// List labels of the body's numbered paragraphs, with their run
/// properties.
pub(in crate::layout) type Labels = FxMap<BlockId, (Label, RunProps)>;

/// Displayed note numbers by (endnote, id).
pub(in crate::layout) type NoteNumbers = HashMap<(bool, i64), String>;

/// What numbering reads of one paragraph.
#[derive(Debug)]
struct Marks {
    /// The list and level it is an item of, with its format (hidden
    /// paragraphs are not counted).
    item: Option<(i64, u8, Arc<ParaFormat>)>,
    /// Its note references in order: (endnote, id).
    refs: Vec<(bool, i64)>,
}

impl Marks {
    fn of(block: &Block, formats: &Formats<'_>) -> Self {
        let fmt = formats.paragraph(&block.props, &TableCtx::default());
        let item = match fmt.props.num {
            Some((num_id, ilvl)) if !fmt.mark.vanish => Some((num_id, ilvl, Arc::clone(&fmt))),
            _ => None,
        };
        let mut refs = Vec::new();
        for (_, span) in block.content.spans_at() {
            let Some(obj) = span.attrs.get(key::OBJ) else {
                continue;
            };
            for _ in span.text.chars().filter(|c| *c == OBJECT_CHAR) {
                let endnote = obj.contains("endnoteReference");
                if !(endnote || obj.contains("footnoteReference")) {
                    continue;
                }
                if let Some(id) = note_id(obj) {
                    refs.push((endnote, id));
                }
            }
        }
        Self { item, refs }
    }
}

/// A list item: the paragraph, its list and level, and its format.
type Item = (BlockId, i64, u8, Arc<ParaFormat>);

/// The body's list items and note references, in document order.
#[derive(Debug, Default)]
struct Sequence {
    items: Vec<Item>,
    refs: Vec<(bool, i64)>,
}

impl Sequence {
    fn add(&mut self, id: &BlockId, marks: &Marks) {
        if let Some((num_id, ilvl, fmt)) = &marks.item {
            self.items
                .push((id.clone(), *num_id, *ilvl, Arc::clone(fmt)));
        }
        self.refs.extend_from_slice(&marks.refs);
    }

    /// Whether the list items are the same paragraphs, in the same lists
    /// and formats, so they get the same labels.
    fn same_items(&self, other: &Self) -> bool {
        self.items.len() == other.items.len()
            && self
                .items
                .iter()
                .zip(&other.items)
                .all(|(a, b)| a.0 == b.0 && a.1 == b.1 && a.2 == b.2 && Arc::ptr_eq(&a.3, &b.3))
    }

    fn labels(&self, formats: &Formats<'_>) -> Labels {
        let mut counters = Counters::default();
        let mut labels = Labels::default();
        for (id, num_id, ilvl, fmt) in &self.items {
            if let Some(label) = counters.next(formats.numbering, formats.styles, *num_id, *ilvl) {
                let props = formats.label_props(fmt, &label);
                labels.insert(id.clone(), (label, props));
            }
        }
        labels
    }

    fn numbers(&self, doc: &Document) -> NoteNumbers {
        let settings = &doc.parts().settings;
        let mut footnote = settings.footnotes.start;
        let mut endnote = settings.endnotes.start;
        let mut numbers = NoteNumbers::new();
        for &(is_endnote, id) in &self.refs {
            if numbers.contains_key(&(is_endnote, id)) {
                continue;
            }
            let (fmt, n) = if is_endnote {
                endnote += 1;
                (&settings.endnotes.fmt, endnote - 1)
            } else {
                footnote += 1;
                (&settings.footnotes.fmt, footnote - 1)
            };
            numbers.insert((is_endnote, id), format_number(n, fmt));
        }
        numbers
    }
}

/// What the last count read and found.
#[derive(Debug)]
struct Kept {
    generation: u64,
    /// The body revision counted.
    revision: u64,
    /// Per paragraph: the version read, its marks, and the last count
    /// that met it.
    paras: FxMap<BlockId, (u64, Marks, u64)>,
    count: u64,
    sequence: Sequence,
    labels: Arc<Labels>,
    numbers: Arc<NoteNumbers>,
}

/// Labels and note numbers kept between layouts.
#[derive(Debug, Default)]
pub(in crate::layout) struct NumbersCache(Mutex<Option<Kept>>);

/// Numbers notes in order of reference and computes list labels, reusing
/// what `cache` kept from the last layout when the list items and note
/// references are the same.
pub(in crate::layout) fn count(
    doc: &Document,
    formats: &Formats<'_>,
    cache: Option<&NumbersCache>,
) -> (Arc<Labels>, Arc<NoteNumbers>) {
    let Some(cache) = cache else {
        let mut seq = Sequence::default();
        doc.body.walk(|b, _| {
            if b.kind == BlockKind::Paragraph {
                seq.add(&b.id, &Marks::of(b, formats));
            }
        });
        return (Arc::new(seq.labels(formats)), Arc::new(seq.numbers(doc)));
    };
    let mut guard = cache.0.lock().unwrap_or_else(|e| e.into_inner());
    let kept = guard.take().filter(|k| k.generation == doc.generation);
    if let Some(k) = &kept
        && k.revision == doc.body.revision()
    {
        let out = (Arc::clone(&k.labels), Arc::clone(&k.numbers));
        *guard = kept;
        return out;
    }
    let mut kept = kept.unwrap_or_else(|| Kept {
        generation: doc.generation,
        revision: 0,
        paras: FxMap::default(),
        count: 0,
        sequence: Sequence::default(),
        labels: Arc::default(),
        numbers: Arc::default(),
    });
    let fresh = kept.count == 0;
    kept.count += 1;
    let count = kept.count;
    let paras = &mut kept.paras;
    let mut seq = Sequence::default();
    let mut walked = 0;
    doc.body.walk(|b, _| {
        if b.kind != BlockKind::Paragraph {
            return;
        }
        walked += 1;
        match paras.get_mut(&b.id) {
            Some(entry) if entry.0 == b.version => {
                entry.2 = count;
                seq.add(&b.id, &entry.1);
            }
            _ => {
                let marks = Marks::of(b, formats);
                seq.add(&b.id, &marks);
                paras.insert(b.id.clone(), (b.version, marks, count));
            }
        }
    });
    // Paragraphs gone from the body linger until there are many of them.
    if paras.len() > 2 * walked + 64 {
        paras.retain(|_, p| p.2 == count);
    }
    if fresh || !seq.same_items(&kept.sequence) {
        kept.labels = Arc::new(seq.labels(formats));
    }
    if fresh || seq.refs != kept.sequence.refs {
        kept.numbers = Arc::new(seq.numbers(doc));
    }
    kept.sequence = seq;
    kept.revision = doc.body.revision();
    let out = (Arc::clone(&kept.labels), Arc::clone(&kept.numbers));
    *guard = Some(kept);
    out
}
