# Universal Input behavior baseline

`baseline.json` holds 25 input variants and their expected intent and fields.
It preserves multiline messages and checks the complete requested message body,
task title/body/priority/deadline, event start/invitees, note body, and search
category/sender/query. It also checks email To/Cc/subject/body separation and a
message addressed to a named channel, task search facets, and unsupported document
sender wording retained as keywords. Fields without an expectation are left
unconstrained.

`generalization.json` adds 35 separately authored variations covering retrieval
versus creation, questions versus record lists, opening actions with conflicting
body topics, multiword channel recipients, weekday order/abbreviations, and
supported versus unsupported search filters. This is a development regression
suite, not an untouched holdout; validate final rules on fresh phrases as well.
Follow the [prompt evaluation guidance](../prompts/README.md) and
do not change expectations to accommodate predictions. Run the command below,
adding `--suite crates/universal_input/eval/generalization.json`; save a separate
before/after report because each suite has its own fixture hash. Intent-only
expectations check routing, while the search and calendar groups also check fields.

The clock is fixed at **2026-10-27 12:00 UTC**. All three dinner variants expect
the upcoming Monday, **November 2 at 19:00**. Tomorrow morning is
**October 28 at 08:00**, and a task due in one week is due **November 3**. These
are local times in the fixture's `time_zone`; changing the clock/timezone creates
a different baseline.

Run against a local or test harness with an existing account's bearer token in
`UNIVERSAL_INPUT_AUTH_TOKEN`, or with `INTERNAL_API_KEY` and
`UNIVERSAL_INPUT_USER_ID` set in the environment:

```sh
python3 crates/universal_input/eval/compare.py \
  --url https://localhost:8090/agent-harness \
  --ca-file infra/local/certs/ca.pem \
  --report /tmp/universal-input-before.json
```

Use the selected instance's URL. The runner only calls `classify` and `extract`;
it never submits drafts, sends messages, or creates content. Inference uses the
configured model providers. Fixture aliases resolve extracted names to expected
addresses without looking up or creating actual accounts. The channel fixture
represents an available channel the user belongs to; extracted names match its
full name without regard to case. This runner checks extraction, while
`apps/web/src/features/universal-input/core/recipients.test.ts` checks resolution
against the frontend's available recipient options, including a missing channel.
Recipient order and priority capitalization are ignored. Title expectations list
acceptable forms with or without a reporter prefix and ignore capitalization/trailing
punctuation; they still reject a description merged into the title. Message and
note bodies remain exact after trimming outside whitespace. A null search query
is equivalent to an empty one.

Search extraction returns a canonical `type` and only that type's fields. The
runner compares task status, priority, assignees and creators as separate facets;
channel sender filters remain separate from task creators.

The runner selects the highest-scoring intent, as the composer does. It does not
force the expected type when classification is wrong. Failures therefore show
the actual behavior, including missing fields caused by a wrong classification.
Each case records scores, raw suggestions, per-field comparisons, and latency.
Reports also record the endpoint, fixture hash, fixed clock, and runner checkout
commit; the checkout commit does not identify a separately deployed backend.
Credentials are never written to the report.

After changing prompts or providers, compare another run with the saved report:

```sh
python3 crates/universal_input/eval/compare.py \
  --url https://localhost:8090/agent-harness \
  --ca-file infra/local/certs/ca.pem \
  --report /tmp/universal-input-after.json \
  --compare /tmp/universal-input-before.json
```

The comparison lists newly failing and newly passing cases. Exit status is 1
when any expectation fails; expected mismatches should be reviewed rather than
rewriting the baseline to fit the current model. This is an opt-in evaluation,
not a network-dependent unit-test gate.
Provider outputs can vary between runs; compare several reports before attributing
a changed case to a code change.

Test the comparison logic without a backend or model credentials:

```sh
python3 -m unittest discover -s crates/universal_input/eval -p 'test_*.py'
```
