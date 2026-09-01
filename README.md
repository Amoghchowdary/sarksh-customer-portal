# SARKSH Customer Portal V10 — OTP Login + Post-Login KYC + Responsive UX

## Root cause fixed for customer login
V9 required `01_USERS.status == ACTIVE` for both login and authenticated customer context. Customers with valid pending KYC statuses such as `PENDING_KYC` or `PENDING_LIVE_KYC` were therefore rejected even though they needed portal access to complete KYC.

V10 separates **portal sign-in eligibility** from **KYC/account status**. Allowed customer portal states include ACTIVE and supported pending-verification states. Suspended/disabled accounts remain blocked.

## Customer login
Mandatory two-step sign in:
1. Email or Customer ID + password
2. 6-digit OTP sent through native Apps Script MailApp
3. Customer session created only after OTP succeeds

OTP controls:
- 5-minute expiry
- one-time use
- hashed OTP storage
- attempt limit
- 30-second resend cooldown
- no direct password-only login route

New additive table:
`23_CUSTOMER_AUTH_CHALLENGES`

## Registration / KYC pivot
Registration now collects only:
- full legal name
- mobile
- email
- password
- current published agreement acceptance (only when an agreement is active)

KYC and all document uploads happen **after the customer has logged in**.

Customer KYC flow:
Identity details -> Private document vault -> Live KYC request -> Agent-published Google Meet link.

## Admin Accounts & Ledger
Customer ID copy/paste is removed. The ledger form uses a searchable-style customer select populated with Customer Name + Customer ID + Current Amount. Clicking a customer balance row also selects that customer for the ledger form.

## Responsive UX
V10 adds:
- mobile bottom navigation
- responsive sidebar overlay/drawer
- clearer labels and helper text
- larger touch targets
- mobile/phone/tablet/laptop breakpoints
- simplified registration
- three-step KYC layout
- finite loading/error states
- password show/hide and OTP stage UX

## Security settings
Email OTP is **always on** for customer login. It is not customer-disableable. Customers can change their password and sign out other devices from Account Settings.

## Existing database
Use the SAME Apps Script project and production Sheet.

Run:
`migrateExistingDatabaseToV10()`

This creates a PRE-V10 backup and adds only missing schema, including the customer OTP challenge table. Existing customers, trades, ledger, agreements and documents remain preserved.

## Existing backend
https://script.google.com/macros/s/AKfycbzvnPVHqRKhJZO8Qd3vtyF0K5_rYYwYTDWXCBZAZZFAZjqgTsBnx1dux6d2KM0PjYGkNA/exec

## Deployment
1. Replace `Code.gs`
2. Replace `appsscript.json`
3. Run `migrateExistingDatabaseToV10()`
4. Update the EXISTING Apps Script Web App deployment version
5. Keep the same `/exec` URL
6. Push frontend to `main`
7. GitHub Actions builds and deploys Pages
