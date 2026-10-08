<?php
/**
 * medMETRIC CMMS — Requester bridge  (one file, replaces my-devices.php)
 *
 * Hospital "Requester / Reporter" profiles cannot do three things through GLPI's REST API
 * that they CAN do in the browser:
 *   1) list "My devices" (machines linked to them)           → action=devices   (GET)
 *   2) Approve / Refuse the solution of their own ticket     → action=approve|refuse (POST)
 *   3) Mark a linked machine Down / Active from their ticket → action=machine_status (POST)
 *
 * This script does them with a service account, but ONLY after checking:
 *   - the caller's own GLPI session token is valid (asked to GLPI itself)
 *   - devices: only that user's (and their groups') devices are returned
 *   - approve/refuse: the caller is a REQUESTER of that ticket and the ticket is "Solved"
 *
 * Install: upload next to register.php →  https://YOUR-GLPI/medmetric-push/requester-bridge.php
 *   1) Edit CONFIG (same API URL / app token / service login as poll.php)
 *   2) Service account needs: read on assets, update on tickets / solutions, add followups
 *   3) Test devices:  .../requester-bridge.php?action=devices&debug=1&session_token=<token>
 */
date_default_timezone_set('Africa/Addis_Ababa');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

// ========== CONFIG — edit these ==========
// The URL the app uses + /apirest.php   (e.g. https://tech.medmetrichealthcare.com/public/apirest.php)
$GLPI_API_URL    = 'https://tech.medmetrichealthcare.com/apirest.php';
$GLPI_APP_TOKEN  = 'PUT_YOUR_APP_TOKEN_HERE';
$GLPI_USER_TOKEN = '';            // optional: service user token instead of login
$GLPI_API_LOGIN  = 'glpi';        // service account
$GLPI_API_PASSWORD = 'CHANGE_ME';
// ========================================

function out($code, $arr) {
    http_response_code($code);
    echo json_encode($arr, JSON_UNESCAPED_UNICODE);
    exit;
}

function api($method, $path, $headers, $query = null, $body = null) {
    global $GLPI_API_URL;
    $url = rtrim($GLPI_API_URL, '/') . $path;
    if ($query) $url .= '?' . http_build_query($query);
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode((string)$res, true)];
}

// ---- input (JSON body, form, or query) ----
$raw = file_get_contents('php://input');
$in = $raw ? (json_decode($raw, true) ?: []) : [];
function param($k, $default = '') {
    global $in;
    if (isset($in[$k])) return $in[$k];
    if (isset($_POST[$k])) return $_POST[$k];
    if (isset($_GET[$k])) return $_GET[$k];
    return $default;
}
$action = (string)param('action', 'devices');
$debug = isset($_GET['debug']);

// ---- 1) who is calling? ask GLPI itself, never trust an id sent by the client ----
$callerToken = isset($_SERVER['HTTP_SESSION_TOKEN']) ? $_SERVER['HTTP_SESSION_TOKEN'] : (string)param('session_token', '');
if ($callerToken === '') out(401, ['ok' => false, 'error' => 'Missing session token']);

$base = ['Content-Type: application/json', 'App-Token: ' . $GLPI_APP_TOKEN];
list($c, $sess) = api('GET', '/getFullSession', array_merge($base, ['Session-Token: ' . $callerToken]));
if ($c !== 200 || empty($sess['session']['glpiID'])) out(401, ['ok' => false, 'error' => 'Invalid or expired session']);
$uid = (int)$sess['session']['glpiID'];
$who = !empty($sess['session']['glpifriendlyname']) ? $sess['session']['glpifriendlyname']
     : (!empty($sess['session']['glpiname']) ? $sess['session']['glpiname'] : ('user ' . $uid));
$groups = [];
if (!empty($sess['session']['glpigroups']) && is_array($sess['session']['glpigroups'])) {
    foreach ($sess['session']['glpigroups'] as $g) $groups[] = (int)$g;
}

// ---- 2) service session ----
if ($GLPI_USER_TOKEN !== '') {
    $hdr = array_merge($base, ['Authorization: user_token ' . $GLPI_USER_TOKEN]);
} else {
    $hdr = array_merge($base, ['Authorization: Basic ' . base64_encode($GLPI_API_LOGIN . ':' . $GLPI_API_PASSWORD)]);
}
list($c, $init) = api('GET', '/initSession', $hdr);
if ($c !== 200 || empty($init['session_token'])) out(502, ['ok' => false, 'error' => 'Service account login failed (check CONFIG)']);
$svc = array_merge($base, ['Session-Token: ' . $init['session_token']]);

function finish($code, $arr) {
    global $svc;
    api('GET', '/killSession', $svc);
    out($code, $arr);
}

// =====================================================================
// action=devices
// =====================================================================
if ($action === 'devices') {
    $userField = 70;
    $groupField = 71;
    list($c, $opts) = api('GET', '/listSearchOptions/AllAssets', $svc);
    if ($c === 200 && is_array($opts)) {
        foreach ($opts as $id => $o) {
            if (!is_array($o) || !isset($o['name']) || !is_numeric($id)) continue;
            if ($o['name'] === 'User') $userField = (int)$id;
            if ($o['name'] === 'Group') $groupField = (int)$id;
        }
    }
    $criteria = [['field' => $userField, 'searchtype' => 'equals', 'value' => $uid]];
    foreach (array_slice(array_unique($groups), 0, 20) as $g) {
        $criteria[] = ['link' => 'OR', 'field' => $groupField, 'searchtype' => 'equals', 'value' => $g];
    }
    list($c, $res) = api('GET', '/search/AllAssets', $svc, [
        'range' => '0-199',
        'expand_dropdowns' => 'true',
        'criteria' => $criteria,
        'forcedisplay' => [1, 2, 3, 4, 5, 6, 31, 80],
    ]);
    $devices = [];
    if ($c < 400 && isset($res['data']) && is_array($res['data'])) {
        foreach ($res['data'] as $r) {
            if (!is_array($r)) continue;
            $id = isset($r['2']) ? (int)$r['2'] : (isset($r['id']) ? (int)$r['id'] : 0);
            $itemtype = isset($r['itemtype']) ? (string)$r['itemtype'] : '';
            if ($id <= 0 || $itemtype === '') continue;
            $devices[] = [
                'itemtype' => $itemtype, 'id' => $id,
                'name' => isset($r['1']) ? (string)$r['1'] : ('#' . $id),
                'serial' => isset($r['5']) ? (string)$r['5'] : '',
                'otherserial' => isset($r['6']) ? (string)$r['6'] : '',
                'location' => isset($r['3']) ? (string)$r['3'] : '',
                'status' => isset($r['31']) ? (string)$r['31'] : '',
                'entity' => isset($r['80']) ? (string)$r['80'] : '',
            ];
        }
    }
    $body = ['ok' => true, 'count' => count($devices), 'devices' => $devices];
    if ($debug) {
        $body['debug'] = ['user_id' => $uid, 'groups' => $groups, 'user_field' => $userField,
            'group_field' => $groupField, 'search_http' => $c, 'search_error' => ($c >= 400 ? $res : null)];
    }
    finish(200, $body);
}

// =====================================================================
// action=approve | refuse
// =====================================================================
if ($action === 'approve' || $action === 'refuse') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') finish(405, ['ok' => false, 'error' => 'Use POST']);
    $tid = (int)param('ticket_id', 0);
    if ($tid <= 0) finish(400, ['ok' => false, 'error' => 'ticket_id required']);
    $comment = trim((string)param('comment', ''));
    if (strlen($comment) > 1000) $comment = substr($comment, 0, 1000);
    $safeComment = htmlspecialchars($comment, ENT_QUOTES, 'UTF-8');
    $safeWho = htmlspecialchars((string)$who, ENT_QUOTES, 'UTF-8');

    // ticket must exist and be waiting for approval (Solved = 5)
    list($c, $t) = api('GET', "/Ticket/$tid", $svc);
    if ($c !== 200 || !is_array($t)) finish(404, ['ok' => false, 'error' => 'Ticket not found']);
    if ((int)$t['status'] !== 5) finish(409, ['ok' => false, 'error' => 'This ticket is not waiting for approval']);

    // caller must be a REQUESTER (type 1) of this ticket
    list($c, $tu) = api('GET', "/Ticket/$tid/Ticket_User", $svc);
    $isRequester = false;
    if ($c === 200 && is_array($tu)) {
        foreach ($tu as $row) {
            if (is_array($row) && (int)$row['type'] === 1 && (int)$row['users_id'] === $uid) $isRequester = true;
        }
    }
    if (!$isRequester) finish(403, ['ok' => false, 'error' => 'Only a requester of this ticket can approve or refuse its solution']);

    if ($action === 'refuse' && $comment === '') $comment = 'Solution refused by the requester.';
    $safeComment = htmlspecialchars($comment, ENT_QUOTES, 'UTF-8');

    // latest solution record (may not exist if the technician only set status Solved)
    $solId = 0;
    list($c, $sols) = api('GET', "/Ticket/$tid/ITILSolution", $svc);
    if ($c === 200 && is_array($sols)) {
        foreach ($sols as $s) if (is_array($s) && (int)$s['id'] > $solId) $solId = (int)$s['id'];
    }
    $steps = [];

    if ($action === 'approve') {
        if ($solId) {
            list($c, $r) = api('PUT', "/ITILSolution/$solId", $svc, null, ['input' => ['status' => 3]]);
            $steps[] = "solution accepted: HTTP $c";
        }
        list($c, $t2) = api('GET', "/Ticket/$tid", $svc);
        if (!is_array($t2) || (int)$t2['status'] !== 6) {
            list($c, $r) = api('PUT', "/Ticket/$tid", $svc, null, ['input' => ['status' => 6]]);
            $steps[] = "ticket closed: HTTP $c";
        }
        $text = "Solution approved by $safeWho (mobile app)." . ($safeComment !== '' ? "<p>$safeComment</p>" : '');
    } else {
        if ($solId) {
            list($c, $r) = api('PUT', "/ITILSolution/$solId", $svc, null, ['input' => ['status' => 4]]);
            $steps[] = "solution refused: HTTP $c";
        }
        list($c, $t2) = api('GET', "/Ticket/$tid", $svc);
        if (is_array($t2) && in_array((int)$t2['status'], [5, 6], true)) {
            list($c, $r) = api('PUT', "/Ticket/$tid", $svc, null, ['input' => ['status' => 2]]);
            $steps[] = "ticket reopened: HTTP $c";
        }
        $text = "Solution refused by $safeWho (mobile app).<p>$safeComment</p>";
    }

    // audit trail (author is the service account, the text names the real requester)
    list($c, $r) = api('POST', '/ITILFollowup', $svc, null, ['input' => [
        'itemtype' => 'Ticket', 'items_id' => $tid, 'content' => $text, 'is_private' => 0,
    ]]);
    $steps[] = "followup: HTTP $c";

    list($c, $t3) = api('GET', "/Ticket/$tid", $svc);
    $status = is_array($t3) ? (int)$t3['status'] : 0;
    $okState = ($action === 'approve') ? ($status === 6) : ($status !== 5 && $status !== 6 && $status !== 0);
    $body = ['ok' => $okState, 'action' => $action, 'status' => $status, 'closed' => ($status === 6)];
    if (!$okState) $body['error'] = 'GLPI did not change the ticket state (service account rights?)';
    if ($debug) $body['debug'] = $steps;
    finish($okState ? 200 : 502, $body);
}

// =====================================================================
// action=machine_status   (mark a machine Down / Active from a ticket the caller requested)
// =====================================================================
if ($action === 'machine_status') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') finish(405, ['ok' => false, 'error' => 'Use POST']);
    $tid = (int)param('ticket_id', 0);
    $itemtype = (string)param('itemtype', '');
    $itemId = (int)param('items_id', 0);
    $mode = strtolower((string)param('mode', ''));
    if ($tid <= 0 || $itemId <= 0 || !preg_match('/^[A-Za-z0-9_\\\\]+$/', $itemtype) || !in_array($mode, ['down', 'active'], true)) {
        finish(400, ['ok' => false, 'error' => 'ticket_id, itemtype, items_id and mode (down|active) required']);
    }

    // caller must be a requester of an OPEN ticket that is linked to this exact machine
    list($c, $t) = api('GET', "/Ticket/$tid", $svc);
    if ($c !== 200 || !is_array($t)) finish(404, ['ok' => false, 'error' => 'Ticket not found']);
    if ((int)$t['status'] === 6) finish(409, ['ok' => false, 'error' => 'Ticket is closed']);
    list($c, $tu) = api('GET', "/Ticket/$tid/Ticket_User", $svc);
    $isRequester = false;
    if ($c === 200 && is_array($tu)) {
        foreach ($tu as $row) {
            if (is_array($row) && (int)$row['type'] === 1 && (int)$row['users_id'] === $uid) $isRequester = true;
        }
    }
    if (!$isRequester) finish(403, ['ok' => false, 'error' => 'Only a requester of this ticket can change the machine status']);
    list($c, $links) = api('GET', "/Ticket/$tid/Item_Ticket", $svc);
    $linked = false;
    if ($c === 200 && is_array($links)) {
        foreach ($links as $l) {
            if (is_array($l) && (string)$l['itemtype'] === $itemtype && (int)$l['items_id'] === $itemId) $linked = true;
        }
    }
    if (!$linked) finish(403, ['ok' => false, 'error' => 'This machine is not linked to that ticket']);

    // find the state id by name
    list($c, $states) = api('GET', '/State', $svc, ['range' => '0-200']);
    $stateId = 0;
    if ($c < 400 && is_array($states)) {
        $exact = $mode === 'down' ? '/^down$/i' : '/^active$/i';
        $loose = $mode === 'down' ? '/down|out of service|broken/i' : '/active|in use|operational|working/i';
        foreach ($states as $st) {
            if (is_array($st) && isset($st['name']) && preg_match($exact, $st['name'])) { $stateId = (int)$st['id']; break; }
        }
        if (!$stateId) {
            foreach ($states as $st) {
                if (is_array($st) && isset($st['name']) && preg_match($loose, $st['name'])) { $stateId = (int)$st['id']; break; }
            }
        }
    }
    if (!$stateId) finish(404, ['ok' => false, 'error' => 'No status named ' . ($mode === 'down' ? 'Down' : 'Active') . ' found in GLPI (Setup > Dropdowns > Status of items)']);

    list($c, $r) = api('PUT', '/' . rawurlencode($itemtype) . '/' . $itemId, $svc, null, ['input' => ['states_id' => $stateId]]);
    $ok = $c < 400;
    finish($ok ? 200 : 502, ['ok' => $ok, 'state_id' => $stateId, 'error' => $ok ? null : 'GLPI refused the status change (service account rights?)']);
}

finish(400, ['ok' => false, 'error' => 'Unknown action']);
