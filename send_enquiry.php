<?php
// Nuttyment enquiry handler for GoDaddy PHP hosting.
// Sends the enquiry to the official Nuttyment email address.

$to = 'nuttymentfoods@gmail.com';

function clean($value) {
    return trim(strip_tags((string)$value));
}

$name = clean($_POST['name'] ?? '');
$company = clean($_POST['company'] ?? '');
$email = clean($_POST['email'] ?? '');
$phone = clean($_POST['phone'] ?? '');
$interest = clean($_POST['interest'] ?? '');
$flavour = clean($_POST['flavour'] ?? '');
$message = trim(strip_tags((string)($_POST['message'] ?? '')));

if ($name === '' || $email === '' || $phone === '' || $message === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enquiry</title><style>body{font-family:Arial;background:#fffaf0;color:#005331;text-align:center;padding:70px}.box{max-width:600px;margin:auto;background:#fff;padding:40px;border-radius:20px;box-shadow:0 10px 40px #0001}a{color:#005331;font-weight:bold}</style></head><body><div class="box"><h1>Please check your details</h1><p>Name, email, mobile and requirement are required.</p><a href="index.html#enquiry">Go back to enquiry form</a></div></body></html>';
    exit;
}

$subject = 'New Nuttyment Website Enquiry - ' . $name;
$body = "New enquiry received from the Nuttyment website\n\n";
$body .= "Name: {$name}\n";
$body .= "Company: {$company}\n";
$body .= "Email: {$email}\n";
$body .= "Mobile: {$phone}\n";
$body .= "Enquiry Type: {$interest}\n";
$body .= "Product / Flavour: {$flavour}\n\n";
$body .= "Requirement:\n{$message}\n";

$headers = [];
$headers[] = 'MIME-Version: 1.0';
$headers[] = 'Content-Type: text/plain; charset=UTF-8';
$headers[] = 'From: Nuttyment Website <nuttymentfoods@gmail.com>';
$headers[] = 'Reply-To: ' . $email;

$sent = mail($to, $subject, $body, implode("\r\n", $headers));

if ($sent) {
    echo '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enquiry Sent - Nuttyment</title><meta http-equiv="refresh" content="6;url=index.html"><style>body{font-family:Arial;background:#005331;color:white;text-align:center;padding:70px}.box{max-width:650px;margin:auto;background:#fff;color:#005331;padding:45px;border-radius:24px;box-shadow:0 20px 60px #0005}h1{font-size:42px;margin:0 0 12px}p{line-height:1.7;color:#555}a{display:inline-block;margin-top:18px;padding:13px 22px;border-radius:30px;background:#98ca5a;color:#005331;text-decoration:none;font-weight:bold}.whatsapp{background:#005331;color:white}</style></head><body><div class="box"><h1>Thank You!</h1><p>Your enquiry has been sent to Nuttyment Foods. Our team will contact you shortly.</p><a href="index.html">Back to Website</a><a class="whatsapp" href="https://wa.me/919921214272" target="_blank">Message on WhatsApp</a></div></body></html>';
} else {
    http_response_code(500);
    echo '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enquiry</title><style>body{font-family:Arial;background:#fffaf0;color:#005331;text-align:center;padding:70px}.box{max-width:600px;margin:auto;background:#fff;padding:40px;border-radius:20px;box-shadow:0 10px 40px #0001}a{display:inline-block;margin:8px;padding:12px 20px;border-radius:30px;background:#98ca5a;color:#005331;text-decoration:none;font-weight:bold}</style></head><body><div class="box"><h1>Email could not be sent</h1><p>Please use WhatsApp or call +91 99212 14272.</p><a href="https://wa.me/919921214272" target="_blank">WhatsApp</a><a href="tel:+919921214272">Call</a></div></body></html>';
}
?>
