"""Verify the real mail-server fixture before running Rust integration tests."""

import argparse
from email.message import EmailMessage
import imaplib
import json
from pathlib import Path
import smtplib
import ssl
from urllib.request import urlopen
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--imap-port", type=int, default=35993)
    parser.add_argument("--smtp-port", type=int, default=35465)
    parser.add_argument("--submission-port", type=int, default=35587)
    parser.add_argument("--mailpit-port", type=int, default=35825)
    args = parser.parse_args()
    context = ssl.create_default_context(cafile=Path(__file__).parent / "generated/ca.pem")
    identity = uuid.uuid4().hex
    alice = f"alice-{identity}@example.net"
    bob = f"bob-{identity}@example.net"
    # The certificate covers localhost. Production tests use the catalog hostname
    # with an explicit endpoint map, preserving SNI and certificate verification.
    with imaplib.IMAP4_SSL("localhost", args.imap_port, ssl_context=context, timeout=10) as first:
        first.login(alice, "pass")
        first.select("INBOX")
        mail = EmailMessage()
        mail["From"] = alice
        mail["To"] = bob
        mail["Subject"] = f"Macro IMAP lab {identity}"
        mail["Message-ID"] = f"<{identity}@example.net>"
        mail.set_content("A real IMAP and SMTP fixture.")
        mail.add_attachment(b"attachment bytes", maintype="application", subtype="octet-stream", filename="proof.bin")
        assert first.append("INBOX", None, None, mail.as_bytes())[0] == "OK"
        status, result = first.uid("SEARCH", None, "ALL")
        assert status == "OK" and len(result[0].split()) == 1
        uid = result[0].split()[0]
        assert first.uid("STORE", uid, "+FLAGS.SILENT", "(\\Seen)")[0] == "OK"
        assert first.uid("MOVE", uid, "Archive")[0] == "OK"
        assert first.uid("SEARCH", None, "ALL")[1] == [b""]
        first.select("Archive")
        assert first.uid("SEARCH", None, "ALL")[1][0]
        with imaplib.IMAP4_SSL("localhost", args.imap_port, ssl_context=context, timeout=10) as second:
            second.login(bob, "pass")
            second.select("INBOX")
            assert second.uid("SEARCH", None, "ALL")[1] == [b""]
            second.select("Archive")
            assert second.uid("SEARCH", None, "ALL")[1] == [b""]
        with smtplib.SMTP_SSL("localhost", args.smtp_port, context=context, timeout=10) as sender:
            sender.login(alice, "pass")
            assert sender.send_message(mail) == {}
        with smtplib.SMTP("localhost", args.submission_port, timeout=10) as sender:
            sender.ehlo()
            sender.starttls(context=context)
            sender.ehlo()
            sender.login(alice, "pass")
            assert sender.send_message(mail) == {}
    with urlopen(f"http://127.0.0.1:{args.mailpit_port}/api/v1/messages", timeout=10) as response:
        messages = json.load(response)["messages"]
    assert sum(item["Subject"] == mail["Subject"] for item in messages) == 2
    print("PASS: verified TLS, isolated accounts, APPEND, UID flags/MOVE, SMTPS, STARTTLS and captured MIME")


if __name__ == "__main__":
    main()
