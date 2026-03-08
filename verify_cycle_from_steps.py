#!/usr/bin/env python3
from __future__ import annotations

from decimal import Decimal, getcontext

from counterexample_certificate import STRICT_TOL, steps, witness_x


getcontext().prec = 160


def admissible_case(a: Decimal, b: Decimal, c: Decimal, tol: Decimal = STRICT_TOL):
    if a > b:
        a, b = b, a
        swapped = True
    else:
        swapped = False

    if not (-tol <= a <= Decimal(1) + tol):
        return False, "outside range: a", {}
    if not (-tol <= b <= Decimal(1) + tol):
        return False, "outside range: b", {}
    if not (-tol <= c <= Decimal(1) + tol):
        return False, "outside range: c", {}

    q0 = a * a + a * b + b * b
    s = a + b
    q1 = s**4 - s**2 + a * b

    diagnostics = {
        "a_used": a,
        "b_used": b,
        "c": c,
        "swapped": swapped,
        "a2_ab_b2": q0,
        "s": s,
        "q_switch": q1,
    }

    if q0 > tol + Decimal(1):
        return False, "fails a^2+ab+b^2 <= 1", diagnostics

    p1 = c**4 - c**2 + a * c - a**2
    diagnostics["poly_case_1"] = p1
    if s <= Decimal(1) + tol and q1 <= tol and p1 <= tol:
        return True, "case 1", diagnostics

    p2 = (s**2 - 1) * c**2 + b * c - b**2
    diagnostics["poly_case_2"] = p2
    if s <= Decimal(1) + tol and q1 >= -tol and p2 <= tol:
        return True, "case 2", diagnostics

    p3 = (a**2 - 1) * c**2 + (2 * a * b**2 + b) * c + (b**4 - b**2)
    diagnostics["poly_case_3"] = p3
    if s >= Decimal(1) - tol and p3 <= tol and c <= Decimal("0.5") + tol:
        return True, "case 3", diagnostics

    return False, "no case matched", diagnostics


def verify_cycle(cycle_steps, witness_x_value=None, tol: Decimal = STRICT_TOL):
    ok_all = True

    if witness_x_value is not None:
        print(f"witness_x = {witness_x_value}")
        print()

    for i, step in enumerate(cycle_steps):
        a = step["a"]
        b = step["b"]
        c = step["c"]
        a_next = step.get("a_next")

        ok, case_name, info = admissible_case(a, b, c, tol=tol)

        print(f"step {i}")
        print(f"  a_{i} = {a}")
        print(f"  b_{i} = {b}")
        print(f"  c_{i} = {c}")
        print(f"  admissible = {ok}")
        print(f"  matched = {case_name}")
        print(f"  swapped_by_symmetry = {info.get('swapped')}")

        if "a2_ab_b2" in info:
            print(f"  a^2+ab+b^2 = {info['a2_ab_b2']}")
            print(f"  s = a+b = {info['s']}")
            print(f"  q_switch = (a+b)^4-(a+b)^2+ab = {info['q_switch']}")

        if case_name == "case 1":
            print(f"  poly_case_1 = {info['poly_case_1']}")
        elif case_name == "case 2":
            print(f"  poly_case_2 = {info['poly_case_2']}")
        elif case_name == "case 3":
            print(f"  poly_case_3 = {info['poly_case_3']}")

        if a_next is not None:
            predicted = Decimal(1) - b
            rec_ok = abs(predicted - a_next) <= tol
            print(f"  a_{i + 1} given     = {a_next}")
            print(f"  a_{i + 1} predicted = 1 - b_{i} = {predicted}")
            print(f"  recurrence_ok = {rec_ok}")
            ok = ok and rec_ok

        print()
        ok_all = ok_all and ok

    print(f"OVERALL_ADMISSIBLE = {ok_all}")
    return ok_all


if __name__ == "__main__":
    verify_cycle(steps, witness_x_value=witness_x)
