CREATE TABLE email_unsubscribe_code (
  email TEXT PRIMARY KEY, -- The email address should be lowercased before insertion
  code UUID UNIQUE NOT NULL -- UUID used in the email unsubscribe link
);

CREATE UNIQUE INDEX email_unsubscribe_code_code_idx ON email_unsubscribe_code (code);
