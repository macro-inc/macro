#!/usr/bin/env python3
"""Generate the channels-perf seed_cli scenario (users, team, channels, DMs, a few messages).
Bulk messages are added later by bulk_seed.py via SQL. Deterministic."""
import json
from pathlib import Path
OUT = Path(__file__).resolve().parent
DOMAIN = "seed.macro.local"
PEOPLE = [("alice","Alice","Quinn"),("bob","Bob","Marsh"),("carol","Carol","Diaz"),("dave","Dave","Okafor"),
 ("erin","Erin","Walsh"),("frank","Frank","Nguyen"),("grace","Grace","Lindqvist"),("heidi","Heidi","Baker"),
 ("ivan","Ivan","Petrov"),("judy","Judy","Chen"),("kevin","Kevin","Morales"),("laura","Laura","Rossi"),
 ("mallory","Mallory","Stern"),("nina","Nina","Kowalski"),("oscar","Oscar","Hughes"),("priya","Priya","Natarajan"),
 ("quentin","Quentin","Webb"),("rosa","Rosa","Jensen"),("sam","Sam","Turner"),("tina","Tina","Abbott"),
 ("umar","Umar","Kim")]
users = {k: {"email": f"{k}@{DOMAIN}", "first_name": f, "last_name": l, "roles": ["team_subscriber","sub_opus"]} for k,f,l in PEOPLE}
others = [k for k,_,_ in PEOPLE if k != "alice"]
team = {"name": "Perf Co", "owner": "alice", "members": {k: ("admin" if k in ("bob","erin") else "member") for k in others}}
channels = {
  "perf-small":  {"type": "private", "owner": "alice", "members": others},
  "perf-medium": {"type": "private", "owner": "alice", "members": others},
  "perf-large":  {"type": "private", "owner": "alice", "members": others},
  "lobby":       {"type": "public",  "owner": "alice", "members": others},
  "freshness":   {"type": "private", "owner": "alice", "members": ["bob","carol"]},
  "perfco-hq":   {"type": "team", "team": "perfco"},
}
for k in ["bob","carol","dave","erin","frank","grace"]:
    channels[f"dm-alice-{k}"] = {"type": "direct_message", "members": ["alice", k]}
messages = []
for i in range(12):
    messages.append({"channel": "lobby", "from": PEOPLE[i % len(PEOPLE)][0], "text": f"Lobby chatter #{i+1}: welcome to Perf Co."})
messages.append({"channel": "perfco-hq", "from": "bob", "text": "Team sync at 3pm."})
messages.append({"channel": "freshness", "from": "alice", "text": "Freshness test channel."})
for k in ["bob","carol","dave","erin","frank","grace"]:
    messages.append({"channel": f"dm-alice-{k}", "from": k, "text": "Hey Alice, got a minute later today?"})
    messages.append({"channel": f"dm-alice-{k}", "from": "alice", "text": "Sure, what's up?"})
    messages.append({"channel": f"dm-alice-{k}", "from": k, "text": "Wanted to sync on the launch notes before Friday."})
docs = {"launch-notes": {"owner": "alice", "name": "Launch notes", "content": "# Launch notes\n\nShip it.\n",
        "share": [{"with": "team:perfco", "level": "view"}]}}
scenario = {"scenario": "channels-perf", "description": "Channel open-path perf fixture: 21 personas, small/medium/large channels, DMs.",
  "users": users, "teams": {"perfco": team}, "channels": channels, "documents": docs, "messages": messages}
(OUT / "channels-perf-scenario.json").write_text(json.dumps(scenario, indent=1))
print(json.dumps({"users": len(users), "channels": len(channels), "messages": len(messages)}))
