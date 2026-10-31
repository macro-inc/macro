//! Random steps: user actions, Gmail answers, deliveries, syncs and waits.

use super::super::fake_gmail::{PauseAt, Reply};
use super::super::world::{MESSAGES, THREADS};
use super::{Action, Config, Sim, Step};
use rand::Rng;

impl Sim<'_> {
    pub(super) fn random_reply(&mut self, ok: f64) -> Reply {
        let roll: f64 = self.rng.random();
        if roll < ok {
            Reply::Ok
        } else if roll < ok + (1.0 - ok) * 0.65 {
            Reply::RateLimited
        } else if roll < ok + (1.0 - ok) * 0.9 || std::env::var("SIM_NO_REJECT").is_ok() {
            Reply::Unavailable
        } else {
            Reply::Rejected
        }
    }

    pub(super) fn random_action(&mut self) -> Action {
        let thread = self.rng.random_range(0..THREADS.len());
        let value = self.rng.random_bool(0.5);
        match self.rng.random_range(0..100) {
            0..35 => Action::Archive(thread, value),
            35..55 => Action::Read(thread, value),
            55..65 => Action::Star(thread, value),
            65..75 => Action::Label(thread, value),
            75..85 => Action::Trash(thread, value),
            _ => {
                let threads: Vec<usize> = (0..THREADS.len())
                    .filter(|_| self.rng.random_bool(0.6))
                    .collect();
                if threads.is_empty() {
                    Action::Archive(thread, value)
                } else {
                    Action::BulkArchive(threads, value)
                }
            }
        }
    }

    pub(super) fn random_simple_step(&mut self) -> Step {
        match self.rng.random_range(0..100) {
            0..32 => Step::Action {
                action: self.random_action(),
                enqueue_fails: self.rng.random_bool(0.08),
            },
            32..70 => Step::Deliver {
                reply: self.random_reply(0.45),
                gate_refuses: self.rng.random_bool(0.1),
                enqueue_fails: self.rng.random_bool(0.05),
            },
            70..86 => Step::Sync {
                message: self.rng.random_range(0..MESSAGES.len()),
                reply: if self.rng.random_bool(0.85) {
                    Reply::Ok
                } else {
                    Reply::RateLimited
                },
            },
            86..92 => Step::Resync {
                message: self.rng.random_range(0..MESSAGES.len()),
                reply: if self.rng.random_bool(0.9) {
                    Reply::Ok
                } else {
                    Reply::RateLimited
                },
            },
            _ => Step::Wait {
                seconds: self.rng.random_range(1..400),
            },
        }
    }

    pub fn random_step(&mut self, config: Config) -> Step {
        let roll = self.rng.random_range(0..1000);
        if roll < 8 {
            return Step::Expire;
        }
        if config.overlap && roll < 90 {
            let first = match self.rng.random_range(0..3) {
                0 => Step::Sync {
                    message: self.rng.random_range(0..MESSAGES.len()),
                    reply: Reply::Ok,
                },
                1 => Step::Resync {
                    message: self.rng.random_range(0..MESSAGES.len()),
                    reply: Reply::Ok,
                },
                _ => Step::Deliver {
                    reply: self.random_reply(0.6),
                    gate_refuses: false,
                    enqueue_fails: false,
                },
            };
            let count = self.rng.random_range(1..=3);
            let mut seconds = Vec::new();
            while seconds.len() < count {
                let step = self.random_simple_step();
                if !matches!(step, Step::Wait { .. }) {
                    seconds.push(step);
                }
            }
            let at = if self.rng.random_bool(0.5) {
                PauseAt::BeforeApply
            } else {
                PauseAt::AfterApply
            };
            return Step::Overlap {
                first: Box::new(first),
                seconds,
                at,
            };
        }
        self.random_simple_step()
    }
}
