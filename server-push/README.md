# medMETRIC push bridge (WhatsApp-style ticket alerts)

Phones cannot see GLPI tickets while the app is closed unless **a server** sends a push.

## Install on tech.medmetrichealthcare.com

1. Upload this folder as:
   ```
   /var/www/.../public/medmetric-push/
   ```
   so these URLs work:
   - `https://tech.medmetrichealthcare.com/medmetric-push/register.php`
   - (poll.php is CLI only)

2. Edit `poll.php` CONFIG:
   - `GLPI_APP_TOKEN`
   - API login/password (service account that can **read tickets**)

3. Make `data/` writable:
   ```bash
   mkdir -p medmetric-push/data
   chmod 775 medmetric-push/data
   ```

4. Cron every minute:
   ```cron
   * * * * * php /full/path/to/medmetric-push/poll.php >> /tmp/medmetric-push.log 2>&1
   ```

## App side

1. Install APK **v1.0.4+** (with notification permission)
2. Allow notifications
3. Login — app registers Expo push token automatically via `register.php`

## Flow

```
New/updated ticket in GLPI
        ↓
poll.php (every 1 min) detects change
        ↓
Expo Push API
        ↓
Phone status bar (like WhatsApp)
```

For **instant** (under a few seconds) instead of up to 1 minute, lower cron to every minute is already near-realtime for CMMS; sub-second needs GLPI plugin hooks (can be added later).

## Requester bridge (requester-bridge.php) — My devices + Approve / Refuse

Hospital **Requester / Reporter** profiles can do these in the GLPI browser UI but not through the REST API:

- list **User devices** (machines linked to them) → needed for Equipment and "New ticket → asset"
- **Approve / Refuse** the solution of their own ticket

1. Upload `requester-bridge.php` next to `register.php`
   (`https://YOUR-GLPI/medmetric-push/requester-bridge.php`).
2. Edit CONFIG (same API URL / app token / service login as `poll.php`).
   The service account needs read on assets, update on tickets and solutions, and add followups.
   It is never shown to users.
3. Test devices: `.../requester-bridge.php?action=devices&debug=1&session_token=<valid app session token>`

Safety: the script asks GLPI whether the caller's session is valid, returns only that user's devices,
and approves/refuses only when the caller is a **requester of that ticket** and the ticket is **Solved**.
The follow-up it writes is authored by the service account but names the real requester.

## Checklist: let hospital (Requester) users approve and use their machines

A) GLPI profile (Administration → Profiles → the hospital profile → Assistance tab)
   - Standard interface: enable **Approve solution / Reply survey (my ticket)** (GLPI 11).
   - **Life cycle of tickets**: allow **Solved → Closed** (otherwise approving cannot close the ticket).
   - **Link with items for the creation of tickets**: enable "my devices" (and "my groups' devices" if needed).
   These make the browser work. The REST API used by the app does not honour them for requesters,
   which is why the bridge exists.

B) Install the bridge (the part that makes the APP work)
   1. Upload `requester-bridge.php` to the GLPI web root folder `public/medmetric-push/`.
   2. Edit its CONFIG block. Use a dedicated service account (not the default `glpi` user) with a
      profile that can read assets, update tickets/solutions/asset status and add followups.
   3. Setup → General → API: REST API enabled, "Enable login with credentials" on, and an API client
      that allows the server itself (127.0.0.1 / the server IP) with your App-Token.
   4. Check it is deployed: open `https://YOUR-GLPI/medmetric-push/requester-bridge.php` in a browser.
      Expected: `{"ok":false,"error":"Missing session token"}`. A 404 means wrong folder.

C) In the app: More → Diagnostics → Export request log if anything still fails.
