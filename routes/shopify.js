'use strict';

/* Webhook Shopify : commandes payées → projets. */

const express = require('express');
const store = require('../src/store');
const shopify = require('../src/shopify');
const config = require('../src/config');

const router = express.Router();

router.post('/api/shopify/webhook', express.raw({ type: () => true, limit: '2mb' }), async (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const topic = String(req.headers['x-shopify-topic'] || '');
  const eventId = String(req.headers['x-shopify-webhook-id'] || '');
  const shop = String(req.headers['x-shopify-shop-domain'] || '');

  if (!config.SHOPIFY_WEBHOOK_SECRET) {
    console.error('webhook Shopify reçu mais SHOPIFY_WEBHOOK_SECRET absent');
    return res.status(503).json({ error: 'webhook_not_configured' });
  }
  if (!Buffer.isBuffer(req.body) || !shopify.verifySignature(req.body, hmac)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  if (config.SHOPIFY_SHOP_DOMAIN && shop && shop !== config.SHOPIFY_SHOP_DOMAIN) {
    return res.status(401).json({ error: 'wrong_shop' });
  }

  let order;
  try {
    order = JSON.parse(req.body.toString('utf8'));
  } catch (_) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  // Shopify réessaie tant qu'il n'a pas reçu 200 : on répond vite, on traite ensuite,
  // et on ignore les livraisons en double grâce à l'identifiant du webhook.
  if (eventId && !store.recordShopifyEvent(eventId, topic, order && order.id != null ? String(order.id) : null)) {
    return res.json({ ok: true, duplicate: true });
  }
  res.json({ ok: true });

  if (!['orders/paid', 'orders/create', 'orders/updated'].includes(topic)) {
    if (eventId) store.setShopifyEventResult(eventId, `ignoré (${topic})`);
    return;
  }
  // orders/create ou orders/updated ne créent un projet que si la commande est payée
  if (topic !== 'orders/paid' && order.financial_status !== 'paid') {
    if (eventId) store.setShopifyEventResult(eventId, `ignoré (${topic}, ${order.financial_status})`);
    return;
  }
  try {
    const summary = await shopify.handlePaidOrder(order);
    console.log(`[shopify] commande ${summary.orderNumber} : ${summary.created.length} projet(s), ${summary.extended.length} extension(s), ${summary.ignored.length} article(s) ignoré(s)`);
    if (eventId) store.setShopifyEventResult(eventId, JSON.stringify(summary));
  } catch (err) {
    console.error('[shopify] traitement de commande échoué :', err);
    if (eventId) store.setShopifyEventResult(eventId, `erreur : ${err.message}`);
  }
});

module.exports = router;
