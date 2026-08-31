# SARKSH Portal V8 — No External API / Internal Keyed-Hash Vault

## Core rule

V8 removes the Google Cloud KMS REST dependency and removes automatic Google Calendar/Meet API creation.

The application continues to use only the chosen native Apps Script services:
- SpreadsheetApp
- DriveApp
- PropertiesService
- Utilities
- MailApp

There is no `UrlFetchApp` call in the backend and no Advanced Google service in `appsscript.json`.

## Important terminology

Hashing is not encryption and is not a conventional KMS.

For Aadhaar, V8 uses a **one-way keyed HMAC-SHA256 vault** because the portal does not need to recover the original Aadhaar number after KYC submission.

Stored values:
- `aadhaar_masked` → XXXX-XXXX-1234
- `aadhaar_hmac` → keyed HMAC-SHA256
- `aadhaar_hash_key_version`
- `aadhaar_hash_scheme` → HMAC-SHA256

The full Aadhaar number is never written to Google Sheets.

If the original number is needed again, the customer must re-enter it or use the uploaded Aadhaar document.

## Internal key vault

Secrets are generated and stored in Apps Script Script Properties.

Initialization happens automatically through migration/setup.

Status:
`internalHashVaultStatus()`

Rotate active key:
`rotateSarkshInternalHashKey()`

Rotation preserves previous key versions for historical verification. Existing Aadhaar values cannot be re-hashed under a new key without asking the customer for the original value again.

## KYC document integrity

Private KYC files remain in Google Drive.

V8 stores:
- SHA-256 fingerprint
- HMAC-SHA256 integrity tag
- integrity key version
- integrity scheme

This detects document tampering/reference mismatch.

Hashing does **not** encrypt the document contents. Drive access controls and Google-managed storage encryption remain the confidentiality layer for the file vault.

## Google Meet without API dependency

The KYC agent manually creates a Google Meet in the authorised Google account.

Admin workflow:
1. Open `/admin/kyc-live.html`
2. Accept customer
3. Review KYC documents
4. Create a Google Meet manually
5. Paste `https://meet.google.com/...`
6. Click `Publish Meet Link`
7. Customer sees the link in the portal
8. MailApp sends the same link to the customer
9. Agent verifies / requests re-verification / rejects

No Calendar API or Meet API is invoked by the portal.

## Existing database

Use the same Apps Script project and production database.

Run:
`migrateExistingDatabaseToV8()`

The migration makes a PRE-V8 backup and only adds missing schema/metadata fields.

## Existing backend URL

https://script.google.com/macros/s/AKfycbzvnPVHqRKhJZO8Qd3vtyF0K5_rYYwYTDWXCBZAZZFAZjqgTsBnx1dux6d2KM0PjYGkNA/exec

## Deployment

1. Replace `Code.gs`
2. Replace `appsscript.json`
3. Run `migrateExistingDatabaseToV8()`
4. Run `internalHashVaultStatus()`
5. Update the EXISTING Apps Script Web App deployment
6. Keep the same `/exec` URL
7. Push frontend to `main`
8. GitHub Actions deploys Pages
