'use strict';

/*
 * Intégration Shopify.
 *
 * L'achat se fait sur la boutique Shopify de Ravive. À chaque commande payée,
 * Shopify appelle le webhook `orders/paid` de cette application :
 *   - chaque article correspondant à une formule crée un projet et envoie à
 *     l'acheteur son lien privé « Accéder à mon cadeau » ;
 *   - un article « places supplémentaires » augmente la capacité du projet
 *     désigné par l'attribut de panier `ravive_projet` (code de participation).
 *
 * Configuration dans l'admin Shopify : Paramètres > Notifications > Webhooks,
 * événement « Paiement de commande » (orders/paid), format JSON, URL
 * <BASE_URL>/api/shopify/webhook. Le secret affiché sous la liste des webhooks
 * va dans SHOPIFY_WEBHOOK_SECRET (.env).
 *
 * Chaque webhook est vérifié (HMAC SHA-256) et traité une seule fois
 * (X-Shopify-Webhook-Id mémorisé).
 */

const crypto = require('crypto');
const config = require('./config');
const store = require('./store');
const mailer = require('./mailer');

function verifySignature(rawBody, hmacHeader) {
  if (!config.SHOPIFY_WEBHOOK_SECRET || !hmacHeader) return false;
  const digest = crypto.createHmac('sha256', config.SHOPIFY_WEBHOOK_SECRET).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(String(hmacHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function attr(list, key) {
  if (!Array.isArray(list)) return null;
  const hit = list.find((a) => a && String(a.name || a.key || '').toLowerCase() === key);
  return hit ? String(hit.value || '') : null;
}

function isExtraSeatItem(item) {
  const variant = store.getSetting('extra_seat_shopify_variant_id', '');
  const sku = store.getSetting('extra_seat_shopify_sku', '');
  if (variant && String(item.variant_id) === String(variant)) return true;
  if (sku && item.sku && String(item.sku).toLowerCase() === String(sku).toLowerCase()) return true;
  return false;
}

/**
 * Traite une commande payée. Retourne un résumé (utilisé aussi par l'admin
 * pour rejouer une commande à la main).
 */
async function handlePaidOrder(order) {
  const email = String(order.email || (order.customer && order.customer.email) || '').trim().toLowerCase();
  const orderId = String(order.id);
  const orderNumber = order.name || (order.order_number != null ? `#${order.order_number}` : orderId);
  const customerName = [order.customer && order.customer.first_name].filter(Boolean).join(' ') || null;
  const summary = { orderId, orderNumber, created: [], extended: [], ignored: [] };

  // Commande déjà traitée (webhook rejoué ou relance manuelle) : on ne recrée rien
  const existing = store.getProjectByOrder(orderId);

  const projectCode = attr(order.note_attributes, 'ravive_projet') || attr(order.note_attributes, 'ravive_project');

  for (const item of order.line_items || []) {
    const qty = Math.max(1, Number(item.quantity) || 1);

    if (isExtraSeatItem(item)) {
      const code = (attr(item.properties, 'ravive_projet') || projectCode || '').trim().toLowerCase();
      const project = code ? store.getProjectBySlug(code) : null;
      if (!project) {
        summary.ignored.push({ item: item.title, reason: 'projet introuvable pour les places supplémentaires', code });
        continue;
      }
      store.addCapacity(project.id, qty);
      summary.extended.push({ project: project.slug, seats: qty });
      continue;
    }

    const formula = store.findFormulaForLineItem({ variantId: item.variant_id, sku: item.sku });
    if (!formula) {
      summary.ignored.push({ item: item.title, reason: 'aucune formule associée à cette variante / ce SKU', variantId: item.variant_id, sku: item.sku });
      continue;
    }
    if (existing.length > 0) {
      summary.ignored.push({ item: item.title, reason: 'commande déjà traitée' });
      continue;
    }
    if (!email) {
      summary.ignored.push({ item: item.title, reason: 'commande sans email' });
      continue;
    }
    for (let i = 0; i < qty; i++) {
      const { project, token } = store.createProject({
        organizerEmail: email,
        organizerName: customerName,
        formulaId: formula.id,
        capacity: formula.max_contributors,
        shopify: { orderId, orderNumber, customerEmail: email },
      });
      await mailer.projectAccess(project, token);
      summary.created.push({ project: project.slug, formula: formula.name });
    }
  }
  return summary;
}

/** URL du produit « places supplémentaires » pré-rempli avec le code projet. */
function extraSeatsUrl(project) {
  const variant = store.getSetting('extra_seat_shopify_variant_id', '');
  const shop = store.getSetting('shop_url', '') || (config.SHOPIFY_SHOP_DOMAIN ? `https://${config.SHOPIFY_SHOP_DOMAIN}` : '');
  if (!variant || !shop) return null;
  // Permalien panier : ajoute la variante et un attribut de panier lisible par le webhook
  return `${shop.replace(/\/$/, '')}/cart/${encodeURIComponent(variant)}:1?attributes[ravive_projet]=${encodeURIComponent(project.slug)}`;
}

module.exports = { verifySignature, handlePaidOrder, extraSeatsUrl };
