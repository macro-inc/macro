//! Laid-out tables kept between layouts: a table is stacked again only
//! when something it shows changed.

use super::super::super::inline::FieldValues;
use super::super::super::{Item, ParaBox, StoryRef};
use super::super::Env;
use super::{TableBox, lay_out_table};
use crate::hash::FxMap;
use crate::model::block::{Block, BlockId, BlockKind, Story};
use crate::model::numbering::Suffix;
use crate::model::props::Align;
use std::sync::{Arc, Mutex};

/// What a laid-out table depends on besides the page fields and note
/// numbers it shows.
#[derive(Debug, PartialEq)]
struct TableKey {
    /// Versions of the table and of every block inside it, in order.
    blocks: Vec<u64>,
    /// List labels of the body paragraphs inside (numbered through the
    /// document), by their place in `blocks`.
    labels: Vec<(usize, String, Suffix, Align)>,
    width: u32,
    generation: u64,
    markup: bool,
}

impl TableKey {
    fn of(env: &Env<'_>, story: &Story, table: &Block, width: f32, story_ref: &StoryRef) -> Self {
        let body = *story_ref == StoryRef::Body;
        let mut blocks = Vec::new();
        let mut labels = Vec::new();
        story.walk_from(&table.id, &mut |b| {
            if body
                && b.kind == BlockKind::Paragraph
                && let Some((label, _)) = env.labels.get(&b.id)
            {
                labels.push((blocks.len(), label.text.clone(), label.suffix, label.jc));
            }
            blocks.push(b.version);
        });
        Self {
            blocks,
            labels,
            width: width.to_bits(),
            generation: env.doc.generation,
            markup: env.options.markup,
        }
    }
}

/// A laid-out table and what it was laid out from.
#[derive(Debug)]
struct Cached {
    key: TableKey,
    /// The page field values it shows, when it shows any.
    fields: Option<FieldValues>,
    /// Its paragraphs with note references, whose numbers can change
    /// without the table changing.
    notes: Vec<Arc<ParaBox>>,
    tb: Arc<TableBox>,
    epoch: u64,
}

/// Laid-out tables by story and table block: a few per table, since one
/// layout can stack a table more than once (at a column's width, and in
/// a keep-with-next chain measured for another column).
#[derive(Debug, Default)]
pub(in crate::layout) struct TableCache(Mutex<FxMap<(StoryRef, BlockId), Vec<Cached>>>);

impl TableCache {
    fn get(
        &self,
        epoch: u64,
        id: &(StoryRef, BlockId),
        key: &TableKey,
        fields: &FieldValues,
        notes: &std::collections::HashMap<(bool, i64), String>,
    ) -> Option<Arc<TableBox>> {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let hit = guard.get_mut(id)?.iter_mut().find(|c| {
            c.key == *key
                && c.fields.as_ref().is_none_or(|f| f == fields)
                && c.notes.iter().all(|pb| pb.inline.notes_current(notes))
        })?;
        hit.epoch = epoch;
        Some(Arc::clone(&hit.tb))
    }

    fn put(&self, id: (StoryRef, BlockId), entry: Cached) {
        /// Tables kept per table block.
        const KEEP: usize = 4;
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let list = guard.entry(id).or_default();
        list.retain(|c| c.key != entry.key || c.fields != entry.fields);
        if list.len() >= KEEP
            && let Some(oldest) = (0..list.len()).min_by_key(|&i| list[i].epoch)
        {
            list.remove(oldest);
        }
        list.push(entry);
    }

    /// Drops the tables the pass that ended at `epoch` did not use.
    pub(in crate::layout) fn end(&self, epoch: u64) {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        guard.retain(|_, list| {
            list.retain(|c| c.epoch == epoch);
            !list.is_empty()
        });
    }
}

/// Lays out a table's rows within a container `avail` wide, or takes
/// them from the cache when nothing they show changed.
pub(super) fn table_box(
    env: &Env<'_>,
    story: &Story,
    table: &Block,
    avail: f32,
    story_ref: &StoryRef,
    fields: &FieldValues,
) -> Arc<TableBox> {
    let Some(cache) = env.cache else {
        return Arc::new(lay_out_table(env, story, table, avail, story_ref, fields));
    };
    let epoch = cache.epoch();
    let id = (story_ref.clone(), table.id.clone());
    let key = TableKey::of(env, story, table, avail, story_ref);
    if let Some(tb) = cache
        .tables
        .get(epoch, &id, &key, fields, &env.note_numbers)
    {
        return tb;
    }
    let tb = Arc::new(lay_out_table(env, story, table, avail, story_ref, fields));
    let mut dynamic = false;
    let mut notes: Vec<Arc<ParaBox>> = Vec::new();
    for cell in tb.rows.iter().flat_map(|r| &r.cells) {
        for item in &cell.content.items {
            if let Item::Line(l) = item {
                dynamic |= l.para.inline.dynamic;
                if !l.para.inline.notes.is_empty()
                    && !notes.last().is_some_and(|pb| Arc::ptr_eq(pb, &l.para))
                {
                    notes.push(Arc::clone(&l.para));
                }
            }
        }
    }
    cache.tables.put(
        id,
        Cached {
            key,
            fields: dynamic.then(|| fields.clone()),
            notes,
            tb: Arc::clone(&tb),
            epoch,
        },
    );
    tb
}
