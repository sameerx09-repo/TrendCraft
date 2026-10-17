# Repository Publishing Safety

## Files that must stay private

Keep environment files (except the empty `.env.example` template), provider
credentials, database connection strings, passwords, session cookies, private
keys, and owner-setup links out of Git. The owner setup file in
`web/storage/auth/owner-setup.json` contains a real one-time credential.

The root `.gitignore` also excludes local databases, workspace storage,
generated media, captured provider fixtures, screenshots, logs, scan reports,
local tooling configuration, and internal account/cost/planning notes.
Files remain on disk; they are not part of the source repository.

Do not use `git add -f` to bypass these exclusions. Review every new file,
including fixtures and documentation, for personal information and private
or signed URLs. Files intentionally included in Git should contain only
public configuration, code, or synthetic test data.

## Before a push

Install Gitleaks from its official release, then inspect and scan the exact
staged diff from the repository root:

```sh
git diff --cached --stat
git diff --cached --no-ext-diff --binary | gitleaks stdin --redact
```

After committing, scan all Git history before the first push:

```sh
gitleaks git . --redact --log-opts="--all"
```

A clean scanner result reduces risk but does not prove that all sensitive
information is absent. Manually inspect captured API responses, private
URLs, identifiers, and customer data too. Never upload unredacted scan
reports. Enable GitHub secret scanning and push protection where available.

If a credential is ever committed, revoke/rotate it first, then remove it
from every affected Git revision before publishing. Deleting the file in
a later commit does not remove the secret from history.

## Scope

Repository checks are not a production application security audit. Deployments
still need HTTPS, correctly scoped provider credentials, tenant isolation
verification, production configuration, and secure account recovery.
