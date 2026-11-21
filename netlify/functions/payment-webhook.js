
const crypto = require('node:crypto');

const WEBHOOK_URL =
  'https://voluble-monstera-2321ac.netlify.app/.netlify/functions/payment-webhook';

const DESTINATION = 'lightitupmackay1@outlook.com';
const SQUARE_VERSION = '2025-10-16';

function reply(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, 'Method not allowed');
  }

  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const squareToken = process.env.SQUARE_ACCESS_TOKEN;
  const resendKey = process.env.RESEND_API_KEY;

  if (!signatureKey || !squareToken || !resendKey) {
    console.error('Missing webhook environment variables');
    return reply(503, 'Missing configuration');
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const signature = Object.entries(event.headers || {})
    .find(([key]) =>
      key.toLowerCase() === 'x-square-hmacsha256-signature'
    )?.[1] || '';

  const expected = crypto
    .createHmac('sha256', signatureKey)
    .update(WEBHOOK_URL + rawBody)
    .digest('base64');

  const supplied = Buffer.from(signature);
  const computed = Buffer.from(expected);

  if (
    supplied.length !== computed.length ||
    !crypto.timingSafeEqual(supplied, computed)
  ) {
    return reply(403, 'Invalid signature');
  }

  try {
    const notification = JSON.parse(rawBody);

    if (notification.type !== 'payment.updated') {
      return reply(200, 'Event ignored');
    }

    const payment = notification.data?.object?.payment;

    if (!payment || payment.status !== 'COMPLETED') {
      return reply(200, 'Payment not completed');
    }

    if (!payment.order_id) {
      console.log('Completed payment without order ID');
      return reply(200, 'No order ID');
    }

    const orderResponse = await fetch(
      `https://connect.squareup.com/v2/orders/${encodeURIComponent(payment.order_id)}`,
      {
        headers: {
          Authorization: `Bearer ${squareToken}`,
          'Square-Version': SQUARE_VERSION
        }
      }
    );

    if (!orderResponse.ok) {
      const errorBody = await orderResponse.text();

      console.error('Square order retrieval failed', {
        status: orderResponse.status,
        paymentId: payment.id,
        orderId: payment.order_id,
        details: errorBody.slice(0, 1000)
      });

      // Square test events may contain sample order IDs.
      // Do not treat an inaccessible order as a paid
      // customer order or send an incomplete email.
      if (orderResponse.status === 403 ||
          orderResponse.status === 404) {
        return reply(200, 'Order unavailable; check logs');
      }

      return reply(502, 'Square order retrieval failed');
    }

    const { order } = await orderResponse.json();

    if (!order) {
      throw new Error('Square order missing');
    }

    const metadata = order.metadata || {};

    const balloons = (order.line_items || [])
      .map((item, i) => {
        return [
          `Balloon ${i + 1}: ${item.name || 'Elf Balloon'}`,
          `Quantity: ${item.quantity || '1'}`,
          `Personalisation: ${item.note || 'Not supplied'}`
        ].join('\n');
      })
      .join('\n\n');

    const customerEmail =
      metadata.customer_email ||
      order.fulfillments?.[0]?.pickup_details?.recipient?.email_address ||
      payment.buyer_email_address ||
      'Not available';

    const content = [
      'LIGHT IT UP MACKAY',
      'PAID ELF BALLOON ORDER',
      '',
      `Order: ${order.reference_id || order.id}`,
      `Customer: ${metadata.customer_name || 'Not available'}`,
      `Phone: ${metadata.customer_phone || 'Not available'}`,
      `Email: ${customerEmail}`,
      `Collection: ${metadata.collection_date || '30 November 2026'}`,
      '',
      'BALLOON DETAILS',
      balloons || 'No balloon details available',
      '',
      'ADDITIONAL CUSTOMER INSTRUCTIONS',
      metadata.notes || 'None supplied',
      '',
      `Payment status: ${payment.status}`,
      `Payment ID: ${payment.id}`,
      '',
      'This notification was generated after Square reported a completed payment.'
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
          subject:
            `PAID Elf Balloon Order - ${order.reference_id || order.id}`,
          text: content
        })
      }
    );

    if (!emailResponse.ok) {
      console.error(
        'Resend email failed',
        emailResponse.status,
        await emailResponse.text()
      );
      return reply(502, 'Email delivery request failed');
    }

    console.log('Order email accepted by Resend', {
      paymentId: payment.id,
      orderId: order.id
    });

    return reply(200, 'Order notification submitted');

  } catch (error) {
    console.error('Webhook processing error', error.message);
    return reply(500, 'Processing failed');
  }
};
