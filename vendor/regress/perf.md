These are perf results from 5/25/20, from [regex-performance](github.com/rust-leipzig/regex-performance.git).

```
'../3200.txt' loaded. (Length: 16013977 bytes)
-----------------
Regex: 'Twain'
[      pcre] time:     1.6 ms (+/-  6.8 %), matches:      811
[  pcre-dfa] time:     8.4 ms (+/-  1.3 %), matches:      811
[  pcre-jit] time:     9.9 ms (+/-  0.3 %), matches:      811
[       re2] time:     1.1 ms (+/-  3.6 %), matches:      811
[      onig] time:    11.0 ms (+/-  1.1 %), matches:      811
[       tre] time:   141.0 ms (+/-  0.1 %), matches:      811
[     hscan] time:     0.7 ms (+/-  3.2 %), matches:      811
[rust_regex] time:     1.1 ms (+/-  3.1 %), matches:      811
[rust_regrs] time:     7.1 ms (+/-  1.0 %), matches:      811
-----------------
Regex: '(?i)Twain'
[      pcre] time:    28.4 ms (+/-  0.5 %), matches:      965
[  pcre-dfa] time:    41.0 ms (+/-  1.2 %), matches:      965
[  pcre-jit] time:    10.1 ms (+/-  1.0 %), matches:      965
[       re2] time:    32.0 ms (+/-  0.4 %), matches:      965
[      onig] time:    46.6 ms (+/-  0.4 %), matches:      965
[       tre] time:   184.6 ms (+/-  0.1 %), matches:      965
[     hscan] time:     0.9 ms (+/- 10.5 %), matches:      965
[rust_regex] time:     1.5 ms (+/-  3.3 %), matches:      965
[rust_regrs] time:    11.0 ms (+/-  1.1 %), matches:      965
-----------------
Regex: '[a-z]shing'
[      pcre] time:   183.2 ms (+/-  0.4 %), matches:     1540
[  pcre-dfa] time:   314.4 ms (+/-  0.1 %), matches:     1540
[  pcre-jit] time:     9.3 ms (+/-  1.0 %), matches:     1540
[       re2] time:    52.2 ms (+/-  0.6 %), matches:     1540
[      onig] time:     9.3 ms (+/-  0.6 %), matches:     1540
[       tre] time:   207.8 ms (+/-  0.1 %), matches:     1540
[     hscan] time:     2.5 ms (+/-  3.7 %), matches:     1540
[rust_regex] time:     3.5 ms (+/-  2.8 %), matches:     1540
[rust_regrs] time:   132.4 ms (+/-  0.2 %), matches:     1540
-----------------
Regex: 'Huck[a-zA-Z]+|Saw[a-zA-Z]+'
[      pcre] time:    10.4 ms (+/-  1.9 %), matches:      262
[  pcre-dfa] time:    10.9 ms (+/-  1.0 %), matches:      262
[  pcre-jit] time:     1.4 ms (+/-  4.0 %), matches:      262
[       re2] time:    22.9 ms (+/-  1.2 %), matches:      262
[      onig] time:    19.4 ms (+/-  1.2 %), matches:      262
[       tre] time:   204.2 ms (+/-  0.1 %), matches:      262
[     hscan] time:     1.3 ms (+/-  1.1 %), matches:      977
[rust_regex] time:     1.4 ms (+/-  4.3 %), matches:      262
[rust_regrs] time:     1.6 ms (+/-  3.2 %), matches:      262
-----------------
Regex: '\b\w+nn\b'
[      pcre] time:   269.1 ms (+/-  0.3 %), matches:      262
[  pcre-dfa] time:   435.1 ms (+/-  0.1 %), matches:      262
[  pcre-jit] time:    51.4 ms (+/-  0.3 %), matches:      262
[       re2] time:    19.6 ms (+/-  0.7 %), matches:      262
[      onig] time:   327.9 ms (+/-  0.1 %), matches:      262
[       tre] time:   344.2 ms (+/-  1.8 %), matches:      262
[     hscan] time:    66.4 ms (+/-  0.3 %), matches:      262
[rust_regex] time:   100.4 ms (+/-  0.4 %), matches:      262
[rust_regrs] time:   191.5 ms (+/-  0.1 %), matches:      262
-----------------
Regex: '[a-q][^u-z]{13}x'
[      pcre] time:   229.4 ms (+/-  0.2 %), matches:     4094
[  pcre-dfa] time:   838.4 ms (+/-  0.2 %), matches:     4094
[  pcre-jit] time:     1.1 ms (+/- 10.3 %), matches:     4094
[       re2] time:   103.9 ms (+/-  9.5 %), matches:     4094
[      onig] time:    22.8 ms (+/-  0.3 %), matches:     4094
[       tre] time:   518.4 ms (+/-  0.1 %), matches:     4094
[     hscan] time:    36.6 ms (+/-  0.2 %), matches:     4094
[rust_regex] time:  1578.3 ms (+/-  1.8 %), matches:     4094
[rust_regrs] time:   358.9 ms (+/-  0.2 %), matches:     4094
-----------------
Regex: 'Tom|Sawyer|Huckleberry|Finn'
[      pcre] time:    13.2 ms (+/-  1.1 %), matches:     2598
[  pcre-dfa] time:    14.3 ms (+/-  0.4 %), matches:     2598
[  pcre-jit] time:    14.9 ms (+/-  0.6 %), matches:     2598
[       re2] time:    23.9 ms (+/-  0.6 %), matches:     2598
[      onig] time:    22.0 ms (+/-  0.6 %), matches:     2598
[       tre] time:   338.2 ms (+/-  0.1 %), matches:     2598
[     hscan] time:     1.6 ms (+/-  1.1 %), matches:     2598
[rust_regex] time:     1.4 ms (+/-  2.9 %), matches:     2598
[rust_regrs] time:    11.7 ms (+/-  0.7 %), matches:     2598
-----------------
Regex: '(?i)Tom|Sawyer|Huckleberry|Finn'
[      pcre] time:   132.6 ms (+/-  0.4 %), matches:     4152
[  pcre-dfa] time:   161.6 ms (+/-  0.2 %), matches:     4152
[  pcre-jit] time:    40.7 ms (+/-  0.9 %), matches:     4152
[       re2] time:    48.0 ms (+/-  0.4 %), matches:     4152
[      onig] time:   140.3 ms (+/-  0.1 %), matches:     4152
[       tre] time:   491.6 ms (+/-  0.1 %), matches:     4152
[     hscan] time:     1.7 ms (+/-  7.4 %), matches:     4152
[rust_regex] time:     2.8 ms (+/-  3.1 %), matches:     4152
[rust_regrs] time:   110.9 ms (+/-  0.2 %), matches:     4152
-----------------
Regex: '.{0,2}(Tom|Sawyer|Huckleberry|Finn)'
[      pcre] time:  1613.8 ms (+/-  0.0 %), matches:     2598
[  pcre-dfa] time:  1514.8 ms (+/-  0.2 %), matches:     2598
[  pcre-jit] time:   129.9 ms (+/-  0.3 %), matches:     2598
[       re2] time:    22.2 ms (+/-  0.6 %), matches:     2598
[      onig] time:    40.6 ms (+/-  0.9 %), matches:     2598
[       tre] time:  1087.0 ms (+/-  0.8 %), matches:     2598
[     hscan] time:     1.6 ms (+/-  0.8 %), matches:     2598
[rust_regex] time:    21.4 ms (+/-  0.8 %), matches:     2598
[rust_regrs] time:   961.8 ms (+/-  1.0 %), matches:     2598
-----------------
Regex: '.{2,4}(Tom|Sawyer|Huckleberry|Finn)'
[      pcre] time:  1688.0 ms (+/-  0.0 %), matches:     1976
[  pcre-dfa] time:  1808.7 ms (+/-  0.1 %), matches:     1976
[  pcre-jit] time:   141.8 ms (+/-  0.1 %), matches:     1976
[       re2] time:    22.2 ms (+/-  0.5 %), matches:     1976
[      onig] time:    38.7 ms (+/-  0.4 %), matches:     1976
[       tre] time:  1656.9 ms (+/-  0.3 %), matches:     1976
[     hscan] time:     1.8 ms (+/-  7.2 %), matches:     2598
[rust_regex] time:    21.3 ms (+/-  1.5 %), matches:     1976
[rust_regrs] time:   965.6 ms (+/-  0.3 %), matches:     1976
-----------------
Regex: 'Tom.{10,25}river|river.{10,25}Tom'
[      pcre] time:    27.7 ms (+/-  0.5 %), matches:        2
[  pcre-dfa] time:    34.9 ms (+/-  0.4 %), matches:        2
[  pcre-jit] time:     8.3 ms (+/-  1.5 %), matches:        2
[       re2] time:    27.9 ms (+/-  2.3 %), matches:        2
[      onig] time:    37.3 ms (+/-  0.4 %), matches:        2
[       tre] time:   244.5 ms (+/-  0.1 %), matches:        2
[     hscan] time:     1.3 ms (+/-  2.1 %), matches:        4
[rust_regex] time:     1.9 ms (+/- 23.8 %), matches:        2
[rust_regrs] time:     9.9 ms (+/-  0.5 %), matches:        2
-----------------
Regex: '[a-zA-Z]+ing'
[      pcre] time:   398.0 ms (+/-  0.1 %), matches:    78424
[  pcre-dfa] time:   717.5 ms (+/-  0.1 %), matches:    78424
[  pcre-jit] time:    44.4 ms (+/-  0.4 %), matches:    78424
[       re2] time:    59.2 ms (+/-  0.2 %), matches:    78424
[      onig] time:   338.3 ms (+/-  0.0 %), matches:    78424
[       tre] time:   265.1 ms (+/-  0.1 %), matches:    78424
[     hscan] time:     9.6 ms (+/-  1.7 %), matches:    78872
[rust_regex] time:     9.1 ms (+/-  1.1 %), matches:    78424
[rust_regrs] time:   295.3 ms (+/-  0.1 %), matches:    78424
-----------------
Regex: '\s[a-zA-Z]{0,12}ing\s'
[      pcre] time:   180.9 ms (+/-  0.2 %), matches:    55248
[  pcre-dfa] time:   278.2 ms (+/-  0.1 %), matches:    55248
[  pcre-jit] time:    56.4 ms (+/-  0.5 %), matches:    55248
[       re2] time:    33.4 ms (+/-  0.5 %), matches:    55248
[      onig] time:    39.2 ms (+/-  0.4 %), matches:    55248
[       tre] time:   370.6 ms (+/-  0.1 %), matches:    55248
[     hscan] time:    13.2 ms (+/-  1.2 %), matches:    55640
[rust_regex] time:    24.7 ms (+/-  0.7 %), matches:    55248
[rust_regrs] time:   151.3 ms (+/-  0.1 %), matches:    55248
-----------------
Regex: '([A-Za-z]awyer|[A-Za-z]inn)\s'
[      pcre] time:   377.8 ms (+/-  0.1 %), matches:      209
[  pcre-dfa] time:   493.5 ms (+/-  0.1 %), matches:      209
[  pcre-jit] time:    20.3 ms (+/-  0.9 %), matches:      209
[       re2] time:    49.7 ms (+/-  0.5 %), matches:      209
[      onig] time:    90.5 ms (+/-  0.2 %), matches:      209
[       tre] time:   407.0 ms (+/-  0.1 %), matches:      209
[     hscan] time:     2.9 ms (+/-  4.2 %), matches:      209
[rust_regex] time:    21.1 ms (+/-  0.6 %), matches:      209
[rust_regrs] time:   229.7 ms (+/-  0.1 %), matches:      209
-----------------
Regex: '["'][^"']{0,30}[?!\.]["']'
[      pcre] time:    25.0 ms (+/-  1.1 %), matches:     8886
[  pcre-dfa] time:    36.9 ms (+/-  0.3 %), matches:     8886
[  pcre-jit] time:     5.5 ms (+/-  1.3 %), matches:     8886
[       re2] time:    24.7 ms (+/-  0.7 %), matches:     8886
[      onig] time:    35.1 ms (+/-  0.2 %), matches:     8886
[       tre] time:   202.6 ms (+/-  0.2 %), matches:     8886
[     hscan] time:     8.1 ms (+/-  1.8 %), matches:     8898
[rust_regex] time:     5.7 ms (+/-  4.9 %), matches:     8886
[rust_regrs] time:    16.9 ms (+/-  0.5 %), matches:     8886
-----------------
Regex: '∞|✓'
[      pcre] time:     0.6 ms (+/- 12.9 %), matches:        2
[  pcre-dfa] time:     7.1 ms (+/-  1.7 %), matches:        2
[  pcre-jit] time:     0.8 ms (+/-  8.5 %), matches:        2
[       re2] time:     0.5 ms (+/-  9.5 %), matches:        0
[      onig] time:    21.5 ms (+/-  0.1 %), matches:        2
[       tre] time:   168.0 ms (+/-  0.2 %), matches:        2
[     hscan] time:     1.2 ms (+/-  9.9 %), matches:        2
[rust_regex] time:     1.3 ms (+/-  2.4 %), matches:        2
[rust_regrs] time:     0.5 ms (+/- 11.8 %), matches:        2
-----------------
Total Results:
[      pcre] time:   5179.7 ms, score:      3 points,
[  pcre-dfa] time:   6715.7 ms, score:      0 points,
[  pcre-jit] time:    546.2 ms, score:     33 points,
[       re2] time:    543.5 ms, score:     23 points,
[      onig] time:   1240.5 ms, score:      7 points,
[       tre] time:   6831.5 ms, score:      0 points,
[     hscan] time:    151.3 ms, score:     67 points,
[rust_regex] time:   1796.8 ms, score:     52 points,
[rust_regrs] time:   3456.0 ms, score:      7 points,
```
