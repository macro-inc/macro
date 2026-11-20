# User Link Cleanup Handler

Triggers via event bridge to go through users in progress links and delete any that are > 24h old,
except Gmail attempts that linked a Google identity: the authentication service releases that
identity and then deletes them.
