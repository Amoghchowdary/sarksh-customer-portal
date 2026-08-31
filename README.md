# SARKSH Customer + Admin Portal V6

## V6 focus

V6 upgrades both customer experience and KYC operations.

Customer portal now includes:
- Overview
- Trades
- KYC & Document Center
- My SARKSH Team
- Account Settings
- Password change
- Dashboard preferences
- Notification preferences

KYC now includes:
- PAN
- DOB/address
- Aadhaar number OR Aadhaar document
- Private KYC document upload to Google Drive
- PAN/Aadhaar/address-proof document types
- Google Meet live agent verification

## Aadhaar handling

The frontend accepts a 12-digit Aadhaar number when the customer chooses that route.

The backend does **not** return the full number after submission. It stores:
- masked reference, e.g. `XXXX-XXXX-1234`
- keyed HMAC verification value
- mode (`NUMBER`)

The pepper is stored in Apps Script Script Properties, not GitHub.

Alternatively, the customer can upload the Aadhaar/identity document to the private KYC Drive vault.

## Google Meet KYC

Agent page:

`/admin/kyc-live.html`

Workflow:

Customer joins KYC queue
-> Agent opens workspace and reviews uploaded documents
-> Agent clicks `Create Google Meet & Invite`
-> Apps Script creates a Google Calendar event + Google Meet conference
-> Customer and agent receive Calendar invitations
-> Meet link appears in both portals
-> Agent completes KYC as VERIFIED / RESUBMIT / REJECTED

V6 uses Google Calendar API conferenceData with `conferenceDataVersion=1`.

## Existing customer database preservation

Use the SAME Apps Script project and SAME Script Properties.

Run:

`migrateExistingDatabaseToV6()`

The function creates a timestamped Drive backup, then only adds missing V6 columns/tabs.

Existing customers, trades, ledger, KYC and admin records remain in the same production Sheet.

New tables:
- `21_CUSTOMER_TEAM`
- `22_CUSTOMER_SETTINGS`

Existing tables are extended additively:
- `06_KYC`
- `07_KYC_DOCUMENTS`
- `19_KYC_LIVE_SESSIONS`

## Calendar service

V6 `appsscript.json` enables Google Calendar API v3 and adds the calendar.events OAuth scope.

If Apps Script shows `Calendar is not defined`, open Apps Script -> Services (+) -> add **Google Calendar API v3**, authorize it, and redeploy the existing Web App version.

## Deployment

Keep the existing Apps Script `/exec` URL.

1. Paste V6 `Code.gs`
2. Replace `appsscript.json`
3. Run `migrateExistingDatabaseToV6()`
4. Authorize new Calendar permission
5. Update the EXISTING Apps Script deployment to a new version
6. Push frontend to `main`
7. GitHub Actions builds/deploys Pages

Backend already configured:
https://script.google.com/macros/s/AKfycbzvnPVHqRKhJZO8Qd3vtyF0K5_rYYwYTDWXCBZAZZFAZjqgTsBnx1dux6d2KM0PjYGkNA/exec
