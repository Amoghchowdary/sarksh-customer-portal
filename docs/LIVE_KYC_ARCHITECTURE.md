# Live KYC architecture

Customer browser and Agent browser communicate through WebRTC.

Google Apps Script/Sheets are a signalling plane, not the media plane.

States:
WAITING_AGENT -> AGENT_JOINING -> LIVE -> COMPLETED

Results:
VERIFIED
RESUBMIT
REJECTED

VERIFIED activates the user/account. RESUBMIT leaves the registration token usable for another live session.

For higher scale/reliability, migrate signalling from Apps Script polling to a realtime signalling service and add controlled TURN/TLS relay infrastructure.
