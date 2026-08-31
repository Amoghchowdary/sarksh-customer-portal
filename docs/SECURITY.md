# Security & Go-Live Checklist

- [ ] Replace Apps Script URL placeholder.
- [ ] Create a unique strong Super Admin password.
- [ ] Never commit passwords, Sheet IDs, Drive folder IDs or real KYC files.
- [ ] Limit admin accounts to named people and least-privilege roles.
- [ ] Review Apps Script Web App sharing settings.
- [ ] Verify KYC Drive folder is private.
- [ ] Add MFA / stronger identity provider before production.
- [ ] Add rate limiting and abuse controls before public launch.
- [ ] Confirm data retention/deletion policy for identity and video records.
- [ ] Confirm lawful KYC/V-CIP process before processing Aadhaar or regulated identity data.
- [ ] Add independent immutable audit export/backup for production.
- [ ] Pen-test customer isolation: one customer must never retrieve another customer's account/trades/KYC.
- [ ] Test mobile, desktop and accessibility before go-live.
