'use strict';

/*
 * Composition finale du cadre pour l'impression.
 *
 * L'aperçu de l'admin (renderPreview) place les photos carrées dans les
 * emplacements du gabarit en pointant vers des URL. Ici on produit la même
 * composition mais autonome : les photos sont incorporées dans le SVG
 * (data URI, pleine résolution du recadrage carré, 1200 px) et on en tire un
 * PNG à 300 dpi aux dimensions réelles du cadre. Les deux vont dans l'export
 * ZIP, dossier « cadre », prêts à transmettre au fabricant.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('./config');
const { renderPreview } = require('./templates');

const PRINT_DPI = 300;

function mmToPx(mm, dpi = PRINT_DPI) {
  return Math.round((mm / 25.4) * dpi);
}

// SVG autonome : gabarit + photos incorporées + petit mot
function composeSvg(project, template, photos) {
  const svg = fs.readFileSync(path.join(config.TEMPLATES_DIR, template.file), 'utf8');
  const fills = {};
  for (const ph of photos) {
    if (!ph.slot) continue;
    const file = path.join(config.PHOTO_DIR, ph.file_square);
    if (!fs.existsSync(file)) continue;
    fills[ph.slot] = `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
  }
  const parsed = {
    slots: template.slots, viewBox: [0, 0, template.width_mm, template.height_mm],
    widthMm: template.width_mm, heightMm: template.height_mm, textZone: template.text_zone,
  };
  return renderPreview(svg, parsed, fills, { text: project.frame_text });
}

// Force les dimensions du <svg> racine (en pixels) pour un rendu à la taille voulue
function withPixelSize(svg, wPx, hPx) {
  return svg.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
    const cleaned = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    return `<svg${cleaned} width="${wPx}" height="${hPx}">`;
  });
}

// PNG à 300 dpi aux dimensions réelles du gabarit (18 x 24 cm -> 2126 x 2835 px)
async function composePng(svg, template, dpi = PRINT_DPI) {
  const w = mmToPx(template.width_mm, dpi);
  const h = mmToPx(template.height_mm, dpi);
  return sharp(Buffer.from(withPixelSize(svg, w, h)), { density: dpi, limitInputPixels: false })
    .resize(w, h, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .withMetadata({ density: dpi })
    .png({ compressionLevel: 6 })
    .toBuffer();
}

module.exports = { composeSvg, composePng, mmToPx, PRINT_DPI };
