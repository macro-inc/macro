//! Procedural figures beyond the classic mesh man, built in code: XRAY,
//! CYBORG and NEURAL.

mod common;
mod cyborg;
mod neural;
mod xray;

use crate::figure::Figure;
use common::Draft;

/// The procedural figures, in viewer order.
pub(crate) fn procedural() -> Vec<Figure> {
    vec![
        finish("XRAY", xray::build()),
        finish("CYBORG", cyborg::build()),
        finish("NEURAL", neural::build()),
    ]
}

/// A draft as a figure.
fn finish(name: &str, draft: Draft) -> Figure {
    let mut builder = Figure::builder(name);
    for (a, b) in draft.skin {
        builder.skin(a, b);
    }
    for (a, b) in draft.extra {
        builder.extra(a, b);
    }
    for (a, b) in draft.bones {
        builder.bone(a, b);
    }
    for (a, b) in draft.brain {
        builder.brain(a, b);
    }
    for (a, b) in draft.nerves {
        builder.nerve_line(a, b);
    }
    for (path, points) in draft.paths {
        builder.nerve(path, points);
    }
    for group in &draft.forks {
        builder.fork_group(group);
    }
    if let Some(core) = draft.core {
        builder.core(core);
    }
    builder.look(draft.look).quiet_paths();
    builder.build()
}

#[cfg(test)]
mod test;
