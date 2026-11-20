const { randomUUID } = require('node:crypto');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return {statusCode:405,body:'Method not allowed'};
  const reply=(code,obj)=>({statusCode:code,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(obj)});
  try {
    const {name,phone,email,notes='',balloons}=JSON.parse(event.body||'{}');
    if(typeof name!=='string'||!name.trim()||name.length>120||typeof phone!=='string'||!/^[-+() 0-9]{8,25}$/.test(phone)||typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof notes!=='string'||notes.length>500||!Array.isArray(balloons)||balloons.length<1||balloons.length>20||balloons.some(b=>!b||!['byo','supplied'].includes(b.type)||typeof b.names!=='string'||!b.names.trim()||b.names.length>120))return reply(400,{error:'Please check your contact details and balloon selections.'});
    const token=process.env.SQUARE_ACCESS_TOKEN, locationId=process.env.SQUARE_LOCATION_ID;
    if(!token||!locationId)return reply(503,{error:'Online checkout is being configured. Please try again later.'});
    const line_items=balloons.map((b,i)=>({name:b.type==='byo'?'BYO Elf Balloon':'Elf Supplied Balloon',quantity:'1',base_price_money:{amount:b.type==='byo'?6000:7000,currency:'AUD'},note:`Balloon ${i+1}: ${b.names.trim()}`}));
    const body={idempotency_key:randomUUID(),order:{location_id:locationId,line_items,reference_id:`ELF-${randomUUID().slice(0,8).toUpperCase()}`,metadata:{customer_name:name.trim(),customer_phone:phone.trim(),customer_email:email.trim(),notes:notes.trim().slice(0,500),collection_date:'2026-11-30'}},checkout_options:{redirect_url:'https://voluble-monstera-2321ac.netlify.app/thank-you.html',ask_for_shipping_address:false},pre_populated_data:{buyer_email:email.trim()}};
    const r=await fetch('https://connect.squareup.com/v2/online-checkout/payment-links',{method:'POST',headers:{'Square-Version':'2025-10-16','Authorization':`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await r.json();if(!r.ok||!data.payment_link?.url){console.error('Square checkout error',r.status,JSON.stringify(data.errors||[]));return reply(502,{error:'Unable to start Square checkout. Please contact Light It Up Mackay.'})}
    return reply(200,{url:data.payment_link.url});
  }catch(err){console.error('Checkout error',err.message);return reply(500,{error:'Checkout temporarily unavailable.'})}
};
