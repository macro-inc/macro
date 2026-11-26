"""Regression checks for the independent lab oracle, never a hosted mailbox."""

import contextlib
from email.message import EmailMessage
import io
import json
import os
from pathlib import Path
import ssl
import unittest
from unittest.mock import patch
import uuid

import control


class UnstableSnapshot(unittest.TestCase):
    def test_changing_mailbox_has_one_deadline_across_rescans(self):
        class ChangingPeer:
            elapsed = 0
            fetches = 0

            def socket(self):
                return self

            def gettimeout(self):
                return 10

            def settimeout(self, value):
                pass

            def select(self, folder):
                return "OK", []

            def uid(self, command, *args):
                if command == "FETCH":
                    self.elapsed += 3
                    self.fetches += 1
                    return "OK", [None]
                return "OK", [b"" if args[1] == "UID" else b"1"]

        peer = ChangingPeer()
        with patch.object(control.time, "monotonic", side_effect=lambda: peer.elapsed):
            with self.assertRaisesRegex(RuntimeError, "did not stabilize before its deadline"):
                control.read_snapshot(peer, {"operation": "messages"})
        self.assertLessEqual(peer.fetches, 4)

    def test_missing_body_for_existing_uid_is_an_error(self):
        class PresentPeer:
            def socket(self):
                return self

            def gettimeout(self):
                return 10

            def settimeout(self, value):
                pass

            def select(self, folder):
                return "OK", []

            def uid(self, command, *args):
                return ("OK", [None]) if command == "FETCH" else ("OK", [b"1"])

        with self.assertRaisesRegex(RuntimeError, "omitted a body for an existing UID"):
            control.read_snapshot(PresentPeer(), {"operation": "messages"})


@unittest.skipUnless(os.environ.get("IMAP_LAB_REQUIRED") == "true", "requires the owned TLS lab")
class MoveDuringSnapshot(unittest.TestCase):
    def test_two_clients_move_between_search_and_fetch(self):
        context = ssl.create_default_context(cafile=Path(control.__file__).parent / "generated/ca.pem")
        port = int(os.environ.get("IMAP_LAB_IMAPS_PORT", "35993"))
        address = f"oracle-move-{uuid.uuid4().hex}@example.com"
        message_id = f"<oracle-{uuid.uuid4().hex}@example.com>"
        message = EmailMessage()
        message["From"] = "writer@example.com"
        message["To"] = address
        message["Message-ID"] = message_id
        message["Subject"] = "Independent oracle MOVE regression"
        message.set_content("Synthetic mail for the two-client race.")

        client_type = control.imaplib.IMAP4_SSL
        with client_type("localhost", port, ssl_context=context, timeout=10) as mover:
            mover.login(address, "pass")
            mover.create("Archive")
            self.assertEqual(mover.select("Archive")[0], "OK")
            self.assertEqual(mover.append("INBOX", None, None, message.as_bytes())[0], "OK")
            reader = client_type("localhost", port, ssl_context=context, timeout=10)
            moves = []

            class MovingReader:
                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    return reader.__exit__(*args)

                def __getattr__(self, name):
                    return getattr(reader, name)

                def uid(self, command, *args):
                    if command == "FETCH" and not moves:
                        # A second real TLS connection performs the scenario's
                        # intended MOVE after the oracle's SEARCH returned.
                        self_status = mover.select("INBOX")[0]
                        if self_status != "OK":
                            raise AssertionError("the mover could not select INBOX")
                        status, _ = mover.uid("MOVE", args[0], "Archive")
                        if status != "OK":
                            raise AssertionError("the independent MOVE was rejected")
                        moves.append(args[0])
                    return reader.uid(command, *args)

            output = io.StringIO()
            request = io.StringIO(json.dumps({"operation": "messages", "email": address}))
            with (
                patch.object(control.imaplib, "IMAP4_SSL", return_value=MovingReader()),
                patch.object(control.sys, "stdin", request),
                contextlib.redirect_stdout(output),
            ):
                control.main()

        observed = json.loads(output.getvalue())
        self.assertEqual(len(moves), 1)
        self.assertEqual(len(observed), 1)
        self.assertEqual(observed[0]["messageId"], message_id)
        self.assertEqual(observed[0]["folder"], "Archive")


if __name__ == "__main__":
    unittest.main()
