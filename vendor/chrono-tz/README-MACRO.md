# chrono-tz 0.10.4, with newer tzdata

`chrono-tz` compiles the IANA time zone database into its tables, and crates.io
releases lag IANA releases by months. This copy keeps the published 0.10.4 code
unchanged and replaces its data, so every crate that resolves a zone (calendar
recurrence and all-day dates, scheduling, reminders, agent and email times)
uses the release pinned here. `IANA_TZDB_VERSION` reports that release.

To move to a new IANA release, run:

```sh
vendor/chrono-tz/update-tzdata.sh 2026f
```

The script downloads the release from data.iana.org, checks its signature
against the tz maintainer's key, writes the zone files to `tz/` and regenerates
`src/prebuilt/`. Commit both directories, with a test of the rule change that
prompted the update in the crate whose behaviour it fixes.

Differences from the published crate:

- `tz/` holds a newer IANA release, with comments removed. The generator drops
  comments, so the tables are the same; the comments carry contributor email
  addresses, which the repository's PII scan rejects. `tz/NEWS` keeps only the
  release heading the generator reads the version from.
- `src/prebuilt/` is regenerated from `tz/`.
- `update-tzdata.sh` and this file are new.

Drop this copy once a crates.io release bundles a release at least as new as
the one here.
