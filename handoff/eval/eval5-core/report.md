Seconds; quality is the share of drafts passing every mechanical and run check.

| | n | errors | median | p90 | worst | < 15 s | quality | mechanical | run | judge (pass) | no draft | setup | model (calls) | first token | tool wait | hand-back | tokens in / out | load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main draft | 40 | 0 | 7.7 | 11.2 | 19.5 | 95% | 80% | 85% | 85% | – (–) | 0 | 0.0 | 6.7 (3) | 1.0 | 0.8 | 0.0 | 48278 / 871 | 21 |
| branch draft | 40 | 0 | 8.4 | 10.4 | 17.5 | 98% | 80% | 85% | 88% | – (–) | 0 | 0.0 | 7.1 (3) | 1.0 | 0.8 | 0.0 | 49777 / 925 | 31 |

| case | build | n | median | worst | quality | judge |
| --- | --- | --- | --- | --- | --- | --- |
| eric-says-hello | main draft | 2 | 9.7 | 10.5 | 50% | – |
| eric-says-hello | branch draft | 2 | 9.7 | 10.3 | 50% | – |
| due-today-digest | main draft | 2 | 5.2 | 5.7 | 0% | – |
| due-today-digest | branch draft | 2 | 5.4 | 5.4 | 0% | – |
| channel-message-to-task | main draft | 2 | 6.9 | 7.0 | 100% | – |
| channel-message-to-task | branch draft | 2 | 9.8 | 13.0 | 100% | – |
| weekly-channel-recap | main draft | 2 | 9.0 | 9.4 | 100% | – |
| weekly-channel-recap | branch draft | 2 | 8.9 | 9.2 | 100% | – |
| done-log-database | main draft | 2 | 9.1 | 10.3 | 100% | – |
| done-log-database | branch draft | 2 | 8.8 | 9.0 | 100% | – |
| missing-channel-left-out | main draft | 2 | 9.9 | 10.7 | 100% | – |
| missing-channel-left-out | branch draft | 2 | 7.0 | 7.0 | 100% | – |
| ask-ai-inbox-triage | main draft | 2 | 4.5 | 4.7 | 100% | – |
| ask-ai-inbox-triage | branch draft | 2 | 4.5 | 4.7 | 100% | – |
| add-step-post-urgent | main draft | 2 | 10.0 | 11.1 | 100% | – |
| add-step-post-urgent | branch draft | 2 | 8.9 | 9.6 | 100% | – |
| change-step-other-channel | main draft | 2 | 18.6 | 19.5 | 100% | – |
| change-step-other-channel | branch draft | 2 | 13.5 | 17.5 | 100% | – |
| once-budget-reminder | main draft | 2 | 5.2 | 6.3 | 100% | – |
| once-budget-reminder | branch draft | 2 | 5.4 | 6.1 | 100% | – |
| invoice-mail-to-finance | main draft | 2 | 6.9 | 6.9 | 100% | – |
| invoice-mail-to-finance | branch draft | 2 | 6.0 | 6.0 | 100% | – |
| review-status-to-channel | main draft | 2 | 7.6 | 7.7 | 0% | – |
| review-status-to-channel | branch draft | 2 | 9.1 | 9.4 | 100% | – |
| two-jordans | main draft | 2 | 8.0 | 8.3 | 100% | – |
| two-jordans | branch draft | 2 | 8.9 | 9.0 | 50% | – |
| vague-standup | main draft | 2 | 4.3 | 4.7 | 100% | – |
| vague-standup | branch draft | 2 | 4.4 | 4.9 | 100% | – |
| vague-support-watch | main draft | 2 | 4.6 | 4.9 | 100% | – |
| vague-support-watch | branch draft | 2 | 4.8 | 5.0 | 100% | – |
| launch-overdue-chase | main draft | 2 | 7.8 | 8.6 | 100% | – |
| launch-overdue-chase | branch draft | 2 | 7.2 | 7.4 | 100% | – |
| weekly-metrics-ask-ai | main draft | 2 | 4.5 | 4.8 | 100% | – |
| weekly-metrics-ask-ai | branch draft | 2 | 4.5 | 4.5 | 100% | – |
| hiring-task-to-database | main draft | 2 | 10.9 | 11.7 | 50% | – |
| hiring-task-to-database | branch draft | 2 | 9.5 | 10.1 | 0% | – |
| add-step-ask-ai-review | main draft | 2 | 8.4 | 8.4 | 100% | – |
| add-step-ask-ai-review | branch draft | 2 | 8.9 | 8.9 | 100% | – |
| change-step-only-eric | main draft | 2 | 11.9 | 13.0 | 0% | – |
| change-step-only-eric | branch draft | 2 | 11.5 | 11.9 | 0% | – |

### branch against main

**NOISE**: time and quality within noise.

- time: B/A median ×0.97 (95% 0.91–1.04) over 40 pairs: noise
- quality (every check passed): 80% → 80%, +0% (95% -10% to 10%); margin 13%
