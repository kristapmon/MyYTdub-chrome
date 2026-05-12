<?php
// Mints an ephemeral client_secret for OpenAI Realtime translations.
// Reads the API key from `.openai-key` (sibling file). Forwards the OpenAI
// response verbatim so the frontend can pick the secret out.

header('Content-Type: application/json');
header('Cache-Control: no-store');

$keyFile = __DIR__ . '/.openai-key';
if (!is_file($keyFile)) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Missing scratch/.openai-key. Create that file (one line, your sk-... key, no quotes).'
    ]);
    exit;
}

$apiKey = trim(file_get_contents($keyFile));
if ($apiKey === '') {
    http_response_code(500);
    echo json_encode(['error' => 'scratch/.openai-key is empty.']);
    exit;
}

$body = json_encode([
    'session' => [
        'model' => 'gpt-realtime-translate',
    ],
]);

$ch = curl_init('https://api.openai.com/v1/realtime/translations/client_secrets');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $body,
    CURLOPT_HTTPHEADER     => [
        'Authorization: Bearer ' . $apiKey,
        'Content-Type: application/json',
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
]);
$response = curl_exec($ch);
$status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err      = curl_error($ch);
curl_close($ch);

if ($err) {
    http_response_code(502);
    echo json_encode(['error' => 'curl: ' . $err]);
    exit;
}

http_response_code($status ?: 502);
echo $response;
