//! Verbatim Source run07 fixture bindings; paths are compile-time only.
// See corpus/list-item-indent/provenance.json for original bytes, command, source and log pins.

pub(super) struct Stored {
    pub name: &'static str,
    pub state: &'static [u8],
}
pub(super) struct Phase {
    pub name: &'static str,
    pub expected: &'static [u8],
    pub batches: &'static [&'static [&'static [u8]]],
}
pub(super) struct Remote {
    pub name: &'static str,
    pub initial: &'static [u8],
    pub snapshot: &'static [u8],
    pub source_rows: &'static str,
    pub phases: &'static [Phase],
}

pub(super) const STORED: &[Stored] = &[
    Stored {
        name: "bullet",
        state: include_bytes!("../corpus/list-item-indent/stored/bullet.json"),
    },
    Stored {
        name: "number",
        state: include_bytes!("../corpus/list-item-indent/stored/number.json"),
    },
    Stored {
        name: "check",
        state: include_bytes!("../corpus/list-item-indent/stored/check.json"),
    },
];

pub(super) const REMOTE: &[Remote] = &[
    Remote {
        name: "bullet",
        initial: include_bytes!("../corpus/list-item-indent/remote/bullet/initial.json"),
        snapshot: include_bytes!("../corpus/list-item-indent/remote/bullet/initial.snapshot.bin"),
        source_rows: include_str!("../corpus/list-item-indent/remote/bullet/source-receiver.jsonl"),
        phases: &[
            Phase {
                name: "initial-nested",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/initial-nested.source.json"
                ),
                batches: &[
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/bullet/initial-nested-0-0.update.bin"
                    )],
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/bullet/initial-nested-1-0.update.bin"
                    )],
                ],
            },
            Phase {
                name: "outdent",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/outdent.source.json"
                ),
                batches: &[
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/bullet/outdent-0-0.update.bin"
                    )],
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/bullet/outdent-1-0.update.bin"
                    )],
                ],
            },
            Phase {
                name: "nest",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/nest.source.json"
                ),
                batches: &[
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/bullet/nest-0-0.update.bin"
                    )],
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/bullet/nest-1-0.update.bin"
                    )],
                ],
            },
            Phase {
                name: "reparent",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/reparent.source.json"
                ),
                batches: &[
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/bullet/reparent-0-0.update.bin"
                    )],
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/bullet/reparent-1-0.update.bin"
                    )],
                ],
            },
            Phase {
                name: "paragraph-1",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/paragraph-1.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/paragraph-1-0-0.update.bin"
                )]],
            },
            Phase {
                name: "paragraph-3",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/paragraph-3.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/paragraph-3-0-0.update.bin"
                )]],
            },
            Phase {
                name: "paragraph-0",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/paragraph-0.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/paragraph-0-0-0.update.bin"
                )]],
            },
            Phase {
                name: "heading-1",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/heading-1.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/heading-1-0-0.update.bin"
                )]],
            },
            Phase {
                name: "heading-0",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/heading-0.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/bullet/heading-0-0-0.update.bin"
                )]],
            },
        ],
    },
    Remote {
        name: "number",
        initial: include_bytes!("../corpus/list-item-indent/remote/number/initial.json"),
        snapshot: include_bytes!("../corpus/list-item-indent/remote/number/initial.snapshot.bin"),
        source_rows: include_str!("../corpus/list-item-indent/remote/number/source-receiver.jsonl"),
        phases: &[
            Phase {
                name: "initial-nested",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/number/initial-nested.source.json"
                ),
                batches: &[
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/number/initial-nested-0-0.update.bin"
                    )],
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/number/initial-nested-1-0.update.bin"
                    )],
                ],
            },
            Phase {
                name: "outdent",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/number/outdent.source.json"
                ),
                batches: &[
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/number/outdent-0-0.update.bin"
                    )],
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/number/outdent-1-0.update.bin"
                    )],
                ],
            },
            Phase {
                name: "nest",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/number/nest.source.json"
                ),
                batches: &[
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/number/nest-0-0.update.bin"
                    )],
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/number/nest-1-0.update.bin"
                    )],
                ],
            },
            Phase {
                name: "reparent",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/number/reparent.source.json"
                ),
                batches: &[
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/number/reparent-0-0.update.bin"
                    )],
                    &[include_bytes!(
                        "../corpus/list-item-indent/remote/number/reparent-1-0.update.bin"
                    )],
                ],
            },
            Phase {
                name: "paragraph-1",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/number/paragraph-1.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/number/paragraph-1-0-0.update.bin"
                )]],
            },
            Phase {
                name: "paragraph-3",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/number/paragraph-3.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/number/paragraph-3-0-0.update.bin"
                )]],
            },
            Phase {
                name: "paragraph-0",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/number/paragraph-0.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/number/paragraph-0-0-0.update.bin"
                )]],
            },
            Phase {
                name: "heading-1",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/number/heading-1.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/number/heading-1-0-0.update.bin"
                )]],
            },
            Phase {
                name: "heading-0",
                expected: include_bytes!(
                    "../corpus/list-item-indent/remote/number/heading-0.source.json"
                ),
                batches: &[&[include_bytes!(
                    "../corpus/list-item-indent/remote/number/heading-0-0-0.update.bin"
                )]],
            },
        ],
    },
];
