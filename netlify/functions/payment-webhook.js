
const crypto = require('node:crypto');

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed' });
  }

  try {
    const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    const token = process.env.SQUARE_ACCESS_TOKEN;
    const emailKey = process.env.RESEND_API_KEY;
    const url =
      'https://voluble-monstera-2321ac.netlify.app/.netlify/functions/payment-webhook';

    if (!key || !token || !emailKey) {
      return reply(503, { error: 'Configuration missing' });
    }

    const signature =
      event.headers['x-square-hmacsha256-signature'] ||
      event.headers['X-Square-HmacSha256-Signature'];

    const body = event.body || '';
    const expected = crypto
      .createHmac('sha256', key)
      .update(url + body)
      .digest('base64');

    const a = Buffer.from(signature || '');
    const b = Buffer.from(expected);

    if (a.length !== b.length ||
        !crypto.timingSafeEqual(a, b)) {
      return reply(403, { error: 'Invalid signature' });
    }

    const notification = JSON.parse(body);

    if (notification.type !== 'payment.updated') {
      return reply(200, { received: true });
    }

    const payment = notification.data?.object?.payment;

    if (payment?.status !== 'COMPLETED' || !payment.order_id) {
      return reply(200, { received: true });
    }

    const orderResponse = await fetch(
      `https://connect.squareup.com/v2/orders/${encodeURIComponent(payment.order_id)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Square-Version': '2025-10-16'
        }
      }
    );

    if (!orderResponse.ok) {
      throw new Error('Could not retrieve Square order');
    }

    const { order } = await orderResponse.json();
    const meta = order.metadata || {};

    const items = (order.line_items || []).map(item =>
      `${item.name} x ${item.quantity}\n${item.note || ''}`
    ).join('\n\n');

    const message = [
      'PAID ELF BALLOON ORDER',
      '',
      `Order: ${order.reference_id || order.id}`,
      `Customer: ${meta.customer_name || 'Not provided'}`,
      `Phone: ${meta.customer_phone || 'Not provided'}`,
      `Email: ${meta.customer_email || 'Not provided'}`,
      `Collection: ${meta.collection_date || '30 November 2026'}`,
      '',
      'BALLOONS:',
      items,
      '',
      `SPECIAL REQUESTS: ${meta.notes || 'None'}`,
      '',
      `Payment: ${payment.status}`,
      `Square payment ID: ${payment.id}`
    ].join('\n');

    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${emailKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Light It Up Mackay <onboarding@resend.dev>',
        to: ['lightitupmackay1@outlook.com'],
        subject: `PAID Elf Balloon Order - ${order.reference_id || order.id}`,
        text: message
      })
    });

    if (!result.ok) {
      throw new Error('Email delivery request failed');
    }

    return reply(200, { received: true });

  } catch (error) {
    console.error('Webhook processing error:', error.message);
    return reply(500, { error: 'Processing failed' });
  }
};
