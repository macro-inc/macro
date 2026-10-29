"""Migrate GoAlert's database, replace its config with the Nix-declared one, and
create the `admin` login if it does not exist.

GoAlert keeps application config only in Postgres. Running this before every
start makes the Nix attrset the source of truth: edits in the admin UI last
only until the next restart. Secret placeholders such as `@goalert_admin_password@`
are replaced with credential files; values never pass through a shell.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

goalert, template_path, psql = sys.argv[1], sys.argv[2], sys.argv[3]
credentials = Path(os.environ['CREDENTIALS_DIRECTORY'])


def substitute(value):
    if isinstance(value, dict):
        return {key: substitute(item) for key, item in value.items()}
    if isinstance(value, list):
        return [substitute(item) for item in value]
    if isinstance(value, str) and value.startswith('@') and value.endswith('@'):
        return (credentials / value[1:-1]).read_text()
    return value


config = substitute(json.loads(Path(template_path).read_text()))
environment = {
    **os.environ,
    'GOALERT_DATA_ENCRYPTION_KEY': (credentials / 'goalert_encryption_key').read_text(),
}
subprocess.run([goalert, 'migrate'], env=environment, check=True)
subprocess.run(
    [goalert, 'set-config'], env=environment, input=json.dumps(config), text=True, check=True,
)
admin_exists = subprocess.run(
    [psql, '-tAc', "select 1 from auth_basic_users where username = 'admin'", environment['GOALERT_DB_URL']],
    env=environment, capture_output=True, text=True, check=True,
).stdout.strip()
if not admin_exists:
    # `add-user` takes the password only as an argument; this runs once, on first boot.
    subprocess.run(
        [goalert, 'add-user', '--admin', '--user', 'admin', '--email', 'admin@macro.com',
         '--pass', (credentials / 'goalert_admin_password').read_text()],
        env=environment, check=True,
    )
