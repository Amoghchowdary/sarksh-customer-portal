# SARKSH Customer + Admin Portal V3 — 3-Factor Admin Security

Architecture remains intentionally simple:

**GitHub Pages → one Google Apps Script `Code.gs` → Google Sheets + private Google Drive**

Frontend still uses one `js/app.js`. Apps Script still uses only `Code.gs` + `appsscript.json`.

## Primary admin

Primary administrator: `grow@sarksh.in`

### First setup / password generation

1. Run `setupSarkshPortal()` once.
2. Run `setupPrimaryAdminSecurity()`.
3. Open **Execution log** and copy the generated password.
4. Store the password in a password manager. Do not paste it into GitHub or `Code.gs`.
5. Deploy/redeploy the Apps Script Web App.

Re-running `setupPrimaryAdminSecurity()` rotates the password and revokes existing admin sessions.

## Admin login security

Admin login is now three-stage:

1. **Admin-generated password**
2. **Email OTP** sent by Apps Script to the admin's configured mailbox (`grow@sarksh.in` for the primary admin)
3. **Google Authenticator TOTP**

On the first successful password + email OTP login, the portal displays a Google Authenticator setup key. Add it in Google Authenticator as a **time-based** key, then enter the current 6-digit code. After enrollment, future admin logins always require all three stages.

If the Authenticator device is lost, an authorised Apps Script project owner can run:

`resetPrimaryAdminAuthenticator()`

This disables the current TOTP secret and revokes existing admin sessions. The next login re-enrolls Google Authenticator.

## Admin Customer 360

Search a customer in **Admin → Customers → View**. Each customer now has an individual monitoring dashboard showing:

- Amount Placed (principal recorded under the customer arrangement)
- Current Account Amount
- Trades Taken
- Net Trading P&L
- customer/KYC/account status
- complete trade register
- account ledger

## Financial wording

The UI intentionally uses **Amount Placed** / **Account Amount**, not **Invested Amount**. The visual design can resemble a portfolio dashboard, but the legal nature of funds must match the actual agreement and accounting records. If funds are legally borrowed by SARKSH, do not represent them to a customer as an investment made by the customer.

## Database migration

Running `setupSarkshPortal()` on an existing V2 database is migration-aware. It adds missing columns/tabs rather than recreating the database.

New admin-security data includes:

- OTP email
- TOTP secret / enabled status
- failed login count / temporary lock
- `16_AUTH_CHALLENGES` sheet for short-lived login challenges

No Apps Script `CacheService` is used.
