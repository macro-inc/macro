#!/usr/bin/env python3
"""Fact-check a claimed value of π by computing it independently.

Uses two unrelated algorithms (Machin and Chudnovsky) with the Decimal
module so the result does not depend on math.pi's ~15-digit float.

The claim being checked is:

    3.14159265358979323846264338327950288419716939937510

That string is 1 integer digit plus 50 digits after the decimal point.
"""

from __future__ import annotations

import sys
from decimal import Decimal, getcontext

CLAIMED = "3.14159265358979323846264338327950288419716939937510"
DECIMAL_PLACES = 50
# Extra working digits so the truncated prefix is not polluted by rounding.
WORKING_PRECISION = DECIMAL_PLACES + 30


def _arctan(x: Decimal, precision: int) -> Decimal:
    """Taylor series for arctan(x), |x| < 1."""
    x2 = x * x
    term = x
    total = x
    n = 1
    threshold = Decimal(10) ** -(precision + 5)
    while True:
        term *= x2
        n += 2
        delta = term / n
        if n % 4 == 3:
            total -= delta
        else:
            total += delta
        if abs(delta) < threshold:
            return total


def compute_pi_machin(precision: int) -> Decimal:
    """Machin's formula: π/4 = 4·arctan(1/5) − arctan(1/239)."""
    getcontext().prec = precision
    one = Decimal(1)
    return 4 * (
        4 * _arctan(one / 5, precision) - _arctan(one / 239, precision)
    )


def compute_pi_chudnovsky(precision: int) -> Decimal:
    """Chudnovsky series for 1/π."""
    getcontext().prec = precision
    c = 426880 * Decimal(10005).sqrt()
    k = Decimal(6)
    m = Decimal(1)
    x = Decimal(1)
    l = Decimal(13591409)
    s = l
    i = 1
    threshold = Decimal(10) ** -(precision + 5)
    while True:
        m = (k**3 - 16 * k) * m / (i**3)
        l += 545140134
        x *= -262537412640768000
        term = m * l / x
        s += term
        if abs(term) < threshold:
            break
        k += 12
        i += 1
    return c / s


def truncate_decimal(value: Decimal, places: int) -> str:
    """Return '3.' plus the first `places` digits after the decimal (no rounding)."""
    # Format with extra digits, then slice so the last kept digit is not rounded.
    formatted = f"{value:.{places + 10}f}"
    integer, frac = formatted.split(".")
    return f"{integer}.{frac[:places]}"


def digit_mismatch(computed: str, claimed: str) -> int | None:
    """Return the 0-based index of the first differing character, or None."""
    for index, (left, right) in enumerate(zip(computed, claimed)):
        if left != right:
            return index
    if len(computed) != len(claimed):
        return min(len(computed), len(claimed))
    return None


def fact_check() -> int:
    machin = truncate_decimal(compute_pi_machin(WORKING_PRECISION), DECIMAL_PLACES)
    chudnovsky = truncate_decimal(
        compute_pi_chudnovsky(WORKING_PRECISION), DECIMAL_PLACES
    )

    print("Claimed π (50 decimal places):")
    print(f"  {CLAIMED}")
    print()
    print("Computed independently:")
    print(f"  Machin:      {machin}")
    print(f"  Chudnovsky:  {chudnovsky}")
    print()

    methods_agree = machin == chudnovsky
    print(f"Algorithms agree with each other: {methods_agree}")
    if not methods_agree:
        mismatch = digit_mismatch(machin, chudnovsky)
        print(f"  First mismatch between algorithms at character index {mismatch}")
        return 1

    mismatch = digit_mismatch(machin, CLAIMED)
    if mismatch is None:
        print("Claim MATCHES computed π.")
        print(f"Verified {DECIMAL_PLACES} digits after the decimal point.")
        return 0

    print("Claim DOES NOT MATCH computed π.")
    print(f"  First mismatch at character index {mismatch}:")
    print(f"    claimed:   {CLAIMED[mismatch]!r}")
    print(f"    computed:  {machin[mismatch]!r}")
    marker = " " * mismatch + "^"
    print(f"    claimed:   {CLAIMED}")
    print(f"    computed:  {machin}")
    print(f"               {marker}")
    return 1


if __name__ == "__main__":
    sys.exit(fact_check())
