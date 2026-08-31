# SARKSH Backend Architecture V2

GitHub Pages
    |
    | HTTPS POST / fetch
    v
Google Apps Script Web App
    |
    |-- Code.gs (all backend logic)
    |-- appsscript.json
    |
    +--> Google Sheets database
    |
    +--> Private Google Drive KYC/video storage

No CacheService is used in the backend.

All customer read operations identify the customer from the authenticated server-side session rather than accepting a customer ID from the browser.
