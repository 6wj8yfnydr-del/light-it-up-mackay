
const crypto = require('node:crypto');

const WEBHOOK_URL = 'https://voluble-monstera-2321ac.netlify.app/.netlify/functions/payment-webhook';
const DESTINATION = 'lightitupmackay1@outlook.com';
const SQUARE_VERSION = '2025-10-16';

const response = (statusCode, message) => ({
  statusCode,
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({message})
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return response(405, 'Method not allowed');

  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const squareToken = process.env.SQUARE_ACCESS_TOKEN;
  const resendKey = process.env.RESEND_API_KEY;

  if (!signatureKey || !squareToken || !resendKey)
    return response(503, 'Missing configuration');

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const signature =
    event.headers?.['x-square-hmacsha256-signature'] ||
    event.headers?.['X-Square-HmacSha256-Signature'] ||
    '';

  const expected = crypto
    .createHmac('sha256', signatureKey)
    .update(WEBHOOK_URL + rawBody)
    .digest('base64');

  const supplied = Buffer.from(signature);
  const computed = Buffer.from(expected);

  if (
    supplied.length !== computed.length ||
    !crypto.timingSafeEqual(supplied, computed)
  ) return response(403, 'Invalid signature');

  try {
    const notification = JSON.parse(rawBody);

    if (notification.type !== 'payment.updated')
      return response(200, 'Ignored');

    const payment = notification.data?.object?.payment;

    if (
      !payment ||
      payment.status !== 'COMPLETED' ||
      !payment.order_id
    ) return response(200, 'Ignored');

    const squareResponse = await fetch(
      `https://connect.squareup.com/v2/orders/${encodeURIComponent(payment.order_id)}`,
      {
        headers: {
          Authorization: `Bearer ${squareToken}`,
          'Square-Version': SQUARE_VERSION
        }
      }
    );

    if (!squareResponse.ok)
      throw new Error(`Square order fetch failed: ${squareResponse.status}`);

    const {order} = await squareResponse.json();

    if (!order) throw new Error('Square order missing');

    const metadata = order.metadata || {};

    const balloons = (order.line_items || [])
      .map((item, i) => [
        `Balloon ${i + 1}: ${item.name || 'Elf Balloon'} x ${item.quantity || '1'}`,
        item.note || 'No personalisation supplied'
      ].join('\n'))
      .join('\n\n');

    const customerEmail =
      metadata.customer_email ||
      order.fulfillments?.[0]?.pickup_details?.recipient?.email_address ||
      payment.buyer_email_address ||
      'Not available';

    const notes =
      metadata.notes ||
      'See balloon notes above (if supplied)';

    const content = [
      'PAID ELF BALLOON ORDER',
      '',
      `Order: ${order.reference_id || order.id}`,
      `Customer: ${metadata.customer_name || 'Not available'}`,
      `Phone: ${metadata.customer_phone || 'Not available'}`,
      `Email: ${customerEmail}`,
      `Collection: ${metadata.collection_date || '30 November 2026'}`,
      '',
      'BALLOONS:',
      balloons || 'No balloon details available',
      '',
      `ADDITIONAL NOTES: ${notes}`,
      '',
      `Payment status: ${payment.status}`,
      `Payment ID: ${payment.id}`
    ].join('\n');

    const emailResponse = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `elf-order-${payment.id}`
        },
        body: JSON.stringify({
          from: 'Light It Up Mackay <onboarding@resend.dev>',
          to: [DESTINATION],
          subject: `PAID Elf Balloon Order - ${order.reference_id || order.id}`,
          text: content
        })
      }
    );

    if (!emailResponse.ok) {
      console.error(
        'Resend request failed',
        emailResponse.status,
        await emailResponse.text()
      );
      throw new Error('Email request failed');
    }

    return response(200, 'Processed');

  } catch (error) {
    console.error('Webhook processing error', error.message);
    return response(500, 'Processing failed');
  }
};
