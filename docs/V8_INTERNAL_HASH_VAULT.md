# V8 Internal Keyed-Hash Vault

The vault uses HMAC-SHA256 with secret keys generated inside Apps Script and stored in Script Properties.

This is intentionally one-way.

It is suitable for:
- Aadhaar equality/reference verification without storing plaintext
- document integrity tagging
- tamper detection

It is not encryption and cannot recover Aadhaar plaintext.

Key rotation:
`rotateSarkshInternalHashKey()`

Historical key versions remain stored so older HMAC values can still be verified if the original input is presented again.
