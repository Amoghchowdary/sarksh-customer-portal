# V3/V4 production database -> V5

Use the SAME Apps Script project.

Run:
`migrateV3DatabaseToV5()`

The function:
- requires the existing `SARKSH_SHEET_ID`
- copies the production spreadsheet before modification
- never clears existing tables
- only appends missing schema
- creates 19_KYC_LIVE_SESSIONS and 20_KYC_SIGNAL
- adds KYC_AGENT if missing

Before deployment, confirm in the execution log that the live database URL is the same spreadsheet currently containing the existing customers.
