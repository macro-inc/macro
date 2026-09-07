use super::*;

#[test]
fn spinner_draw_stays_away_from_wide_terminal_right_edge() {
    assert_eq!(spinner_draw_width(240), SPINNER_MAX_WIDTH);
}

#[test]
fn spinner_draw_tracks_narrow_terminal_widths() {
    assert_eq!(spinner_draw_width(40), 40);
    assert_eq!(spinner_draw_width(0), 1);
}

#[test]
fn stages_record_their_elapsed_time() {
    let stage = Stage::from_env();
    stage.run_step("work", || Ok(())).unwrap();
    let timings = stage.timings.lock().unwrap();
    assert_eq!(timings.len(), 1);
    assert_eq!(timings[0].0, "work");
}

/// Sub-steps folded under a parent spinner, and the background lanes, must land
/// in the same table — otherwise the summary omits exactly the slow parts that
/// run off the main thread.
#[test]
fn quiet_and_background_children_record_into_the_parent() {
    let stage = Stage::from_env();
    stage.quiet().run_step("folded", || Ok(())).unwrap();
    let background = stage.background();
    std::thread::spawn(move || background.run_step("lane", || Ok(())))
        .join()
        .unwrap()
        .unwrap();
    let recorded: Vec<String> = stage
        .timings
        .lock()
        .unwrap()
        .iter()
        .map(|(label, _)| label.clone())
        .collect();
    assert_eq!(recorded, vec!["folded", "lane"]);
}

#[test]
fn a_failed_stage_is_still_recorded() {
    let stage = Stage::from_env();
    let _ = stage.run_step("doomed", || anyhow::bail!("no"));
    assert_eq!(stage.timings.lock().unwrap()[0].0, "doomed");
}
