# Admin 3FA Flow

Password (generated/rotated from Apps Script)
→ email OTP to grow@sarksh.in
→ Google Authenticator TOTP
→ admin session token

Controls:
- password stored only as salted hash in Sheets
- email OTP stored only as challenge hash
- 5 failed password attempts → 15 minute lock
- OTP/TOTP challenge attempt limits
- short-lived authentication challenge
- session issued only after all three checks
- all three stages create audit events
- Authenticator recovery only from Apps Script owner function

For higher-security production deployment, move admin identity to a managed identity provider with WebAuthn/passkeys or hardware security keys and use Apps Script only as the application API.
