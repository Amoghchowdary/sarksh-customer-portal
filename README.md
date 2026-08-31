# SARKSH Customer + Admin Portal V5 — Live Agent KYC

## Existing database preservation

This release is designed for the **existing V3/V4 Apps Script project and existing Google Sheet database**.

Two existing live customers are not recreated, cleared, moved, or re-imported.

Run this function before the V5 deployment:

`migrateV3DatabaseToV5()`

It performs this sequence:

1. Reads the existing `SARKSH_SHEET_ID` Script Property.
2. Opens the existing production Google Sheet.
3. Creates a timestamped Drive copy of that database.
4. Adds only missing V5 columns/tabs.
5. Preserves existing USERS, CUSTOMERS, TRADES, ACCOUNTS, LEDGER and KYC rows.
6. Adds the live-KYC tables and KYC_AGENT role.

New V5 tables:
- `19_KYC_LIVE_SESSIONS`
- `20_KYC_SIGNAL`

The migration is additive. Do **not** create a new Apps Script project if you want the current database to remain connected. Paste V5 `Code.gs` into the same Apps Script project that currently owns the live V3 database.

## Live KYC workflow

New customer registration:

Account + KYC + Agreement
        ↓
Camera permission
        ↓
Join live verification queue
        ↓
WAITING_AGENT
        ↓
Authorised SARKSH agent accepts
        ↓
Embedded WebRTC customer ↔ agent call
        ↓
Agent chooses:
VERIFIED / RESUBMIT / REJECTED
        ↓
Only VERIFIED activates the customer login/account

## Media architecture

Video/audio media uses WebRTC peer-to-peer transport.

Apps Script + Google Sheets handle only:
- authentication
- queue
- agent assignment
- SDP/ICE signalling
- final verification result
- audit trail

V5 does not record or store the live call.

## Important network note

The build includes public STUN servers for WebRTC discovery. Some corporate/mobile networks require a TURN relay. For production-grade reliability, configure a controlled TURN/TLS service later. Apps Script itself cannot act as a TURN media relay.

## Admin desk

Live agent queue:

`/admin/kyc-live.html`

Allowed roles:
- SUPER_ADMIN
- OPERATIONS_ADMIN
- KYC_ADMIN
- KYC_AGENT

The existing admin 3FA login remains unchanged.

## Backend deployment

Your existing Apps Script URL remains configured:

https://script.google.com/macros/s/AKfycbzvnPVHqRKhJZO8Qd3vtyF0K5_rYYwYTDWXCBZAZZFAZjqgTsBnx1dux6d2KM0PjYGkNA/exec

After replacing `Code.gs`:

1. Run `migrateV3DatabaseToV5()`
2. Confirm the Execution log shows the same live database URL and a pre-V5 backup URL.
3. Deploy a **new version of the existing Web App deployment**.
4. Keep the existing `/exec` URL.

## GitHub deployment

The repository continues to use:

`.github/workflows/deploy-pages.yml`

Push to `main`; GitHub Actions builds `dist/` and deploys Pages.
