'use strict';

/*
 * Lecture des gabarits de cadre (SVG fournis par Ravive).
 *
 * Convention : le SVG est en millimètres (viewBox 0 0 180 240 pour un cadre
 * 18x24 cm). Un emplacement photo est un <rect> ou un <path> dont l'id vaut
 * photo_01 / photo-01 / p1, ou qui porte la classe « slot ». La zone du petit
 * mot est un <rect id="text_zone"> (ou un <text class="note">).
 *
 * On n'utilise aucune dépendance : un petit parseur XML suffit pour extraire
 * les balises et leurs attributs, les emplacements sont ensuite normalisés en
 * boîtes {x, y, w, h} (mm) pour l'application. Le SVG original est conservé tel
 * quel pour l'affichage (aperçu de composition) et pour Ravive à l'impression.
 */

const SLOT_ID = /^(?:photo[_-]?(\d+)|p(\d+)|slot[_-]?(\d+))$/i;

function parseAttrs(tag) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[3] !== undefined ? m[3] : m[4];
  return attrs;
}

// Retourne la liste des balises (nom, attributs, texte pour <text>) du document
function listElements(svg) {
  const out = [];
  const re = /<(rect|path|text|svg|circle|ellipse|polygon|image)\b([^>]*?)(\/?)>/gi;
  let m;
  while ((m = re.exec(svg))) {
    const name = m[1].toLowerCase();
    const el = { name, attrs: parseAttrs(m[2]), index: m.index };
    if (name === 'text' && !m[3]) {
      const close = svg.indexOf('</text>', re.lastIndex);
      if (close > -1) el.text = svg.slice(re.lastIndex, close).replace(/<[^>]+>/g, '').trim();
    }
    out.push(el);
  }
  return out;
}

function num(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

// --- Boîte englobante d'un tracé SVG (M L H V C S Q T Z, absolus et relatifs) ---
function pathBBox(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  let i = 0;
  let cmd = '';
  let x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (px, py) => {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  };
  const next = () => num(tokens[i++]);
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let t = 0; t <= 1; t += 0.05) {
      const mt = 1 - t;
      add(
        mt * mt * mt * x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
        mt * mt * mt * y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3
      );
    }
    cx = x2; cy = y2; x = x3; y = y3;
  };
  const quad = (x1, y1, x2, y2) => {
    for (let t = 0; t <= 1; t += 0.05) {
      const mt = 1 - t;
      add(mt * mt * x + 2 * mt * t * x1 + t * t * x2, mt * mt * y + 2 * mt * t * y1 + t * t * y2);
    }
    cx = x1; cy = y1; x = x2; y = y2;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i++; if (/[zZ]/.test(cmd)) { x = sx; y = sy; continue; } }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': x = ox + next(); y = oy + next(); sx = x; sy = y; add(x, y); cmd = rel ? 'l' : 'L'; break;
      case 'L': x = ox + next(); y = oy + next(); add(x, y); break;
      case 'H': x = ox + next(); add(x, y); break;
      case 'V': y = oy + next(); add(x, y); break;
      case 'C': cubic(ox + next(), oy + next(), ox + next(), oy + next(), ox + next(), oy + next()); break;
      case 'S': { const x1 = 2 * x - cx, y1 = 2 * y - cy; cubic(x1, y1, ox + next(), oy + next(), ox + next(), oy + next()); break; }
      case 'Q': quad(ox + next(), oy + next(), ox + next(), oy + next()); break;
      case 'T': { const x1 = 2 * x - cx, y1 = 2 * y - cy; quad(x1, y1, ox + next(), oy + next()); break; }
      case 'A': { i += 5; x = ox + next(); y = oy + next(); add(x, y); break; }
      default: i++; // jeton inattendu : on avance pour ne jamais boucler
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function elementBox(el) {
  const a = el.attrs;
  if (el.name === 'rect') {
    return { x: num(a.x), y: num(a.y), w: num(a.width), h: num(a.height) };
  }
  if (el.name === 'path') return pathBBox(a.d || '');
  if (el.name === 'circle') {
    const r = num(a.r);
    return { x: num(a.cx) - r, y: num(a.cy) - r, w: 2 * r, h: 2 * r };
  }
  if (el.name === 'ellipse') {
    const rx = num(a.rx), ry = num(a.ry);
    return { x: num(a.cx) - rx, y: num(a.cy) - ry, w: 2 * rx, h: 2 * ry };
  }
  if (el.name === 'polygon') {
    const pts = (a.points || '').match(/-?\d*\.?\d+/g) || [];
    let box = null;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const px = num(pts[i]), py = num(pts[i + 1]);
      if (!box) box = { x: px, y: py, w: 0, h: 0 };
      else {
        const x2 = Math.max(box.x + box.w, px), y2 = Math.max(box.y + box.h, py);
        box.x = Math.min(box.x, px); box.y = Math.min(box.y, py);
        box.w = x2 - box.x; box.h = y2 - box.y;
      }
    }
    return box;
  }
  return null;
}

function round(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Analyse un SVG de gabarit.
 * @returns {{ widthMm, heightMm, viewBox, slots: [{i,id,x,y,w,h,shape}], textZone, hasText, title, warnings }}
 */
function parseTemplate(svg) {
  if (typeof svg !== 'string' || !/<svg[\s>]/i.test(svg)) {
    throw new Error('not_svg');
  }
  const els = listElements(svg);
  const root = els.find((e) => e.name === 'svg');
  if (!root) throw new Error('not_svg');

  const vb = (root.attrs.viewBox || '').split(/[\s,]+/).map(Number);
  const viewBox = vb.length === 4 && vb.every(Number.isFinite) ? vb : null;
  const mm = (v) => {
    const m = String(v || '').match(/^([\d.]+)\s*(mm|cm|px|in)?$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = m[2] || 'px';
    if (unit === 'mm') return n;
    if (unit === 'cm') return n * 10;
    if (unit === 'in') return n * 25.4;
    return n * 25.4 / 96; // px CSS
  };
  let widthMm = mm(root.attrs.width);
  let heightMm = mm(root.attrs.height);
  if (!widthMm && viewBox) widthMm = viewBox[2];
  if (!heightMm && viewBox) heightMm = viewBox[3];
  if (!viewBox && widthMm && heightMm) {
    // Sans viewBox on suppose des unités utilisateur = mm
  }
  const vbW = viewBox ? viewBox[2] : widthMm;
  const vbH = viewBox ? viewBox[3] : heightMm;
  const scaleX = widthMm && vbW ? widthMm / vbW : 1;
  const scaleY = heightMm && vbH ? heightMm / vbH : 1;
  const offX = viewBox ? viewBox[0] : 0;
  const offY = viewBox ? viewBox[1] : 0;

  const warnings = [];
  const slots = [];
  let textZone = null;
  let textNote = null;

  for (const el of els) {
    const id = el.attrs.id || '';
    const cls = (el.attrs.class || '').split(/\s+/);
    if (el.name === 'text') {
      if (id === 'text_zone' || id === 'text-zone' || cls.includes('note') || cls.includes('text-label')) {
        textNote = el;
      }
      continue;
    }
    if (id === 'text_zone' || id === 'text-zone' || cls.includes('text-zone')) {
      const b = elementBox(el);
      if (b) textZone = b;
      continue;
    }
    const m = SLOT_ID.exec(id);
    const isSlot = m || cls.includes('slot') || cls.includes('photo-slot');
    if (!isSlot) continue;
    // Le fond pleine page (rect 180x240 sans id) n'est jamais un emplacement
    const b = elementBox(el);
    if (!b || b.w <= 0 || b.h <= 0) {
      warnings.push(`emplacement ${id || '(sans id)'} ignoré : géométrie illisible`);
      continue;
    }
    if (el.attrs.transform) warnings.push(`emplacement ${id} : attribut transform ignoré`);
    const order = m ? Number(m[1] || m[2] || m[3]) : slots.length + 1;
    slots.push({ order, id: id || `slot_${slots.length + 1}`, box: b, shape: el.name });
  }

  if (slots.length === 0) throw new Error('no_slots');

  // Tri : par numéro d'id quand il existe, sinon ordre de lecture (haut→bas, gauche→droite)
  slots.sort((a, b) => a.order - b.order || a.box.y - b.box.y || a.box.x - b.box.x);

  const norm = (b) => ({
    x: round((b.x - offX) * scaleX),
    y: round((b.y - offY) * scaleY),
    w: round(b.w * scaleX),
    h: round(b.h * scaleY),
  });

  const out = slots.map((s, i) => ({ i: i + 1, id: s.id, shape: s.shape, ...norm(s.box) }));

  // Vérifications utiles à l'admin
  const seen = new Set();
  for (const s of out) {
    if (seen.has(s.id)) warnings.push(`id dupliqué : ${s.id}`);
    seen.add(s.id);
    const ratio = s.w / s.h;
    if (ratio < 0.8 || ratio > 1.25) {
      warnings.push(`emplacement ${s.i} (${s.id}) non carré : ${s.w}×${s.h} mm, la photo carrée sera rognée à l'impression`);
    }
  }

  let hasText = false;
  let tz = null;
  if (textZone) {
    hasText = true;
    tz = norm(textZone);
  } else if (textNote) {
    hasText = true;
    const a = textNote.attrs;
    const fs = num(a['font-size'], 7);
    tz = norm({ x: num(a.x) - vbW / 2, y: num(a.y) - fs, w: vbW, h: fs * 2 });
    tz.x = 0; tz.w = round(widthMm || vbW);
    warnings.push('zone texte déduite d’un élément <text> : position approximative');
  }

  const title = (els.find((e) => e.name === 'text' && false) || {}).text || null;
  const tm = svg.match(/<title[^>]*>([^<]*)<\/title>/i);

  return {
    widthMm: round(widthMm || vbW),
    heightMm: round(heightMm || vbH),
    viewBox: viewBox || [0, 0, widthMm, heightMm],
    slots: out,
    slotCount: out.length,
    hasText,
    textZone: tz,
    title: tm ? tm[1].trim() : title,
    warnings,
  };
}

/**
 * Nettoie un SVG avant stockage : retire scripts, gestionnaires d'événements,
 * références externes et métadonnées d'éditeur, pour pouvoir l'inliner sans risque.
 */
function sanitizeSvg(svg) {
  return String(svg)
    .replace(/<\?xml[^>]*\?>\s*/i, '')
    .replace(/<!DOCTYPE[^>]*>\s*/i, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<sodipodi:namedview[\s\S]*?(\/>|<\/sodipodi:namedview>)/gi, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/<image\b[^>]*>(?:<\/image>)?/gi, '')
    .trim();
}

/**
 * Génère le SVG d'aperçu : le gabarit avec les photos insérées dans leurs
 * emplacements (clip sur la forme d'origine). `fills` = { slotIndex: url }.
 * Le numéro d'emplacement est masqué quand une photo l'occupe.
 */
function renderPreview(svg, parsed, fills, opts = {}) {
  const els = listElements(svg);
  let out = svg;
  const inserts = [];
  const bySlot = new Map(parsed.slots.map((s) => [s.id, s]));
  const scaleX = parsed.viewBox[2] / parsed.widthMm;
  const scaleY = parsed.viewBox[3] / parsed.heightMm;
  const defs = [];
  for (const el of els) {
    const id = el.attrs.id;
    const s = id && bySlot.get(id);
    if (!s || !fills[s.i]) continue;
    // Clip = copie de la forme (rect/path) ; l'image couvre la boîte (cover)
    const raw = svg.slice(el.index, svg.indexOf('>', el.index) + 1).replace(/\/?>$/, '/>');
    const shape = raw.replace(/\sid="[^"]*"/, '').replace(/\sclass="[^"]*"/, '').replace(/\sstyle="[^"]*"/, '');
    defs.push(`<clipPath id="clip_${s.id}">${shape}</clipPath>`);
    const x = s.x * scaleX + parsed.viewBox[0], y = s.y * scaleY + parsed.viewBox[1];
    const w = s.w * scaleX, h = s.h * scaleY;
    inserts.push(
      `<image clip-path="url(#clip_${s.id})" href="${escapeAttr(fills[s.i])}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
    );
  }
  let extra = '';
  if (opts.text && parsed.textZone) {
    const tz = parsed.textZone;
    const x = (tz.x + tz.w / 2) * scaleX + parsed.viewBox[0];
    const y = (tz.y + tz.h / 2) * scaleY + parsed.viewBox[1];
    extra = `<rect x="${tz.x * scaleX}" y="${tz.y * scaleY}" width="${tz.w * scaleX}" height="${tz.h * scaleY}" fill="#f7f1e8"/>` +
      `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-family="Georgia,serif" font-size="${Math.min(7, tz.h / 3)}" fill="#6b5140">${escapeText(opts.text)}</text>`;
  }
  const payload = `<defs>${defs.join('')}</defs>${inserts.join('')}${extra}`;
  const close = out.lastIndexOf('</svg>');
  out = close > -1 ? out.slice(0, close) + payload + out.slice(close) : out + payload;
  return out;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { parseTemplate, sanitizeSvg, renderPreview, pathBBox };
