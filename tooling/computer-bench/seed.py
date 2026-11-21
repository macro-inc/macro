#!/usr/bin/env python3
"""Seed a local stack with a team that can buy computers: a Stripe *test*
customer with an active team subscription, the owner's user rows, the team and
its owner membership. Idempotent; state (Stripe ids) is kept in --state.

    seed.py --stack <instance> --state <file.json>

Prints the owner's ids for generate_local_e2e_token. A new --state file makes
a new subscription and moves the team to it (Stripe caps invoices per
subscription per day, and every purchase and release invoices).
"""

import argparse
import json
import pathlib
import subprocess
import urllib.parse
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent.parent
EMAIL = "computer-bench@example.com"
USER_UUID = "019a6000-be4c-7000-8000-000000000002"
TEAM = "019a6000-be4c-7000-8000-000000000001"


def env_of(instance: str) -> dict:
    env = {}
    for line in (REPO / f"infra/local/generated/{instance}/local.generated.env").read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep:
            env[key] = value.strip('"')
    return env


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack", required=True)
    parser.add_argument("--state", required=True)
    args = parser.parse_args()
    env = env_of(args.stack)
    key = env["STRIPE_SECRET_KEY"]
    if not key.startswith("sk_test_"):
        raise SystemExit("refusing: STRIPE_SECRET_KEY is not a test-mode key")

    def stripe(method, path, body=None):
        request = urllib.request.Request(
            "https://api.stripe.com/v1/" + path,
            data=urllib.parse.urlencode(body).encode() if body else None,
            method=method,
            headers={"Authorization": "Bearer " + key},
        )
        with urllib.request.urlopen(request, timeout=40) as response:
            return json.load(response)

    state_path = pathlib.Path(args.state)
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if "subscription" not in state:
        price = stripe("GET", "prices/" + env["STRIPE_PRICE_ID"])
        assert price["livemode"] is False
        customer = stripe(
            "POST",
            "customers",
            {
                "description": "computer bench (local)",
                "payment_method": "pm_card_visa",
                "invoice_settings[default_payment_method]": "pm_card_visa",
            },
        )
        subscription = stripe(
            "POST",
            "subscriptions",
            {"customer": customer["id"], "items[0][price]": price["id"], "items[0][quantity]": 1},
        )
        assert subscription["status"] == "active", subscription["status"]
        state = {"customer": customer["id"], "subscription": subscription["id"]}
        state_path.write_text(json.dumps(state))
        state_path.chmod(0o600)
    user = f"macro|{EMAIL}"
    for value in state.values():
        assert "'" not in value
    sql = f"""
INSERT INTO macro_user (id, username, email, stripe_customer_id)
  VALUES ('{USER_UUID}', '{EMAIL}', '{EMAIL}', '{state["customer"]}') ON CONFLICT (id) DO NOTHING;
INSERT INTO "User" (id, email, macro_user_id, "stripeCustomerId")
  VALUES ('{user}', '{EMAIL}', '{USER_UUID}', '{state["customer"]}') ON CONFLICT (id) DO NOTHING;
INSERT INTO team (id, name, owner_id, subscription_id, seat_count, paying)
  VALUES ('{TEAM}', 'Computer bench', '{user}', '{state["subscription"]}', 1, true)
  ON CONFLICT (id) DO UPDATE SET subscription_id = EXCLUDED.subscription_id, paying = true;
INSERT INTO team_user (user_id, team_id, team_role) VALUES ('{user}', '{TEAM}', 'owner') ON CONFLICT DO NOTHING;
"""
    subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            f"macro-{args.stack}-postgres-1",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            "user",
            "-d",
            "macrodb",
        ],
        input=sql,
        text=True,
        check=True,
        capture_output=True,
    )
    print(json.dumps({"email": EMAIL, "macro_user_id": user, "team": TEAM}))


if __name__ == "__main__":
    main()
