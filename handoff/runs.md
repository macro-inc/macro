# Bench runs of the routines climb

Every finished run on the `sugclimb` stack, from the bench's own summary row. `commit` is
the worktree's HEAD when the run started: `main` and `pr` rows ran with the product files
of main (or the leg-1 PR head) checked out over it, the bench kept. Held-out rows are
aggregate only. Money is dollars per attempt (27 attempts a run). Judge v4 and recorded
persona digests start with the `pr` rows; v9 and later use the once-a-run judge cache
(105fcd601dd, not yet proven with `noise`).

| section | label | set | commit | score (95%) | found / needs | bad | invented | suggested | quality | first | wall | $ / gen | $ judge | runs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| routines | main | tune | 78cc5a01d0 | 11.4 (1.6–20.5) | 3.10 / 5.8 | 2.43 | 0.24 | 21.1 | 2.50 | 65s | 187s | 0.214 | 0.192 | 21/27 |
| routines | main | tune | b9e9fd2ee5 | 19.3 (8.3–30.2) | 3.37 / 5.7 | 2.37 | 0.15 | 21.0 | 2.54 | 67s | 185s | 0.219 | 0.157 | 27/27 |
| routines | prompt-v1 | tune | 78cc5a01d0 | 49.7 (40.3–59.7) | 4.43 / 5.7 | 1.65 | 0.13 | 10.6 | 3.25 | 123s | 224s | 0.260 | 0.183 | 23/27 |
| routines | single | tune | 2d93cf164b | 66.3 (58.8–73.8) | 3.81 / 5.7 | 0.07 | 0.00 | 4.9 | 4.11 | 139s | 148s | 0.079 | 0.180 | 27/27 |
| routines | v2 | tune | b9e9fd2ee5 | 69.5 (61.5–77.4) | 3.96 / 5.7 | 0.07 | 0.00 | 4.8 | 4.25 | 135s | 150s | 0.072 | 0.091 | 27/27 |
| routines | v3 | tune | b9e9fd2ee5 | 61.2 (52.1–70.1) | 3.70 / 5.7 | 0.26 | 0.04 | 4.3 | 4.20 | 100s | 157s | 0.069 | 0.089 | 27/27 |
| routines | v4 | tune | b9e9fd2ee5 | 71.6 (63.7–79.4) | 4.00 / 5.7 | 0.00 | 0.00 | 4.7 | 4.15 | 152s | 168s | 0.078 | 0.089 | 27/27 |
| routines | v5 | tune | 38d2442170 | 68.8 (60.5–76.7) | 3.96 / 5.7 | 0.11 | 0.00 | 4.7 | 4.23 | 137s | 150s | 0.072 | 0.089 | 27/27 |
| routines | v6 | tune | 38d2442170 | 74.4 (67.2–81.4) | 4.22 / 5.7 | 0.04 | 0.00 | 4.9 | 4.25 | 149s | 162s | 0.073 | 0.091 | 27/27 |
| routines | noevents | tune | 83650c5f5d | 72.0 (62.8–80.7) | 4.11 / 5.7 | 0.07 | 0.00 | 4.8 | 4.27 | 153s | 179s | 0.080 | 0.091 | 27/27 |
| routines | main | climb1 | b9e9fd2ee5 | -83.7 (-102.3–-64.4) | 1.30 / 5.3 | 5.56 | 0.22 | 20.6 | 2.13 | 58s | 171s | 0.222 | 0.160 | 27/27 |
| routines | branch | climb1 | b9e9fd2ee5 | 31.7 (24.1–39.3) | 2.30 / 5.3 | 0.59 | 0.00 | 4.8 | 3.63 | 128s | 140s | 0.075 | 0.107 | 27/27 |
| routines | main | climb2 | b9e9fd2ee5 | -40.7 (-61.1–-21.6) | 2.26 / 6.0 | 4.70 | 0.26 | 19.7 | 2.33 | 57s | 187s | 0.223 | 0.155 | 27/27 |
| routines | branch | climb2 | 38d2442170 | 33.3 (26.5–40.7) | 2.70 / 6.0 | 0.70 | 0.00 | 5.1 | 3.71 | 142s | 158s | 0.075 | 0.107 | 27/27 |
| routines | v5dev | climb2 | 38d2442170 | 46.3 (39.5–52.5) | 3.44 / 6.0 | 0.67 | 0.04 | 5.0 | 3.90 | 148s | 168s | 0.074 | 0.104 | 27/27 |
| routines | v6dev | climb2 | 38d2442170 | 51.9 (44.4–59.3) | 3.70 / 6.0 | 0.59 | 0.04 | 5.3 | 3.91 | 145s | 158s | 0.076 | 0.104 | 27/27 |
| routines | main | climb3 | 06dd8b8d67 | -45.7 (-69.1–-23.5) | 1.81 / 5.3 | 4.15 | 0.22 | 19.7 | 2.31 | 58s | 182s | 0.229 | 0.155 | 27/27 |
| routines | branch | climb3 | 06dd8b8d67 | 50.5 (45.4–55.3) | 3.07 / 5.3 | 0.37 | 0.04 | 4.7 | 3.79 | 145s | 161s | 0.074 | 0.101 | 27/27 |
| feed | main | tune | 78cc5a01d0 | 72.8 (68.3–77.4) | 7.15 / 9.0 | 0.59 | 0.44 | 11.8 | 4.00 (feed 8.0/10) | 179s | 332s | 0.182 | 0.268 | 27/27 |
| feed | branch | tune | 38d2442170 | 77.4 (73.3–81.5) | 7.22 / 9.0 | 0.26 | 0.15 | 11.9 | 3.98 (feed 7.9/10) | 224s | 347s | 0.186 | 0.288 | 27/27 |
| routines | pr | dev1 | 86469d6514 | 54.4 (49.5–59.3) | 3.33 / 5.7 | 0.26 | 0.00 | 4.6 | 4.18 | 140s | 153s | 0.074 | 0.094 | 27/27 |
| routines | pr | tune | 86469d6514 | 74.4 (66.7–82.0) | 4.30 / 5.7 | 0.11 | 0.00 | 5.0 | 4.19 | 150s | 164s | 0.076 | 0.092 | 27/27 |
| routines | v7 | dev1 | 86469d6514 | 59.9 (51.2–68.0) | 3.74 / 5.7 | 0.41 | 0.00 | 5.4 | 4.03 | 82s | 169s | 0.080 | 0.103 | 27/27 |
| routines | v7 | tune | 86469d6514 | 66.9 (61.1–73.0) | 4.00 / 5.7 | 0.26 | 0.00 | 5.4 | 4.08 | 80s | 155s | 0.077 | 0.097 | 27/27 |
| routines | v8 | tune | 2c2ab3da56 | 67.4 (60.1–74.8) | 3.93 / 5.7 | 0.15 | 0.00 | 4.9 | 4.18 | 79s | 162s | 0.082 | 0.095 | 27/27 |
| routines | v8 | dev1 | 2c2ab3da56 | 59.3 (50.5–67.4) | 3.70 / 5.7 | 0.41 | 0.00 | 5.1 | 4.09 | 82s | 165s | 0.077 | 0.100 | 27/27 |
| routines | v9 | tune | bf31a3b4d7 | 70.7 (64.4–76.9) | 4.00 / 5.7 | 0.04 | 0.00 | 5.0 | 4.20 | 80s | 161s | 0.080 | 0.056 | 27/27 |
| routines | unseen | tune | b61f51d8c2 | 67.4 (59.9–74.4) | 3.81 / 5.7 | 0.04 | 0.04 | 4.7 | 4.24 | 83s | 150s | 0.065 | 0.054 | 27/27 |

## Hits per need on tune (attempts of 9 that met it)

- **pr**: founder:r1 8, founder:r2 5, founder:r3 9, founder:r4 9, founder:r5 9, plumber:r1 8, plumber:r2 9, plumber:r3 9, plumber:r4 6, plumber:r5 6, plumber:r6 9, sales:r1 9, sales:r2 4, sales:r4 9, sales:r5 4, sales:r6 2
- **v7**: founder:r1 9, founder:r2 2, founder:r3 9, founder:r4 9, founder:r5 9, plumber:r1 6, plumber:r2 8, plumber:r3 9, plumber:r4 9, plumber:r5 9, sales:r1 9, sales:r2 4, sales:r4 9, sales:r5 1, sales:r6 6
- **v8**: founder:r1 8, founder:r2 2, founder:r3 9, founder:r4 9, founder:r5 9, plumber:r1 6, plumber:r2 8, plumber:r3 9, plumber:r4 9, plumber:r5 9, plumber:r6 1, sales:r1 9, sales:r4 9, sales:r6 9
- **v9**: founder:r1 8, founder:r2 3, founder:r3 9, founder:r4 9, founder:r5 9, plumber:r1 7, plumber:r2 8, plumber:r3 9, plumber:r4 9, plumber:r5 9, sales:r1 8, sales:r2 2, sales:r4 9, sales:r5 1, sales:r6 8
- **unseen**: founder:r1 9, founder:r3 9, founder:r4 9, founder:r5 9, plumber:r1 9, plumber:r2 5, plumber:r3 9, plumber:r4 9, plumber:r5 9, plumber:r6 2, sales:r1 9, sales:r4 9, sales:r6 6

## Compares (bench.ts compare)

```
routines: pr → v9, 27 and 27 attempts over 3 personas

**NOISE**: score moved -3.7, within the 11.5 noise margin or an interval that spans 0.
- score: 74.4 → 70.7, -3.7 (95% -9.2 to 1.8), margin 11.5: noise
- found: 4.30 → 4.00, -0.30 (95% -0.56 to -0.03), margin 0.47: noise
- bad: 0.11 → 0.04, -0.07 (95% -0.22 to 0.07), margin 0.53: noise
- cost per generation: 0.076 → 0.080 (difference 95% -0.003 to 0.010)
- time: B/A median ×0.98
```

```
routines: v9 → unseen, 27 and 27 attempts over 3 personas

**NOISE**: score moved -3.3, within the 11.5 noise margin or an interval that spans 0.
- score: 70.7 → 67.4, -3.3 (95% -7.9 to 1.2), margin 11.5: noise
- found: 4.00 → 3.81, -0.19 (95% -0.43 to 0.06), margin 0.47: noise
- bad: 0.04 → 0.04, +0.00 (95% -0.11 to 0.11), margin 0.53: noise
- cost per generation: 0.080 → 0.065 (difference 95% -0.021 to -0.008)
- time: B/A median ×0.93
```

```
routines: pr → unseen, 27 and 27 attempts over 3 personas

**NOISE**: score moved -7.0, within the 11.5 noise margin or an interval that spans 0.
- score: 74.4 → 67.4, -7.0 (95% -12.4 to -1.6), margin 11.5: noise
- found: 4.30 → 3.81, -0.48 (95% -0.76 to -0.20), margin 0.47: worse
- bad: 0.11 → 0.04, -0.07 (95% -0.22 to 0.07), margin 0.53: noise
- cost per generation: 0.076 → 0.065 (difference 95% -0.017 to -0.004)
- time: B/A median ×0.92
```
