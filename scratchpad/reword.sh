#!/usr/bin/env bash
git commit -q --amend -m "refactor(graphql-channel): box the activity variant of a timeline entry

Why: the activity variant was far larger than the boxed message variant,
which made every timeline entry as large as an activity.

What: the activity variant is boxed like the message variant."
