<?php
/**
 * medMETRIC CMMS — poll GLPI for new/updated tickets and push to phones
 *
 * Install:
 *   1) Copy this folder to the web server as /medmetric-push/
 *   2) Edit CONFIG below (GLPI URL, app token, API user)
 *   3) Cron every minute:
 *      * * * * * php /path/to/medmetric-push/poll.php >> /tmp/medmetric-push.log 2>&1
 *
 * How it works (same idea as WhatsApp server):
 *   - Reads last check time
 *   - Searches GLPI tickets modified since then
 *   - Sends Expo push to registered device tokens
 */
date_default_timezone_set('Africa/Addis_Ababa');

// ========== CONFIG — edit these ==========
$GLPI_URL = 'https://tech.medmetrichealthcare.com'; // no trailing slash
$GLPI_APP_TOKEN = 'PUT_YOUR_APP_TOKEN_HERE';
$GLPI_USER_TOKEN = ''; // optional: user token instead of login
$GLPI_API_LOGIN = 'glpi';       // service account with ticket read rights
$GLPI_API_PASSWORD = 'CHANGE_ME';
// ========================================

$dir = __DIR__ . '/data';
if (!is_dir($dir)) {
    mkdir($dir, 0755, true);
}
$devicesFile = $dir . '/devices.json';
$stateFile = $dir . '/poll_state.json';

$devices = is_file($devicesFile)
    ? (json_decode(file_get_contents($devicesFile), true) ?: [])
    : [];

if (!$devices) {
    echo date('c') . " no devices registered\n";
    exit(0);
}

$state = is_file($stateFile)
    ? (json_decode(file_get_contents($stateFile), true) ?: [])
    : [];
$since = isset($state['last_check'])
    ? $state['last_check']
    : date('Y-m-d H:i:s', time() - 300);

$now = date('Y-m-d H:i:s');

function glpiRequest($method, $path, $headers, $body = null) {
    global $GLPI_URL;
    $ch = curl_init(rtrim($GLPI_URL, '/') . '/apirest.php' . $path);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $res];
}

$baseHeaders = [
    'Content-Type: application/json',
    'App-Token: ' . $GLPI_APP_TOKEN,
];

// Session
if ($GLPI_USER_TOKEN) {
    $baseHeaders[] = 'Authorization: user_token ' . $GLPI_USER_TOKEN;
    list($code, $res) = glpiRequest('GET', '/initSession', $baseHeaders);
} else {
    $auth = base64_encode($GLPI_API_LOGIN . ':' . $GLPI_API_PASSWORD);
    $hdrs = array_merge($baseHeaders, ['Authorization: Basic ' . $auth]);
    list($code, $res) = glpiRequest('GET', '/initSession', $hdrs);
}

$session = json_decode($res, true);
$sessionToken = isset($session['session_token']) ? $session['session_token'] : '';
if (!$sessionToken) {
    echo date('c') . " initSession failed HTTP $code $res\n";
    exit(1);
}

$apiHeaders = array_merge($baseHeaders, ['Session-Token: ' . $sessionToken]);

// Search tickets updated since last check (field 19 = date_mod often)
$query = http_build_query([
    'range' => '0-50',
    'order' => 'DESC',
    'sort' => 19,
    'criteria' => [
        [
            'field' => 19, // date_mod
            'searchtype' => 'morethan',
            'value' => $since,
        ],
    ],
    'forcedisplay' => [1, 2, 12, 3, 19, 5],
]);

list($code, $res) = glpiRequest('GET', '/search/Ticket?' . $query, $apiHeaders);
$payload = json_decode($res, true);
$rows = [];
if (isset($payload['data']) && is_array($payload['data'])) {
    $rows = array_values($payload['data']);
}

$messages = [];
foreach ($rows as $r) {
    $id = isset($r['2']) ? (int)$r['2'] : (isset($r['id']) ? (int)$r['id'] : 0);
    $name = isset($r['1']) ? (string)$r['1'] : (isset($r['name']) ? (string)$r['name'] : 'Ticket');
    $status = isset($r['12']) ? (int)$r['12'] : 0;
    $priority = isset($r['3']) ? (int)$r['3'] : 3;
    if ($id <= 0) continue;
    $prioLabel = $priority >= 5 ? 'Very high' : ($priority >= 4 ? 'High' : 'Normal');
    $messages[] = [
        'title' => 'medMETRIC CMMS',
        'body' => "#$id · $name ($prioLabel)",
        'data' => [
            'type' => 'ticket',
            'screen' => 'tickets',
            'ticket_id' => $id,
            'priority' => $priority >= 4 ? 'urgent' : 'all',
        ],
    ];
}

// Kill session
glpiRequest('GET', '/killSession', $apiHeaders);

// Send via Expo Push API
$sent = 0;
if ($messages && $devices) {
    $tokens = array_keys($devices);
    // Expo accepts batches of notifications
    $batch = [];
    foreach ($messages as $msg) {
        foreach ($tokens as $tok) {
            $batch[] = [
                'to' => $tok,
                'title' => $msg['title'],
                'body' => $msg['body'],
                'sound' => 'default',
                'priority' => 'high',
                'channelId' => 'medmetric-alerts',
                'data' => $msg['data'],
            ];
        }
    }
    // chunk 100
    foreach (array_chunk($batch, 100) as $chunk) {
        $ch = curl_init('https://exp.host/--/api/v2/push/send');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'Accept: application/json',
        ]);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($chunk));
        $out = curl_exec($ch);
        $hc = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($hc >= 200 && $hc < 300) {
            $sent += count($chunk);
        } else {
            echo date('c') . " expo push HTTP $hc $out\n";
        }
    }
}

$state['last_check'] = $now;
$state['last_ticket_count'] = count($rows);
$state['last_sent'] = $sent;
file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT));

echo date('c') . " tickets=" . count($rows) . " pushes=$sent devices=" . count($devices) . "\n";
