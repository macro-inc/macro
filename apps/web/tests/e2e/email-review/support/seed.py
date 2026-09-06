import json, hashlib, uuid
from pathlib import Path
import os
root = Path.cwd()
out = Path(os.environ.get('EMAIL_REVIEW_OUTPUT', '/tmp/email-exhaustive-review'))
out.mkdir(parents=True, exist_ok=True)
scenario = 'email-exhaustive-review'

def ident(kind, key):
    h = hashlib.sha256(scenario.encode()).digest()
    full = hashlib.sha256((scenario + '\x00' + kind + '\x00' + key).encode()).digest()
    b = bytearray(b'^\xed' + h[:2] + full[:12])
    b[6] = b[6] & 15 | 128
    b[8] = b[8] & 63 | 128
    return str(uuid.UUID(bytes=bytes(b)))

def fixture(name):
    return json.loads((root / 'packages/email-renderer/tests/fixtures' / f'{name}.json').read_text())['html']
alex = 'alex.email-review@seed.macro.local'
maya = 'maya.email-review@seed.macro.local'
guest = 'guest.email-review@seed.macro.local'
threads = {
    'launch': dict(subject='Atlas launch — final review', **{
        'from': maya,
    }, body='Hi Alex, the launch checklist is ready. Please review the design and timing before Thursday.', body_html='<p>Hi Alex,</p><p>The launch checklist is ready. Please review the <strong>design and timing</strong> before Thursday.</p><p>Thanks,<br>Maya</p>', unread=True),
    'calendar-invite': dict(subject='Invitation: Atlas launch review — Thursday 7–9 PM', **{
        'from': maya,
    }, body='Atlas launch review invitation', body_html=fixture('google-calendar-invite')),
    'calendar-response': dict(subject='Accepted: Atlas launch review', **{
        'from': 'noah@northstar.test',
    }, body='Noah accepted the invitation', body_html=fixture('personal-calendar-response')),
    'newsletter': dict(subject='Northstar Weekly — design systems and product updates', **{
        'from': 'digest@northstar.test',
    }, body='This week: design systems, product updates, and release notes.', body_html=fixture('styled-email')),
    'personal': dict(subject='A note about our new product release', **{
        'from': maya,
    }, body='A personal release announcement', body_html=fixture('personal-letter')),
    'plain': dict(subject='Plaintext checklist — release readiness', **{
        'from': 'noah@northstar.test',
    }, body='**Release readiness**\n\n- Review accessibility\n- Confirm launch date\n- Send the final agenda\n\n[Review the brief](https://example.test/brief)'),
    'macro': dict(subject='Rich notes — launch decisions', **{
        'from': maya,
    }, body='Launch decisions: approved scope and next steps'),
    'wide-table': dict(subject='September budget — wide comparison table', **{
        'from': 'finance@northstar.test',
    }, body='September budget comparison', body_html=fixture('wide-table')),
    'long-history': dict(subject='Atlas design review — complete conversation', **{
        'from': maya,
    }, body='Design review message 001: kickoff, goals, and owners.'),
    'attachments': dict(subject='Launch assets — attachments and inline image', **{
        'from': maya,
    }, body='Attached: launch notes, calendar invitation, and brand image.', body_html='<p>Hi Alex,</p><p>Here are the launch assets for review.</p><p><img src="cid:launch-mark" alt="Atlas launch mark" width="240" height="120"></p><p>Thank you,<br>Maya</p>'),
    'links': dict(subject='Links, quote history, and signature', **{
        'from': maya,
    }, body='Please contact Noah about the review.', body_html='<p>Please <a href="mailto:noah@northstar.test?subject=Atlas%20review&cc=maya.email-review%40seed.macro.local&body=Hello%20Noah%2C">contact Noah about the review</a>.</p><p><a href="https://example.test/atlas">Open the launch brief</a></p><div class="gmail_signature">Maya Chen<br>Product Design · Northstar</div><div class="macro_quote"><blockquote>Earlier: keep the launch checklist concise.</blockquote></div>'),
    'draft-only': dict(subject='Draft: launch follow-up', **{
        'from': alex,
    }, body='Follow-up draft ready to finish.'),
    'sent-only': dict(subject='Sent: agenda approved', **{
        'from': alex,
    }, body='The agenda is approved. Thank you for the careful review.'),
    'read-only': dict(subject='Shared for review — view access', **{
        'from': maya,
    }, body='This thread is shared with the guest as view-only.', share=[{
        'with': 'user:guest',
        'level': 'view',
    }]),
    'failure-cases': dict(subject='Resilience checks — recoverable failures', **{
        'from': maya,
    }, body='Use this thread to verify transient loading and save failures.'),
}
for i, t in enumerate(threads.values()):
    t['sent_minutes_ago'] = 10 + i * 5
spec = {
    'scenario': scenario,
    'description': 'Deterministic local email review: realistic inboxes, conversations, rendering, drafts, permissions and browser video. No external email delivery.',
    'users': {
        'alex': {
            'email': alex,
            'first_name': 'Alex',
            'last_name': 'Morgan',
            'roles': ['professional_subscriber'],
        },
        'maya': {
            'email': maya,
            'first_name': 'Maya',
            'last_name': 'Chen',
            'roles': ['professional_subscriber'],
        },
        'guest': {
            'email': guest,
            'first_name': 'Taylor',
            'last_name': 'Reed',
        },
    },
    'documents': {
        'brief': {
            'owner': 'alex',
            'name': 'Atlas launch brief',
            'content': '# Atlas launch brief\n\nA focused launch for a calmer workspace.\n\n## Owners\n- Alex: launch coordination\n- Maya: design and accessibility\n\n## Checklist\n- Confirm the agenda\n- Review attachments\n- Publish the release notes',
            'share': [{
                'with': 'user:maya',
                'level': 'edit',
            }],
        },
        'notes': {
            'owner': 'alex',
            'name': 'Launch review notes',
            'content': '# Review notes\n\nKeep the first release simple and predictable.',
        },
    },
    'emails': {
        'work': {
            'owner': 'alex',
            'threads': threads,
        },
        'studio': {
            'owner': 'alex',
            'address': 'studio@northstar.test',
            'threads': {
                'client-brief': {
                    'subject': 'Studio inbox — client brief',
                    'from': 'priya@partner.test',
                    'body': 'Please reply from the studio inbox with the revised brief.',
                    'unread': True,
                },
            },
        },
        'support': {
            'owner': 'maya',
            'address': 'support@northstar.test',
            'delegated_to': ['alex'],
            'threads': {
                'customer': {
                    'subject': 'Shared support inbox — customer question',
                    'from': 'customer@partner.test',
                    'body': 'Can you confirm the launch date?',
                },
            },
        },
    },
}
spec['emails']['guest'] = {
    'owner': 'guest',
    'threads': {},
}
(out / 'scenario.json').write_text(json.dumps(spec, indent=2) + '\n')
manifest = {
    'scenario': scenario,
    'users': spec['users'],
    'links': {k: ident('email_link', k) for k in spec['emails']},
    'threads': {},
    'messages': {},
    'documents': {k: ident('document', k) for k in spec['documents']},
}
for account, value in spec['emails'].items():
    for key in value['threads']:
        k = account + ':' + key
        manifest['threads'][k] = ident('email_thread', account + '/' + key)
        manifest['messages'][k] = ident('email_message', account + '/' + key)
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Created scenario:', len(threads) + 2, 'threads,', len(spec['emails']), 'inboxes,', len(spec['users']), 'personas')
m = json.loads((out / 'manifest.json').read_text())

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

def uid(s):
    return q(s) + '::uuid'
statements = ['BEGIN;']
work = m['links']['work']
alex = m['users']['alex']['email']
maya = m['users']['maya']['email']
people = [(alex, 'Alex Morgan'), (maya, 'Maya Chen'), ('noah@northstar.test', 'Noah Patel'), ('priya@partner.test', 'Priya Shah'), ('digest@northstar.test', 'Northstar Weekly'), ('finance@northstar.test', 'Northstar Finance')]
for link in m['links'].values():
    for email, name in people:
        statements.append(f"INSERT INTO email_contacts (id,link_id,email_address,name) VALUES ({uid(ident('review_contact', link + email))},{uid(link)},{q(email)},{q(name)}) ON CONFLICT (link_id,email_address) DO UPDATE SET name=excluded.name;")
    statements.append(f'UPDATE email_messages m SET from_name=c.name FROM email_contacts c WHERE m.from_contact_id=c.id AND m.link_id={uid(link)};')
for key, total in [('launch', 8), ('long-history', 120)]:
    thread = m['threads']['work:' + key]
    base = m['messages']['work:' + key]
    ids = [base]
    statements.append(f"UPDATE email_messages SET is_read=true, internal_date_ts=now()-interval '{total + 20} minutes',sent_at=now()-interval '{total + 20} minutes',global_id={q('atlas-' + key + '-001@northstar.test')} WHERE id={uid(base)};")
    for n in range(2, total + 1):
        mid = ident('review_message', key + '/' + str(n))
        ids.append(mid)
        sender = people[(n - 1) % 3]
        text = f'Design review message {n:03}: ' + ['Confirm accessibility and keyboard navigation.', 'Review the release notes and attachment checklist.', 'The design is approved; please confirm the launch timing.'][n % 3] if key == 'long-history' else [f'Hi team, round {n}: the new sidebar is ready for review.', f'I reviewed round {n}. The calendar invitation and agenda look good.', f'Round {n} is approved. Please send the final launch notes.'][n % 3]
        html = '<p>' + text + '</p><div class="macro_quote"><blockquote>Earlier discussion: keep the launch simple, accessible, and reliable.</blockquote></div>'
        statements.append(f"INSERT INTO email_messages (id,provider_id,thread_id,provider_thread_id,link_id,internal_date_ts,sent_at,snippet,subject,from_contact_id,from_name,is_read,body_text,body_html_sanitized,global_id) SELECT {uid(mid)},{q('review-' + key + '-' + str(n))},thread_id,provider_thread_id,link_id,now()-interval '{total + 20 - n} minutes',now()-interval '{total + 20 - n} minutes',{q(text[:100])},subject,(SELECT id FROM email_contacts WHERE link_id={uid(work)} AND email_address={q(sender[0])}),{q(sender[1])},{('true' if n < total - 1 else 'false')},{q(text)},{q(html)},{q('atlas-' + key + '-' + str(n) + '@northstar.test')} FROM email_messages WHERE id={uid(base)} ON CONFLICT (id) DO NOTHING;")
        statements.append(f'INSERT INTO email_message_recipients (message_id,contact_id,recipient_type,name) SELECT {uid(mid)},contact_id,recipient_type,name FROM email_message_recipients WHERE message_id={uid(base)} ON CONFLICT DO NOTHING;')
        statements.append(f"""INSERT INTO email_message_labels (message_id,label_id) SELECT {uid(mid)},id FROM email_labels WHERE link_id={uid(work)} AND provider_label_id IN ('INBOX','CATEGORY_PERSONAL'{(",'UNREAD'" if n >= total - 1 else '')}) ON CONFLICT DO NOTHING;""")
    statements.append(f'UPDATE email_threads SET latest_inbound_message_ts=(SELECT max(sent_at) FROM email_messages WHERE thread_id={uid(thread)}),latest_non_spam_message_ts=(SELECT max(sent_at) FROM email_messages WHERE thread_id={uid(thread)}),is_read=false WHERE id={uid(thread)};')
    m[key + 'Messages'] = ids
thread_ids = ','.join((uid(m['threads']['work:' + k]) for k in ['launch', 'long-history']))
statements.append(f'UPDATE email_messages em SET is_sent=true,is_read=true FROM email_contacts c WHERE em.from_contact_id=c.id AND c.email_address={q(alex)} AND em.thread_id IN ({thread_ids});')
statements.append(f"UPDATE email_message_recipients r SET contact_id=(SELECT id FROM email_contacts WHERE link_id={uid(work)} AND email_address={q(maya)}),name='Maya Chen' FROM email_messages em WHERE r.message_id=em.id AND em.is_sent AND r.recipient_type='TO' AND em.thread_id IN ({thread_ids});")
statements.append(f"DELETE FROM email_message_labels ml USING email_messages em,email_labels l WHERE ml.message_id=em.id AND ml.label_id=l.id AND em.thread_id IN ({thread_ids}) AND ((em.is_sent AND l.provider_label_id IN ('INBOX','CATEGORY_PERSONAL')) OR (em.is_read AND l.provider_label_id='UNREAD'));")
statements.append(f"INSERT INTO email_message_labels SELECT em.id,l.id FROM email_messages em CROSS JOIN email_labels l WHERE em.thread_id IN ({thread_ids}) AND em.is_sent AND l.link_id=em.link_id AND l.provider_label_id='SENT' ON CONFLICT DO NOTHING;")
statements.append(f"INSERT INTO email_message_recipients (message_id,contact_id,recipient_type,name) SELECT m.id,c.id,'CC','Noah Patel' FROM email_messages m CROSS JOIN email_contacts c WHERE m.thread_id={uid(m['threads']['work:launch'])} AND c.link_id={uid(work)} AND c.email_address='noah@northstar.test' ON CONFLICT DO NOTHING;")
statements.append(f"UPDATE email_messages SET body_html_sanitized=NULL WHERE id={uid(m['messages']['work:plain'])};")
macro = f"# Launch decisions\n\n**Approved:** keyboard navigation and email layout.\n\n- Confirm accessibility\n- Review attachments\n\n[Atlas launch brief](/app/md/{m['documents']['brief']})"
statements.append(f"UPDATE email_messages SET body_macro={q(macro)} WHERE id={uid(m['messages']['work:macro'])};")
for key in ['newsletter', 'wide-table']:
    statements.append(f"DELETE FROM email_message_labels WHERE message_id={uid(m['messages']['work:' + key])} AND label_id IN (SELECT id FROM email_labels WHERE provider_label_id='CATEGORY_PERSONAL');")
    statements.append(f"UPDATE email_threads SET is_signal=false WHERE id={uid(m['threads']['work:' + key])};")
for link, name in [(work, 'Alex Morgan · Northstar'), (m['links']['studio'], 'Northstar Studio · Design team'), (m['links']['support'], 'Northstar Support')]:
    signature = f'<div><strong>{name}</strong><br><a href="https://example.test/northstar">northstar.test</a></div>'
    statements.append(f'INSERT INTO email_settings (link_id,signature_on_replies_forwards,signature) VALUES ({uid(link)},true,{q(signature)}) ON CONFLICT(link_id) DO UPDATE SET signature=excluded.signature,signature_on_replies_forwards=true;')
draft = m['messages']['work:draft-only']
sent = m['messages']['work:sent-only']
statements.append(f"UPDATE email_messages SET is_draft=true,provider_id=NULL,body_macro='Follow-up draft ready to finish.',body_html_sanitized='<p>Follow-up draft ready to finish.</p>' WHERE id={uid(draft)};")
statements.append(f"UPDATE email_message_recipients SET contact_id=(SELECT id FROM email_contacts WHERE link_id={uid(work)} AND email_address={q(maya)}),name='Maya Chen' WHERE message_id={uid(draft)} AND recipient_type='TO';")
statements.append(f'DELETE FROM email_message_labels WHERE message_id IN ({uid(draft)},{uid(sent)});')
for mid, label in [(draft, 'DRAFT'), (sent, 'SENT')]:
    statements.append(f'INSERT INTO email_message_labels SELECT {uid(mid)},id FROM email_labels WHERE link_id={uid(work)} AND provider_label_id={q(label)} ON CONFLICT DO NOTHING;')
statements.append(f'UPDATE email_messages SET is_sent=true WHERE id={uid(sent)};')
statements.append(f"UPDATE email_threads SET inbox_visible=false,latest_inbound_message_ts=NULL,latest_outbound_message_ts=now()-interval '10 minutes' WHERE id IN ({uid(m['threads']['work:draft-only'])},{uid(m['threads']['work:sent-only'])});")
saved = ident('review_draft', 'launch/4')
m['savedReplyDraft'] = saved
target = m['launchMessages'][3]
statements.append(f"INSERT INTO email_messages (id,thread_id,provider_thread_id,link_id,subject,from_contact_id,from_name,is_draft,is_read,body_text,body_macro,body_html_sanitized,replying_to_id) SELECT {uid(saved)},thread_id,provider_thread_id,link_id,'Re: Atlas launch — final review',(SELECT id FROM email_contacts WHERE link_id={uid(work)} AND email_address={q(alex)}),'Alex Morgan',true,true,'I reviewed the navigation and invitation. Ready to send the final agenda.','I reviewed the navigation and invitation. Ready to send the final agenda.','<p>I reviewed the navigation and invitation. Ready to send the final agenda.</p>',{uid(target)} FROM email_messages WHERE id={uid(target)} ON CONFLICT (id) DO NOTHING;")
statements.append(f"INSERT INTO email_message_recipients SELECT {uid(saved)},id,'TO','Maya Chen' FROM email_contacts WHERE link_id={uid(work)} AND email_address={q(maya)} ON CONFLICT DO NOTHING;")
statements.append(f"INSERT INTO email_message_labels SELECT {uid(saved)},id FROM email_labels WHERE link_id={uid(work)} AND provider_label_id='DRAFT' ON CONFLICT DO NOTHING;")
m['attachments'] = {}
for name, mime, size, cid in [('launch-notes.txt', 'text/plain', 120, None), ('launch-invite.ics', 'text/calendar', 320, None), ('atlas-mark.png', 'image/png', 1200, '<launch-mark>')]:
    aid = ident('review_attachment', name)
    m['attachments'][name] = aid
    statements.append(f"INSERT INTO email_attachments (id,message_id,provider_attachment_id,filename,mime_type,size_bytes,content_id) VALUES ({uid(aid)},{uid(m['messages']['work:attachments'])},{q('review-' + name)},{q(name)},{q(mime)},{size},{(q(cid) if cid else 'NULL')}) ON CONFLICT (id) DO NOTHING;")
statements.append(f"UPDATE email_messages SET has_attachments=true WHERE id={uid(m['messages']['work:attachments'])};")
statements.append('COMMIT;')
(out / 'seed-enrichment.sql').write_text('\n'.join(statements) + '\n')
(out / 'manifest.json').write_text(json.dumps(m, indent=2) + '\n')
print('Prepared enrichment:', len(statements), 'statements')
assets = out / 'assets'
assets.mkdir(exist_ok=True)
(assets / 'launch-notes.txt').write_text('Atlas launch notes\n\nOwner: Alex Morgan\nDesign: Maya Chen\nChecklist: accessibility, invitation, attachments, final agenda.\n')
(assets / 'launch-invite.ics').write_bytes('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:atlas-review@northstar.test\r\nDTSTART:20261203T190000Z\r\nDTEND:20261203T200000Z\r\nSUMMARY:Atlas launch review\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'.encode())
(assets / 'atlas-mark.png').write_bytes((root / 'apps/web/public/logo192.png').read_bytes())
