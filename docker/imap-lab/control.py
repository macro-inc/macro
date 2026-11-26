"""Independent IMAP oracle for Rust end-to-end scenarios; accepts JSON on stdin."""

import base64
from email import message_from_bytes, policy
from email.message import EmailMessage
import imaplib
import json
import os
import re
from pathlib import Path
import ssl
import subprocess
import tempfile
import sys
import time
import uuid


def submission_mime(subject):
    """Read Dovecot's native relay output before Mailpit synthesizes Bcc headers."""
    container = "macro-imap-lab-dovecot-1"
    with tempfile.TemporaryDirectory(prefix="imap-relay-oracle-") as directory:
        subprocess.run(["docker", "cp", f"{container}:/tmp/macro-relay-rawlog/.", directory], check=True, capture_output=True, timeout=10)
        for filename in reversed(sorted(Path(directory).glob("*.out"))):
            # Native rawlog prepends a timestamp to each line; remove only
            # that logging prefix, preserving the SMTP bytes after it.
            raw = re.sub(rb"(?m)^[0-9]+\.[0-9]{6} ", b"", filename.read_bytes())
            for chunk in raw.split(b"\r\nDATA\r\n")[1:]:
                if b"\r\n.\r\n" not in chunk:
                    continue
                body = chunk.split(b"\r\n.\r\n", 1)[0] + b"\r\n"
                body = b"\r\n".join(line[1:] if line.startswith(b"..") else line for line in body.split(b"\r\n"))
                mail = message_from_bytes(body, policy=policy.default)
                if str(mail.get("Subject", "")) == subject:
                    return {"mimeBase64": base64.b64encode(body).decode(), "headerNames": list(mail.keys())}
    return None


def read_snapshot(server, request, timeout=10):
    """Publish one complete scan; a concurrent MOVE restarts it, never hides mail."""
    deadline = time.monotonic() + timeout
    original_timeout = server.socket().gettimeout()

    def budget():
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("Independent IMAP snapshot did not stabilize before its deadline")
        server.socket().settimeout(remaining)

    try:
        while True:
            messages = []
            restart = False
            for folder in ("INBOX", "Sent", "Archive", "Junk", "Trash"):
                budget()
                if server.select(folder)[0] != "OK":
                    raise RuntimeError("Independent IMAP SELECT was rejected")
                budget()
                status, result = server.uid("SEARCH", None, "ALL")
                if status != "OK":
                    raise RuntimeError("Independent IMAP SEARCH was rejected")
                for uid in result[0].split():
                    budget()
                    status, parts = server.uid("FETCH", uid, "(BODY.PEEK[] FLAGS)")
                    if status != "OK":
                        raise RuntimeError("Independent IMAP FETCH was rejected")
                    source = next((part[1] for part in parts if isinstance(part, tuple)), None)
                    if source is None:
                        # UID FETCH legitimately returns no literal after a
                        # concurrent MOVE/EXPUNGE. Confirm that UID is gone,
                        # then rescan all folders so the destination is read.
                        budget()
                        status, present = server.uid("SEARCH", None, "UID", uid)
                        if status != "OK" or not present or not isinstance(present[0], bytes):
                            raise RuntimeError("Independent IMAP UID recheck was rejected")
                        if uid in present[0].split():
                            raise RuntimeError("Independent IMAP FETCH omitted a body for an existing UID")
                        restart = True
                        break
                    mail = message_from_bytes(source, policy=policy.default)
                    mid = str(mail.get("Message-ID", ""))
                    if request["operation"] == "setRead" and mid == request["messageId"]:
                        mode = "+FLAGS.SILENT" if request["read"] else "-FLAGS.SILENT"
                        budget()
                        if server.uid("STORE", uid, mode, "(\\Seen)")[0] != "OK":
                            raise RuntimeError("Independent IMAP STORE was rejected")
                    metadata = b" ".join(part[0] if isinstance(part, tuple) else part for part in parts if part)
                    messages.append({
                        "messageId": mid,
                        "folder": folder,
                        "uid": uid.decode(),
                        "subject": str(mail.get("Subject", "")),
                        "read": b"\\Seen" in metadata,
                        "mimeBase64": base64.b64encode(source).decode(),
                    })
                if restart:
                    break
            if not restart:
                return messages
    except TimeoutError as error:
        raise RuntimeError("Independent IMAP snapshot did not stabilize before its deadline") from error
    finally:
        server.socket().settimeout(original_timeout)


def main():
    request = json.load(sys.stdin)
    if request["operation"] == "submissionMime":
        print(json.dumps(submission_mime(request["subject"])))
        return
    context = ssl.create_default_context(cafile=Path(__file__).parent / "generated/ca.pem")
    port = int(os.environ.get("IMAP_LAB_IMAPS_PORT", "35993"))
    with imaplib.IMAP4_SSL("localhost", port, ssl_context=context, timeout=10) as server:
        server.login(request["email"], "pass")
        operation = request["operation"]
        if operation == "deliver":
            mail = EmailMessage()
            mail["From"] = request["from"]
            mail["To"] = request.get("to") or request["email"]
            if request.get("cc"):
                mail["Cc"] = request["cc"]
            mail["Subject"] = request["subject"]
            mail["Message-ID"] = f"<{request.get('messageId') or uuid.uuid4().hex}@maillab.example.net>"
            if request.get("messageId"):
                mail.replace_header("Message-ID", f"<{request['messageId'].strip('<>')}>")
            if request.get("inReplyTo"):
                mail["In-Reply-To"] = f"<{request['inReplyTo'].strip('<>')}>"
            mail.set_content(request["text"])
            if request.get("html"):
                mail.add_alternative(request["html"], subtype="html")
            for part in request.get("attachments", []):
                maintype, subtype = part["mimeType"].split("/", 1)
                mail.add_attachment(base64.b64decode(part["base64"]), maintype=maintype, subtype=subtype, filename=part["filename"])
            status, _ = server.append("INBOX", None, None, mail.as_bytes())
            if status != "OK":
                raise RuntimeError("Independent IMAP APPEND was rejected")
            print(json.dumps({"messageId": str(mail["Message-ID"]), "subject": request["subject"]}))
            return
        messages = read_snapshot(server, request)
        if operation not in ("messages", "setRead"):
            raise ValueError("Unknown IMAP oracle operation")
        print(json.dumps(messages))


if __name__ == "__main__":
    main()
