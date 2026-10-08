# v1.0.29

- New work order: type buttons side by side, category hidden (chosen automatically from the type), attach photos/files before creating (uploaded 2 at a time while the equipment status is updated), equipment entity pre-loaded so Create is faster.
- Stock: changes are sent as GET with the Session-Token (GLPI 11 rejects token-only POST); needs plugin 1.4.4.

# v1.0.28

- Work-order wording (CMMS standard): Work orders, New work order, Equipment, Equipment status, Completed / On hold / Scheduled, Out of service / In service. Amharic + Afaan Oromoo updated (please review).
- New work order form: work order type (corrective / preventive), category, named priority, created in the ENTITY OF THE EQUIPMENT (not "Organization"); header text now white.
- Names show first name first ("Yahya Mohammed"); home welcome uses the first name; server address removed from home.
- Profile: sections have + / − (long ones start closed).
- Stock: every stock-plugin request now appears in Profile → Diagnostics → Export request log (address, status, reason).
- Needs medMETRIC Stock plugin 1.4.3 (replace the whole folder).

# v1.0.27

- Amharic translations updated from community feedback
- Dark Venom theme refined: pure black, blackish gray, and white only
- Removed Care Blue theme (conflicts with Dark Venom)
- Stock plugin API: improved bootstrap to handle GLPI 10/11 routing

# v1.0.26

- Attachments: upload now uses fetch (axios sent Content-Type: application/json with the file, so GLPI could not read it); several photos/files at once; link to ticket in the same request; real error messages; bottom sheet instead of a 4-button alert (Android shows only 3).
- Field stock: Spare part | Tool | QR buttons side by side; per-warehouse stock; reason shown when stock cannot load; tools checked out can now be returned; duplicate follow-ups removed.
- Stock plugin client: remembers the working address, shows the plugin's real error, More -> Stock plugin (tap to test).
- Languages: English, Amharic, Afaan Oromoo dropdown (login + Profile); translations in src/locales; TRANSLATE-ME.csv for corrections.
- New theme: Dark Venom.
- Needs medMETRIC Stock plugin 1.4.2 (older plugin still works for lists, but spare-part deduction needs it).

## 1.0.25 — restyle to the reference design + performance
- Tickets list and Dashboard use one shared card (status badge, priority word + dot, ward, date, Assigned / Unassigned).
- Ticket screen: dark header with #id + title + share, status card, Update status chips, one **Process** timeline
  (opened, follow-ups, tasks, solution, documents) with author names, Mark done / Mark to do on tasks, + button.
- Dashboard: welcome line, Open tickets card with urgent / medium / low bar, New ticket / Equipment / Scan QR tiles.
- Equipment: search + type chips (instead of the dropdown), devices grouped by ward, card rows with Active / Down dot.
- Optional IBM Plex Sans font: see FONTS.md (off by default).
- Performance: dashboard styles memoized; shorter first render for lists (8 items); one shared memoized card;
  author names resolved in parallel and cached; duplicate solution / follow-up lists removed from the screen.
- Fixed: duplicate style key and broken PDF template strings introduced earlier (found by a real syntax check).

## 1.0.24 — analysis fixes + English / Amharic + camera
- Language: English and Amharic only (More → Language). Switching remounts the screens so every label updates.
  Amharic text needs a native-speaker review (unknown strings simply stay English).
- Technician tools (Assign to me, Add task, Post solution, Update status, parts, tools) only show for staff
  profiles; Requester (Hospital Reporter) screens stay simple and no longer call template / stock endpoints
  (saves 4+ failing requests per ticket open and removes the false "Could not load stock catalogue" error).
- Task templates now carry category, duration, state and private flag; solution templates carry the solution type.
- Template text is decoded properly (GLPI stores it HTML-escaped, so "&lt;p&gt;" no longer shows).
- Templates are cached for an hour (were downloaded on every ticket open).
- Assign to me: one small request instead of reloading the whole ticket (was 15–30 calls).
- Take photo (camera) added to attachments, using the Settings upload-quality.
- Dashboard and Equipment paint the last saved list instantly on cold start.

## 1.0.23 — Gapp-style features (medMETRIC branding)
- Assign to me (technician self-assign via Ticket_User)
- Task templates + Add task
- Solution templates + Post solution
- No third-party commercial logos

# medMETRIC CMMS 1.0.19 (includes 1.0.16–1.0.18 below)

## New in 1.0.19
- Requester-bridge.php can also mark a machine Down / Active (action=machine_status) — only for a requester of an
  open ticket that is linked to that exact machine. The app uses it automatically when the profile cannot edit assets
  (New ticket → Machine status, and the Down/Active switch on the ticket screen).
- Server setup notes: see server-push/README.md (GLPI profile right "Approve solution / Reply survey (my ticket)",
  life-cycle Solved→Closed, API client / service account).

# medMETRIC CMMS 1.0.18 (includes everything from 1.0.16 / 1.0.17 below)

## New in 1.0.18
- Your log (ticket 116) shows the Hospital Reporter profile is refused on EVERY REST route for approval:
  POST /ITILFollowup (followup right = read only), PUT /Ticket, PUT /ITILSolution → "no permission".
  The browser works because GLPI's web page has its own rule for requesters.
- Approve / Request more work now go through server-push/requester-bridge.php, which checks the caller is a
  requester of that Solved ticket and then does the approval with a service account (the follow-up it writes
  names the real requester). One file replaces my-devices.php (devices use the same file).
- If the helper is not installed, the error offers "Open in browser" (same approval as the web page).
- New ticket: the chosen device is sent with the ticket (items_id, like the helpdesk form) instead of a separate
  Item_Ticket call that requesters cannot make.
- Equipment: asset types the profile cannot read (403) are skipped for the session (no more 20+ failing calls).


## New in 1.0.17
- Equipment / "Select asset" for Requester (Hospital Reporter) accounts: when asset search is empty the app
  loads the user's linked devices ("My devices", like the browser's User devices list).
  REQUIRES server-push/requester-bridge.php on the GLPI server (see server-push/README.md).
  If it is not installed, the empty Equipment screen says so in its Details line.

# medMETRIC CMMS 1.0.16

## Fixes
- Server errors now show GLPI's real message ("HTTP 400: You don't have permission…") instead of "Request failed with status code 400".
- Network loss is detected separately ("No connection to the server").
- Approve / Refuse now use the same route as the browser box (follow-up with add_close / add_reopen), with the older calls as fallback.
- Approve solution no longer posts a fake "Requester approved" follow-up when GLPI refused it.
  Fewer retry loops. If approve still says "permission", send the browser request from DevTools
  (DevTools → Network) and put it in ACCEPT_ATTEMPTS in src/api/glpiClient.ts.
- Refuse solution only writes the reason after GLPI accepted the reopen.

## Performance
- Ticket detail: assignees, linked assets, documents and asset tickets are loaded in parallel (was one-by-one).
- User/group/location names are cached for the session.
- Last-known tickets and ticket details are saved on disk and shown instantly (stale-while-revalidate); cleared on sign-out.
- Ticket list: pages of 25/50/100 with "load more", memoized rows.
- Notes written offline are queued and sent automatically.
- Photo upload quality selectable (Low / Medium / High).

- Equipment list: itemtype names GLPI says do not exist are remembered and never probed again (your log showed 66 failing 1–6 s requests).

- Equipment: when empty, the screen now says why (AllAssets status and rows). My access rights lists every non-zero right.

## Settings (More tab)
- Connection test with latency, real app version.
- Auto-refresh on/off + interval, tickets per page, photo quality.
- Offline notes: send now / discard. Clear offline cache.
- Diagnostics: My access rights, Export request log (no passwords/tokens).
- Appearance is a collapsible dropdown (shows the current theme; tap to change).

No new npm packages. Run: npx expo start -c   (or a new EAS build).
