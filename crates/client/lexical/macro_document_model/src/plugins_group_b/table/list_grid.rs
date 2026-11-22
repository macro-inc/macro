//! Source nested-list grid conversion, preserving deeper lists inside body cells.
use super::*;
use lexical_rich_nodes::list::{ListNode, ListType};
struct Cell {
    item: NodeKey,
    nested: Vec<NodeKey>,
    deep: Vec<NodeKey>,
}
struct Column {
    header: NodeKey,
    cells: Vec<Cell>,
}
fn wrapper(view: &impl Read, item: NodeKey) -> Result<bool, Error> {
    let children = view.children_keys(item)?;
    Ok(!children.is_empty() && children.iter().all(|key| view.is::<ListNode>(*key)))
}
fn cell(view: &impl Read, item: NodeKey) -> Result<Cell, Error> {
    Ok(Cell {
        item,
        nested: view
            .children_keys(item)?
            .into_iter()
            .filter(|key| view.is::<ListNode>(*key))
            .collect(),
        deep: Vec::new(),
    })
}
fn sublist(view: &impl Read, list: NodeKey, cells: &mut Vec<Cell>) -> Result<(), Error> {
    let mut indent = None;
    for key in view.children_keys(list)? {
        if !view.is::<ListItemNode>(key) {
            continue;
        }
        if wrapper(view, key)? {
            let lists: Vec<_> = view
                .children_keys(key)?
                .into_iter()
                .filter(|key| view.is::<ListNode>(*key))
                .collect();
            if let Some(last) = cells.last_mut() {
                last.nested.extend(lists);
            } else {
                for list in lists {
                    sublist(view, list, cells)?;
                }
            }
            continue;
        }
        let indent = *indent.get_or_insert_with(|| view.indent(key));
        if view.indent(key) > indent
            && let Some(last) = cells.last_mut()
        {
            last.deep.push(key);
        } else {
            cells.push(cell(view, key)?);
        }
    }
    Ok(())
}
fn group_cells(view: &impl Read, group: &[NodeKey]) -> Result<Vec<Cell>, Error> {
    let (header, rest) = group
        .split_first()
        .ok_or(Error::Invariant("list grid header"))?;
    let mut cells = Vec::new();
    for key in view.children_keys(*header)? {
        if view.is::<ListNode>(key) {
            sublist(view, key, &mut cells)?;
        }
    }
    let mut indent = None;
    for key in rest {
        if wrapper(view, *key)? {
            for sub in view.children_keys(*key)? {
                if view.is::<ListNode>(sub) {
                    sublist(view, sub, &mut cells)?;
                }
            }
            continue;
        }
        let indent = *indent.get_or_insert_with(|| view.indent(*key));
        if view.indent(*key) > indent
            && let Some(last) = cells.last_mut()
        {
            last.deep.push(*key);
        } else {
            cells.push(cell(view, *key)?);
        }
    }
    Ok(cells)
}
fn grid(view: &impl Read, list: NodeKey) -> Result<Option<Vec<Column>>, Error> {
    if view.get_or_err::<ListNode>(list)?.list_type() == ListType::Check {
        return Ok(None);
    }
    let children = view.children_keys(list)?;
    let mut columns = Vec::new();
    let mut index = 0;
    while let Some(item) = children.get(index).copied() {
        if !view.is::<ListItemNode>(item) || wrapper(view, item)? {
            return Ok(None);
        }
        let group = super::super::movement::nested_group(view, item)?;
        let cells = group_cells(view, &group)?;
        if cells.is_empty() {
            return Ok(None);
        }
        columns.push(Column {
            header: item,
            cells,
        });
        index += group.len();
    }
    Ok((columns.len() >= 2).then_some(columns))
}
fn fill(
    tx: &mut Transaction<'_>,
    target: NodeKey,
    source: Cell,
    kind: ListType,
) -> Result<(), Error> {
    let p = tx.create(Paragraph::default())?;
    for key in tx.children_keys(source.item)? {
        if !tx.is::<ListNode>(key) {
            tx.append(p, &[key])?;
        }
    }
    tx.append(target, &[p.key()])?;
    tx.append(target, &source.nested)?;
    if !source.deep.is_empty() {
        let list = tx.create(ListNode::new(kind, 1))?;
        tx.append(list, &source.deep)?;
        tx.append(target, &[list.key()])?;
    }
    Ok(())
}
pub(super) fn can_convert(view: &impl Read, list: NodeKey) -> Result<bool, Error> {
    Ok(view.is::<ListNode>(list)
        && view.parent(list) == Some(NodeKey::ROOT)
        && grid(view, list)?.is_some())
}
pub(super) fn convert(tx: &mut Transaction<'_>, list: NodeKey) -> Result<bool, Error> {
    if !tx.is::<ListNode>(list) || tx.parent(list) != Some(NodeKey::ROOT) {
        return Ok(false);
    }
    let Some(columns) = grid(tx, list)? else {
        return Ok(false);
    };
    let kind = tx.get_or_err::<ListNode>(list)?.list_type();
    let table = tx.create(TableNode::default())?;
    let row = tx.create(TableRowNode::default())?;
    for column in &columns {
        let target = tx.create(TableCellNode::new(TableCellHeaderState::ROW, 1, None))?;
        fill(
            tx,
            target.key(),
            Cell {
                item: column.header,
                nested: Vec::new(),
                deep: Vec::new(),
            },
            kind,
        )?;
        tx.append(row, &[target.key()])?;
    }
    tx.append(table, &[row.key()])?;
    let count = columns
        .iter()
        .map(|column| column.cells.len())
        .max()
        .unwrap_or(0);
    let mut columns: Vec<_> = columns
        .into_iter()
        .map(|column| column.cells.into_iter())
        .collect();
    for _ in 0..count {
        let row = tx.create(TableRowNode::default())?;
        for column in &mut columns {
            let target = tx.create(TableCellNode::default())?;
            if let Some(source) = column.next() {
                fill(tx, target.key(), source, kind)?;
            } else {
                let p = tx.create(Paragraph::default())?;
                tx.append(target, &[p.key()])?;
            }
            tx.append(row, &[target.key()])?;
        }
        tx.append(table, &[row.key()])?;
    }
    tx.replace(list, table, false)?;
    if let Some(row) = tx.first_child(table)
        && let Some(cell) = tx.first_child(row)
        && let Some(p) = tx.first_child(cell).filter(|key| tx.is_element(*key))
    {
        tx.select_end(p)?;
    }
    Ok(true)
}
