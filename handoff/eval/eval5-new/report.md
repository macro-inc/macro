Seconds; quality is the share of drafts passing every mechanical and run check.

| | n | errors | median | p90 | worst | < 15 s | quality | mechanical | run | judge (pass) | no draft | setup | model (calls) | first token | tool wait | hand-back | tokens in / out | load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main draft | 8 | 0 | 9.5 | 10.4 | 11.2 | 100% | 0% | 0% | 0% | 4.5 (88%) | 0 | 0.0 | 8.5 (3) | 1.3 | 0.6 | 0.0 | 32283 / 1005 | 26 |
| branch draft | 8 | 0 | 16.2 | 25.1 | 26.7 | 50% | 25% | 100% | 25% | 3.8 (50%) | 0 | 0.0 | 14.8 (4.5) | 1.7 | 1.0 | 0.0 | 87989 / 1817 | 27 |

| case | build | n | median | worst | quality | judge |
| --- | --- | --- | --- | --- | --- | --- |
| due-soon-reminders | main draft | 4 | 8.5 | 9.2 | 0% | 4.5 |
| due-soon-reminders | branch draft | 4 | 23.0 | 26.7 | 0% | 3.0 |
| review-check-later | main draft | 4 | 10.1 | 11.2 | 0% | 4.5 |
| review-check-later | branch draft | 4 | 9.6 | 11.0 | 50% | 4.5 |

### branch against main

**WIN**: quality rose 25%, time within noise.

- time: B/A median ×1.51 (95% 0.95–3.06) over 8 pairs: noise
- quality (every check passed): 0% → 25%, +25% (95% 0% to 63%); margin 13%
