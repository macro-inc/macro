//! Breaks one value of a response the way a bad server or a schema skew would:
//! a field dropped, a value of the wrong type, an entity nulled or renamed.

use serde_json::Value;

#[derive(Clone)]
enum Step {
    Key(String),
    Index(usize),
}

/// Breaks the value `choice` picks in `data`. The root stays an object.
pub fn break_one(data: &mut Value, choice: u64) {
    let mut paths = Vec::new();
    collect(data, &mut Vec::new(), &mut paths);
    if paths.is_empty() {
        return;
    }
    let path = &paths[(choice % paths.len() as u64) as usize];
    let how = (choice / paths.len() as u64) % 4;
    let Some((last, parent)) = path.split_last() else {
        return;
    };
    let Some(parent) = walk(data, parent) else {
        return;
    };
    match (how, parent, last) {
        (0, Value::Object(map), Step::Key(key)) => {
            map.remove(key);
        }
        (0, Value::Array(items), Step::Index(index)) => {
            items.remove(*index);
        }
        (1, parent, last) => {
            if let Some(value) = child(parent, last) {
                *value = wrong_type(value);
            }
        }
        (2, parent, last) => {
            if let Some(value) = child(parent, last) {
                // Nulling a null would replay the response unchanged.
                *value = match value {
                    Value::Null => wrong_type(value),
                    _ => Value::Null,
                };
            }
        }
        (_, parent, last) => {
            if let Some(value) = child(parent, last) {
                match value {
                    Value::Object(map) if map.contains_key("__typename") => {
                        map.insert("__typename".into(), Value::String("NoSuchType".into()));
                    }
                    other => *other = wrong_type(other),
                }
            }
        }
    }
}

fn collect(value: &Value, path: &mut Vec<Step>, out: &mut Vec<Vec<Step>>) {
    let children: Vec<(Step, &Value)> = match value {
        // Sorted, so the pick does not depend on whether serde_json keeps insertion order.
        Value::Object(map) => {
            let mut children: Vec<(Step, &Value)> = map
                .iter()
                .map(|(key, child)| (Step::Key(key.clone()), child))
                .collect();
            children.sort_by(|(a, _), (b, _)| match (a, b) {
                (Step::Key(a), Step::Key(b)) => a.cmp(b),
                _ => std::cmp::Ordering::Equal,
            });
            children
        }
        Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(index, child)| (Step::Index(index), child))
            .collect(),
        _ => return,
    };
    for (step, child) in children {
        path.push(step);
        out.push(path.clone());
        collect(child, path, out);
        path.pop();
    }
}

fn walk<'a>(value: &'a mut Value, path: &[Step]) -> Option<&'a mut Value> {
    path.iter()
        .try_fold(value, |value, step| child(value, step))
}

fn child<'a>(value: &'a mut Value, step: &Step) -> Option<&'a mut Value> {
    match (value, step) {
        (Value::Object(map), Step::Key(key)) => map.get_mut(key),
        (Value::Array(items), Step::Index(index)) => items.get_mut(*index),
        _ => None,
    }
}

fn wrong_type(value: &Value) -> Value {
    match value {
        Value::String(_) => Value::from(7),
        Value::Null => Value::Object(Default::default()),
        _ => Value::String("x".into()),
    }
}
