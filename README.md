# SARKSH Portal V11 — Fast Backend + Automatic Google Meet

## Performance architecture

V11 removes several high-latency patterns from the Apps Script hot path:

- no session `last_seen` Sheet write on every API read
- direct exact-row lookups for session/user/customer/admin/challenge rows
- settings mirrored into Script Properties for low-latency reads
- account financial metrics materialized in `09_ACCOUNTS`
- trade/ledger writes increment the materialized account metrics
- customer dashboard reads recent rows in bounded blocks rather than reading full trade/ledger history
- Admin Accounts and Customers no longer rescan all trades and ledger rows
- Admin Trades and Audit are bounded to recent records
- browser boot only initializes the current page
- customer notification state is reused from the page response, removing a duplicate backend request on most customer pages
- concurrent identical read requests are coalesced in the browser

### 50–100 ms target

The frontend can render and react in that range on a warm path, but Google Apps Script Web App cold-start/network latency is controlled by Google's runtime and cannot be guaranteed at 50–100 ms end-to-end.

V11 is designed to remove SARKSH-controlled latency and keep normal warm backend work as small as possible. `server_ms` remains in every API response for measurement.

## Automatic Google Meet

Automatic Meet generation uses the **first-party Google Calendar Advanced Service**, not a third-party vendor.

Admin flow:

Customer requests Live KYC
→ KYC queue
→ Agent clicks **Accept & Generate Meet**
→ Apps Script creates Calendar event with `conferenceData.createRequest`
→ Google generates `hangoutsMeet`
→ Calendar invitations go to customer + agent
→ session becomes `MEET_READY`
→ customer polling detects the published URL
→ **Join Google Meet** icon/button appears automatically

If conference creation is still pending, the Admin workspace exposes **Generate / Retry Meet**.

## Existing database

Use the same Apps Script project and production Sheet.

Run:

`migrateExistingDatabaseToV11()`

This:
- creates the PRE-V11 backup
- adds the new materialized metric columns to `09_ACCOUNTS`
- rebuilds account metrics from the existing live trades/ledger
- preserves existing customers, KYC, trades, ledger, admins and agreements

## Apps Script deployment

Replace:
- `Code.gs`
- `appsscript.json`

Run migration and authorize the new Google Calendar permission.

Update the **existing** Web App deployment version. Keep the same `/exec` URL:

https://script.google.com/macros/s/AKfycbzvnPVHqRKhJZO8Qd3vtyF0K5_rYYwYTDWXCBZAZZFAZjqgTsBnx1dux6d2KM0PjYGkNA/exec

## GitHub

Push V11 to `main`; the existing GitHub Actions workflow builds and deploys Pages.
