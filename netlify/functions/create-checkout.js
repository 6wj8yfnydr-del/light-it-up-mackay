
const { randomUUID } = require('node:crypto');

exports.handler = async (event) => {
  const reply = (statusCode, data) => ({
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(data)
  });

  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed' });
  }

  try {
    const { name, phone, email, notes = '', balloons } =
      JSON.parse(event.body || '{}');

    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof phone !== 'string' ||
      !phone.trim() ||
      typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof notes !== 'string' ||
      !Array.isArray(balloons) ||
      balloons.length < 1 ||
      balloons.length > 20 ||
      balloons.some(
        b =>
          !b ||
          !['byo', 'supplied'].includes(b.type) ||
          typeof b.names !== 'string' ||
          !b.names.trim()
      )
    ) {
      return reply(400, {
        error: 'Please complete all required fields.'
      });
    }

    const token = process.env.SQUARE_ACCESS_TOKEN;
    const locationId = process.env.SQUARE_LOCATION_ID;

    if (!token || !locationId) {
      return reply(503, {
        error: 'Checkout is not configured.'
      });
    }

    const line_items = balloons.map((b) => ({
      name: b.type === 'byo'
        ? 'BYO Elf Balloon'
        : 'Elf Supplied Balloon',
      quantity: '1',
      base_price_money: {
        amount: b.type === 'byo' ? 6000 : 7000,
        currency: 'AUD'
      },
      note: `Personalised names: ${b.names.trim()}`
    }));

    const orderId = `ELF-${randomUUID().slice(0, 8)}`;

    const body = {
      idempotency_key: randomUUID(),
      order: {
        location_id: locationId,
        reference_id: orderId,
        line_items,
        metadata: {
          customer_name: name.trim().slice(0, 255),
          customer_phone: phone.trim().slice(0, 255),
          customer_email: email.trim().slice(0, 255),
          customer_notes:
            notes.trim().slice(0, 255) || 'No additional notes'
        }
      },
      checkout_options: {
        ask_for_shipping_address: false,
        merchant_support_email: 'lightitupmackay1@outlook.com'
      }
    };

    const response = await fetch(
      'https://connect.squareup.com/v2/online-checkout/payment-links',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Square-Version': '2025-10-16'
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();

    if (!response.ok || !data.payment_link?.url) {
      console.error(
        'Square checkout error',
        response.status,
        data
      );

      return reply(502, {
        error: 'Unable to create checkout. Please try again.'
      });
    }

    return reply(200, {
      url: data.payment_link.url
    });

  } catch (error) {
    console.error('Checkout error', error);

    return reply(500, {
      error: 'Checkout temporarily unavailable.'
    });
  }
};
