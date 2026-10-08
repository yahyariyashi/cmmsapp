<?php
/**
 * medMETRIC CMMS — device registration for Expo push
 * Upload to: https://YOUR-SERVER/medmetric-push/register.php
 *
 * App POSTs: { "token": "ExponentPushToken[...]", "user_id": 12, "login": "odahulle" }
 */
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'POST only']);
    exit;
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON']);
    exit;
}

$token = isset($data['token']) ? trim((string)$data['token']) : '';
$userId = isset($data['user_id']) ? (int)$data['user_id'] : 0;
$login = isset($data['login']) ? trim((string)$data['login']) : '';
$platform = isset($data['platform']) ? trim((string)$data['platform']) : '';

if ($token === '' || strpos($token, 'ExponentPushToken') === false) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid Expo push token']);
    exit;
}

$dir = __DIR__ . '/data';
if (!is_dir($dir)) {
    mkdir($dir, 0755, true);
}
$file = $dir . '/devices.json';

$devices = [];
if (is_file($file)) {
    $devices = json_decode(file_get_contents($file), true) ?: [];
}

// One entry per token
$devices[$token] = [
    'token' => $token,
    'user_id' => $userId,
    'login' => $login,
    'platform' => $platform,
    'updated_at' => date('c'),
];

file_put_contents($file, json_encode($devices, JSON_PRETTY_PRINT));

echo json_encode(['ok' => true, 'count' => count($devices)]);
