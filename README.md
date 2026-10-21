# MILANO — website source snapshot

Current application snapshot: 21 October 2026. PHP, MySQL/MariaDB and plain HTML/CSS/JavaScript. Dark theme, Russian and English, public CMS content, registration/email confirmation/password recovery, manual receipt moderation, tickets, draw administration and Excel export.

This repository is source code, not a running hosting service or a production launch. GitHub Pages cannot execute the PHP backend or MySQL. The repository replaces the previous static prototype; that version remains in Git history.

## Included and excluded

- Includes current runtime code, product images/videos, database migrations, CLI setup utilities and reviewed public CMS seed data (5 products, 3 articles).
- `database/public-settings.json` contains only the public company contacts and store links. Apply these values using Site settings after importing content.
- Does not include local credentials, mail passwords, database dumps, users, receipts, uploaded private files, session/authentication keys, QA databases, generated test reports or development-only tools.
- Legal text in `database/legal-drafts.json` remains a draft. It is not approved or activated by publishing source code.

## Deployment requirements

Use PHP 8.4 where available, MySQL/MariaDB with InnoDB/utf8mb4, Apache-compatible rewriting and HTTPS. PHP needs PDO MySQL, mbstring, fileinfo, GD/WebP, curl, OpenSSL, XMLWriter and ZipArchive. The runtime has no Composer or frontend-build dependency.

Configure server environment variables (never commit their values):

- `MILANO_APP_ENV=production`
- `MILANO_APP_URL=https://your-test-domain.example`
- `MILANO_DB_DSN`, `MILANO_DB_USER`, `MILANO_DB_PASSWORD`
- `MILANO_AUTH_SECRET` (new, at least 32 random characters)
- `MILANO_STORAGE_PATH` (absolute private directory outside webroot)
- `MILANO_MAIL_TRANSPORT=smtp`, `MILANO_SMTP_HOST`, `MILANO_SMTP_PORT=465`, `MILANO_SMTP_USERNAME`, `MILANO_SMTP_PASSWORD`, `MILANO_SMTP_FROM`

For a new, empty test database, run the CLI utilities from the project directory:

1. `php database/migrate.php`
2. Create a dedicated administrator using `database/create-admin.php` and its documented environment variables.
3. `php database/import-content.php`
4. Configure the public site settings in the administrator interface. Create a clearly labelled test giveaway and artificial test participants.

Review each utility before running it. Do not migrate an existing populated database without a backup. Never import local participant records into a public preview. Do not upload `.git`, setup utilities or private storage into an accessible web directory. Preserve and verify the access-denial rules for `app`, `database` and `storage`.

Public registration requires approved and published legal documents. The local draft exception deliberately does not apply to a public production domain. Receipt verification is manual; no fiscal-provider integration is enabled. A test server must not be presented as an active real giveaway.

Before sharing a test URL, verify HTTPS, SMTP delivery, registration/reset, receipt privacy, admin authorization, manual moderation, winner selection and Excel export on that server. Keep test administrator credentials private and separate from production.

## Persistent login

Ordinary user sessions have a fixed 90-day maximum lifetime, subject to logout, revocation, account status and retained cookies/server sessions. Administrators retain a 30-minute idle limit and an 8-hour absolute limit.

## Assets and licensing

No license to product images, branding or other company assets is granted by this repository. Existing ownership remains unchanged.
