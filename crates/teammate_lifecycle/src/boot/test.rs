use super::*;

fn commit(digit: char) -> CommitId {
    CommitId::new(digit.to_string().repeat(40)).unwrap()
}

fn fits() -> CodeFacts {
    CodeFacts {
        needs: Ok(1),
        lock_matches_image: true,
        dependencies_edited: false,
    }
}

#[test]
fn a_healthy_boot_starts_the_count_again() {
    // The runtime wrote last-good for the boot's head: any end of it,
    // even a crash, starts the count again.
    let state = BootState {
        failed_boots: 2,
        boot_head: Some(commit('a')),
        last_good: Some(commit('a')),
    };
    assert_eq!(count_previous(&state, PreviousExit::Exited { code: 1 }), 0);
    assert_eq!(count_previous(&state, PreviousExit::Exited { code: 75 }), 0);
}

#[test]
fn which_exits_count_as_failed_boots() {
    let state = BootState {
        failed_boots: 1,
        boot_head: Some(commit('b')),
        last_good: Some(commit('a')),
    };
    assert_eq!(count_previous(&state, PreviousExit::Exited { code: 0 }), 1);
    assert_eq!(count_previous(&state, PreviousExit::Exited { code: 75 }), 1);
    assert_eq!(count_previous(&state, PreviousExit::Exited { code: 77 }), 1);
    assert_eq!(count_previous(&state, PreviousExit::Exited { code: 79 }), 1);
    assert_eq!(count_previous(&state, PreviousExit::Exited { code: 78 }), 2);
    assert_eq!(count_previous(&state, PreviousExit::Exited { code: 1 }), 2);
    assert_eq!(
        count_previous(&state, PreviousExit::Exited { code: 137 }),
        2
    );
}

#[test]
fn a_bad_setting_on_last_good_is_retried_once_then_77() {
    let on_last_good = BootState {
        failed_boots: 0,
        boot_head: Some(commit('a')),
        last_good: Some(commit('a')),
    };
    // The first 78 is retried: this start goes ahead and finds it again.
    assert_eq!(
        admit(
            &on_last_good,
            PreviousExit::Exited { code: 1 },
            &Err(SettingsProblem::Missing("MACRO_REPO_TOKEN"))
        ),
        Err(BootExit::InvalidSetting(SettingsProblem::Missing(
            "MACRO_REPO_TOKEN"
        )))
    );
    // The runtime's own 78 on last-good: the next start ends in 77, even
    // though agent.env reads fine.
    let ended = admit(&on_last_good, PreviousExit::Exited { code: 78 }, &Ok(()));
    assert_eq!(ended, Err(BootExit::SettingsWrongNotCode));
    assert_eq!(BootExit::SettingsWrongNotCode.code(), 77);
}

#[test]
fn a_bad_setting_on_new_code_is_not_77() {
    let on_new_code = BootState {
        failed_boots: 1,
        boot_head: Some(commit('b')),
        last_good: Some(commit('a')),
    };
    assert_eq!(
        admit(&on_new_code, PreviousExit::Exited { code: 78 }, &Ok(())),
        Ok(())
    );
}

#[test]
fn agent_env_wrong_twice_is_77_whatever_the_code() {
    // agent.env isn't code: a rollback can't fix it, so the second start
    // that finds it wrong gives up.
    let on_new_code = BootState {
        failed_boots: 1,
        boot_head: Some(commit('b')),
        last_good: Some(commit('a')),
    };
    assert_eq!(
        admit(
            &on_new_code,
            PreviousExit::Exited { code: 78 },
            &Err(SettingsProblem::RepoUrlNotHttp)
        ),
        Err(BootExit::SettingsWrongNotCode)
    );
}

#[test]
fn a_bad_setting_with_no_last_good_is_77_on_the_next_start() {
    let fresh = BootState::default();
    assert_eq!(
        admit(&fresh, PreviousExit::Exited { code: 78 }, &Ok(())),
        Err(BootExit::SettingsWrongNotCode)
    );
    assert_eq!(admit(&fresh, PreviousExit::Unknown, &Ok(())), Ok(()));
}

#[test]
fn the_third_failed_boot_rolls_back() {
    let plan = plan_boot(&BootInput {
        failed_boots: 3,
        head: commit('b'),
        head_code: fits(),
        last_good: Some((commit('a'), fits())),
        image_level: Ok(1),
    });
    assert_eq!(
        plan,
        BootPlan {
            steps: vec![
                BootStep::RollBack {
                    to: commit('a'),
                    reason: RollbackReason::FailedBoots { count: 3 },
                },
                BootStep::RecordBootHead,
                BootStep::LinkModules,
            ],
            end: Ok(()),
        }
    );

    let two = plan_boot(&BootInput {
        failed_boots: 2,
        head: commit('b'),
        head_code: fits(),
        last_good: Some((commit('a'), fits())),
        image_level: Ok(1),
    });
    assert_eq!(
        two.steps,
        vec![BootStep::RecordBootHead, BootStep::LinkModules]
    );
}

#[test]
fn last_good_itself_never_rolls_back() {
    let plan = plan_boot(&BootInput {
        failed_boots: 5,
        head: commit('a'),
        head_code: fits(),
        last_good: Some((commit('a'), fits())),
        image_level: Ok(1),
    });
    assert_eq!(
        plan.steps,
        vec![BootStep::RecordBootHead, BootStep::LinkModules]
    );
}

#[test]
fn the_image_lock_is_adopted_unless_the_dependencies_changed() {
    let stale_lock = CodeFacts {
        lock_matches_image: false,
        ..fits()
    };
    let plan = plan_boot(&BootInput {
        failed_boots: 0,
        head: commit('a'),
        head_code: stale_lock.clone(),
        last_good: None,
        image_level: Ok(1),
    });
    assert_eq!(
        plan,
        BootPlan {
            steps: vec![
                BootStep::RecordBootHead,
                BootStep::AdoptLock,
                BootStep::RecordBootHead,
                BootStep::LinkModules,
            ],
            end: Ok(()),
        }
    );

    let edited = plan_boot(&BootInput {
        failed_boots: 0,
        head: commit('a'),
        head_code: CodeFacts {
            dependencies_edited: true,
            ..stale_lock
        },
        last_good: None,
        image_level: Ok(1),
    });
    // Recorded first, so the next start counts the failure against it.
    assert_eq!(
        edited,
        BootPlan {
            steps: vec![BootStep::RecordBootHead],
            end: Err(BootExit::DependenciesChanged),
        }
    );
}

#[test]
fn incompatible_code_with_a_compatible_last_good_rolls_back_in_the_same_boot() {
    let plan = plan_boot(&BootInput {
        failed_boots: 0,
        head: commit('b'),
        head_code: CodeFacts {
            needs: Ok(2),
            ..fits()
        },
        last_good: Some((
            commit('a'),
            CodeFacts {
                lock_matches_image: false,
                ..fits()
            },
        )),
        image_level: Ok(1),
    });
    assert_eq!(
        plan,
        BootPlan {
            steps: vec![
                BootStep::RecordBootHead,
                BootStep::LinkModules,
                BootStep::RollBack {
                    to: commit('a'),
                    reason: RollbackReason::NeedsNewerImage { needs: 2, has: 1 },
                },
                BootStep::RecordBootHead,
                BootStep::AdoptLock,
                BootStep::RecordBootHead,
            ],
            end: Ok(()),
        }
    );
}

#[test]
fn incompatible_code_with_nothing_that_fits_is_79() {
    let needs_two = CodeFacts {
        needs: Ok(2),
        ..fits()
    };
    let cases = [
        // A new agent: no last-good.
        None,
        // Last-good is the head.
        Some((commit('b'), needs_two.clone())),
        // Last-good needs more too, as after an image rollback.
        Some((commit('a'), needs_two.clone())),
        // Last-good's package.json can't be read.
        Some((
            commit('a'),
            CodeFacts {
                needs: Err(Garbled),
                ..fits()
            },
        )),
    ];
    for last_good in cases {
        let plan = plan_boot(&BootInput {
            failed_boots: 0,
            head: commit('b'),
            head_code: needs_two.clone(),
            last_good,
            image_level: Ok(1),
        });
        assert_eq!(
            plan.end,
            Err(BootExit::NeedsNewerImage { needs: 2, has: 1 })
        );
        assert_eq!(BootExit::NeedsNewerImage { needs: 2, has: 1 }.code(), 79);
    }
}

#[test]
fn code_rolled_back_for_failed_boots_is_not_rolled_back_again() {
    // Rolled back after three failures to a last-good that needs more than
    // the image: 79, not a second rollback.
    let plan = plan_boot(&BootInput {
        failed_boots: 3,
        head: commit('b'),
        head_code: fits(),
        last_good: Some((
            commit('a'),
            CodeFacts {
                needs: Ok(2),
                ..fits()
            },
        )),
        image_level: Ok(1),
    });
    assert_eq!(
        plan.end,
        Err(BootExit::NeedsNewerImage { needs: 2, has: 1 })
    );
}

#[test]
fn garbled_levels_are_78() {
    let garbled_need = plan_boot(&BootInput {
        failed_boots: 0,
        head: commit('a'),
        head_code: CodeFacts {
            needs: Err(Garbled),
            ..fits()
        },
        last_good: None,
        image_level: Ok(1),
    });
    assert_eq!(garbled_need.end, Err(BootExit::GarbledNeed));
    let garbled_image = plan_boot(&BootInput {
        failed_boots: 0,
        head: commit('a'),
        head_code: fits(),
        last_good: None,
        image_level: Err(Garbled),
    });
    assert_eq!(garbled_image.end, Err(BootExit::GarbledImageLevel));
    assert_eq!(BootExit::GarbledNeed.code(), 78);
    assert_eq!(BootExit::GarbledImageLevel.code(), 78);
}

#[test]
fn a_land_that_breaks_its_settings_rolls_back_before_77() {
    // The land's code exits 78 on every start (its own settings are
    // wrong); last-good's code is fine. Each start counts the last, and
    // never gives up first.
    let mut state = BootState {
        failed_boots: 0,
        boot_head: Some(commit('a')),
        last_good: Some(commit('a')),
    };
    let mut previous = PreviousExit::Exited { code: 75 };
    for start in 1..=4 {
        state.failed_boots = count_previous(&state, previous);
        assert_eq!(admit(&state, previous, &Ok(())), Ok(()), "start {start}");
        let plan = plan_boot(&BootInput {
            failed_boots: state.failed_boots,
            head: commit('b'),
            head_code: fits(),
            last_good: Some((commit('a'), fits())),
            image_level: Ok(1),
        });
        if start < 4 {
            assert_eq!(plan.steps[0], BootStep::RecordBootHead, "start {start}");
            state.boot_head = Some(commit('b'));
            previous = PreviousExit::Exited { code: 78 };
        } else {
            assert_eq!(
                plan.steps[0],
                BootStep::RollBack {
                    to: commit('a'),
                    reason: RollbackReason::FailedBoots { count: 3 },
                }
            );
        }
    }
}

#[test]
fn commit_ids_are_hex() {
    assert!(CommitId::new("a".repeat(40)).is_ok());
    assert!(CommitId::new("a".repeat(64)).is_ok());
    assert!(CommitId::new("A".repeat(40)).is_err());
    assert!(CommitId::new("a".repeat(39)).is_err());
    assert!(CommitId::new(format!("{}\n", "a".repeat(40))).is_err());
}

#[test]
fn an_unknown_exit_of_a_boot_that_never_became_healthy_counts_once() {
    // The previous boot ran other code than last-good and never marked
    // itself healthy: whatever ended it, it failed.
    let unhealthy = BootState {
        failed_boots: 1,
        boot_head: Some(commit('b')),
        last_good: Some(commit('a')),
    };
    assert_eq!(count_previous(&unhealthy, PreviousExit::Unknown), 2);
    // Healthy, or nothing booted: nothing to count.
    let healthy = BootState {
        failed_boots: 1,
        boot_head: Some(commit('a')),
        last_good: Some(commit('a')),
    };
    assert_eq!(count_previous(&healthy, PreviousExit::Unknown), 0);
    assert_eq!(
        count_previous(&BootState::default(), PreviousExit::Unknown),
        0
    );
    // No last-good yet: a boot head that never became healthy counts.
    let first = BootState {
        failed_boots: 0,
        boot_head: Some(commit('b')),
        last_good: None,
    };
    assert_eq!(count_previous(&first, PreviousExit::Unknown), 1);
}

#[test]
fn changed_dependencies_roll_back_in_the_same_boot_to_a_last_good_with_the_templates() {
    let edited = CodeFacts {
        lock_matches_image: false,
        dependencies_edited: true,
        ..fits()
    };
    let plan = plan_boot(&BootInput {
        failed_boots: 0,
        head: commit('b'),
        head_code: edited.clone(),
        last_good: Some((
            commit('a'),
            CodeFacts {
                lock_matches_image: false,
                ..fits()
            },
        )),
        image_level: Ok(1),
    });
    assert_eq!(
        plan,
        BootPlan {
            steps: vec![
                BootStep::RecordBootHead,
                BootStep::RollBack {
                    to: commit('a'),
                    reason: RollbackReason::DependenciesChanged,
                },
                BootStep::RecordBootHead,
                BootStep::AdoptLock,
                BootStep::RecordBootHead,
                BootStep::LinkModules,
            ],
            end: Ok(()),
        }
    );

    // A last-good that changed them too can't help: 79.
    let no_fit = plan_boot(&BootInput {
        failed_boots: 0,
        head: commit('b'),
        head_code: edited.clone(),
        last_good: Some((commit('a'), edited)),
        image_level: Ok(1),
    });
    assert_eq!(no_fit.end, Err(BootExit::DependenciesChanged));
    assert_eq!(BootExit::DependenciesChanged.code(), 79);
}

#[test]
fn a_requested_stop_before_the_healthy_marker_whose_exit_was_lost_counts_once() {
    // Deliberate: macrod asked for a stop (which it passes as 0, never
    // counted), but it lost the exit, so the next start sees `unknown`.
    // The boot never marked itself healthy, so it counts as one failed
    // boot: a lost exit must never hide a crash, and that costs at most one
    // count for a stop.
    let stopped_early = BootState {
        failed_boots: 0,
        boot_head: Some(commit('b')),
        last_good: Some(commit('a')),
    };
    let counted = count_previous(&stopped_early, PreviousExit::Unknown);
    assert_eq!(counted, 1);
    // The next start's own boot head is recorded before it can fail, and
    // its exit is then known: the same unknown is never counted twice.
    let next = BootState {
        failed_boots: counted,
        ..stopped_early
    };
    assert_eq!(count_previous(&next, PreviousExit::Exited { code: 0 }), 1);
}
