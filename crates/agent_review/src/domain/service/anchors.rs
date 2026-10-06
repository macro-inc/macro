//! Conservative exact-text relocation; duplicate matches stay explicitly outdated.

use diffd_core::model::{FileDiff, Side};
use uuid::Uuid;

use crate::domain::model::{Anchor, AnchorStatus, Location, Result, ReviewError};

pub(super) fn create(revision: u32, location: Location, file: &FileDiff) -> Result<Anchor> {
    let side = match location.side {
        Side::Old => &file.old,
        Side::New => &file.new,
    };
    let lines = &side.as_ref().ok_or(ReviewError::NotFound)?.lines;
    let end = location.end_line.unwrap_or(location.line);
    if location.line == 0
        || end < location.line
        || end as usize > lines.len()
        || end - location.line > 500
    {
        return Err(ReviewError::Invalid(
            "Select a valid range of at most 501 lines".into(),
        ));
    }
    if lines[location.line as usize - 1..end as usize]
        .iter()
        .map(|line| line.len() + 1)
        .sum::<usize>()
        > 16_384
    {
        return Err(ReviewError::Invalid(
            "Select at most 16 KiB of code for a comment or citation".into(),
        ));
    }
    Ok(Anchor {
        id: Uuid::now_v7(),
        revision,
        excerpt: lines[location.line as usize - 1..end as usize].to_vec(),
        original: location.clone(),
        current: location,
        status: AnchorStatus::Current,
    })
}

pub(super) fn follow(anchor: &mut Anchor, files: &[FileDiff]) {
    let Some(file) = files.iter().find(|f| {
        f.path == anchor.current.path || f.old_path.as_ref() == Some(&anchor.current.path)
    }) else {
        anchor.status = AnchorStatus::Outdated;
        return;
    };
    let side = match anchor.current.side {
        Side::Old => &file.old,
        Side::New => &file.new,
    };
    let Some(side) = side else {
        anchor.status = AnchorStatus::Outdated;
        return;
    };
    let matches: Vec<_> = side
        .lines
        .windows(anchor.excerpt.len())
        .enumerate()
        .filter_map(|(i, lines)| (lines == anchor.excerpt).then_some(i))
        .take(2)
        .collect();
    if matches.len() != 1 {
        anchor.status = AnchorStatus::Outdated;
        return;
    }
    let line = matches[0] as u32 + 1;
    anchor.status = if line == anchor.current.line && file.path == anchor.current.path {
        AnchorStatus::Current
    } else {
        AnchorStatus::Moved
    };
    anchor.current.path.clone_from(&file.path);
    anchor.current.line = line;
    anchor.current.end_line = anchor
        .original
        .end_line
        .map(|_| line + anchor.excerpt.len() as u32 - 1);
}
