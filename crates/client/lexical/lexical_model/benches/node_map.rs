//! Real snapshots retained across every write; medians and p95 in microseconds.
//! Run with `cargo bench -p lexical_model --bench node_map -j4`.
use lexical_model::*;
use std::{hint::black_box, time::Instant};

fn main() -> Result<(), Error> {
    println!("nodes,mode,operation,samples,median_us,p95_us");
    for count in [190, 3835, 36530] {
        for mode in [EditorMode::Headless, EditorMode::ViewAttached] {
            let mut editor = Editor::builder(mode).build().expect("registry");
            let (target, _) = editor.update(|tx| {
                let mut target = NodeKey::ROOT;
                let mut remaining = count - 1;
                while remaining > 0 {
                    let p = tx.create(Paragraph::default())?;
                    tx.append(NodeKey::ROOT, &[p.key()])?;
                    remaining -= 1;
                    // About nine leaves per block; alternating formats prevent merging.
                    for i in 0..remaining.min(9) {
                        let text = tx.create_text("a short text")?;
                        tx.text(text)?.set_format(if i % 2 == 0 {
                            TextFormat::empty()
                        } else {
                            TextFormat::BOLD
                        })?;
                        tx.append(p, &[text.key()])?;
                        remaining -= 1;
                        if i % 2 == 0 && remaining < count / 2 && target == NodeKey::ROOT {
                            target = text.key();
                        }
                    }
                }
                Ok(target)
            })?;
            assert_eq!(editor.state().node_count(), count);
            let initial = editor.state().clone();
            for operation in ["write_rollback", "keystroke", "keystroke_diff"] {
                editor.set_editor_state(initial.clone(), TagSet::default())?;
                let samples = if count == 36530 { 300 } else { 1000 };
                let mut times = Vec::with_capacity(samples);
                for iteration in 0..samples + 50 {
                    let previous = editor.state().clone();
                    let start = Instant::now();
                    if operation == "write_rollback" {
                        let mut tx = editor.transaction();
                        tx.text(target)?.set_text_content("changed text")?;
                        black_box(tx.view().text_data(target)?);
                        drop(tx);
                    } else {
                        let (_, commit) = editor.update(|tx| {
                            tx.text(target)?
                                .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
                            tx.insert_text("x")
                        })?;
                        if operation == "keystroke_diff" {
                            black_box(commit.diff(&DiffOptions::default())?);
                        }
                        black_box(commit);
                    }
                    let elapsed = start.elapsed().as_secs_f64() * 1e6;
                    black_box(previous);
                    if iteration >= 50 {
                        times.push(elapsed);
                    }
                }
                assert_eq!(editor.state().node_count(), count);
                times.sort_by(f64::total_cmp);
                println!(
                    "{count},{mode:?},{operation},{samples},{:.3},{:.3}",
                    times[samples / 2],
                    times[samples * 95 / 100]
                );
            }
        }
    }
    Ok(())
}
