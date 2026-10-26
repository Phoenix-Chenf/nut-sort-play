export const COLORS = [
  { name: '珊瑚红', fill: '#e46d58', light: '#f89a7f', dark: '#b74537' },
  { name: '湖水青', fill: '#3baba6', light: '#73d0c8', dark: '#227d7a' },
  { name: '金黄色', fill: '#e5b447', light: '#f6d77c', dark: '#b78926' },
  { name: '靛紫色', fill: '#7772bd', light: '#a39cde', dark: '#514b94' },
  { name: '草绿色', fill: '#83ad54', light: '#b0ce7f', dark: '#587b35' },
  { name: '玫瑰粉', fill: '#d17da0', light: '#ebaac8', dark: '#a35277' },
  { name: '橘黄色', fill: '#d88c43', light: '#efb16a', dark: '#a85e27' },
  { name: '天空蓝', fill: '#528fc6', light: '#86b6e0', dark: '#326497' },
  { name: '葡萄紫', fill: '#a96cb3', light: '#c69ad0', dark: '#7c4487' },
  { name: '石板灰', fill: '#7f9390', light: '#aabab5', dark: '#556c68' },
  { name: '樱桃红', fill: '#b43751', light: '#d76880', dark: '#81233b' },
  { name: '深海蓝', fill: '#245478', light: '#4a7ca4', dark: '#183a59' },
  { name: '薄荷绿', fill: '#55c59c', light: '#8de2bf', dark: '#2c9372' },
  { name: '柠檬黄', fill: '#d7d26b', light: '#eeeba0', dark: '#a3a044' },
  { name: '丁香紫', fill: '#b59cdb', light: '#d6c5ed', dark: '#886db4' },
  { name: '蜜桃色', fill: '#eeab8f', light: '#ffd0b6', dark: '#c27b61' },
  { name: '森林绿', fill: '#387654', light: '#659879', dark: '#24563d' },
  { name: '巧克力棕', fill: '#875c48', light: '#af856b', dark: '#603f32' },
  { name: '象牙白', fill: '#d9d7c2', light: '#f0eedf', dark: '#a9aa92' },
  { name: '炭黑色', fill: '#424a52', light: '#6b7780', dark: '#293238' }
];

const MASKED = { fill: '#969c98', light: '#c6cbc5', dark: '#6e7771' };
const DARK_MARKINGS = new Set([2, 4, 12, 13, 14, 15, 18]);
const markings = [
  '<circle cx="0" cy="11" r="2"/>',
  '<circle cx="-4" cy="11" r="1.7"/><circle cx="4" cy="11" r="1.7"/>',
  '<path d="M-6 11H6"/>',
  '<path d="m-5 9 5 5 5-5"/>',
  '<path d="M-5 11H5M0 7v8"/>',
  '<path d="m0 7 5 7h-10Z"/>',
  '<path d="M-6 12q3-5 6 0t6 0"/>',
  '<path d="M-4 7h8v8h-8Z"/>',
  '<circle cx="0" cy="11" r="4" fill="none"/>',
  '<path d="m0 6 5 5-5 5-5-5Z"/>'
];

const NUT_TOP = 'M-28-5-14-13H14L28-5 14 3H-14Z';
const NUT_BODY = 'M-28-5-14-13H14L28-5V8L14 17H-14L-28 8Z';
const APERTURE = 'M-8.8-5a8.8 4.2 0 1 0 17.6 0a8.8 4.2 0 1 0-17.6 0Z';
const OUTER_HOLE = 'M-10.5-5a10.5 5.4 0 1 0 21 0a10.5 5.4 0 1 0-21 0Z';
const FRONT_TOP = 'M-28-5-14 3H14L28-5H10.5A10.5 5.4 0 0 1-10.5-5Z';
const FRONT_WALL = 'M-10.5-5A10.5 5.4 0 0 0 10.5-5H8.8A8.8 4.2 0 0 1-8.8-5Z';

/** Rear surface, shaft through the bore, then front lip: the rod enters the hole. */
export function nutMarkup(color, x = 50, y = 40, className = '', { masked = false, shaftId = null, shaftTop = 14 } = {}) {
  const colorIndex = ((Math.trunc(color) % COLORS.length) + COLORS.length) % COLORS.length;
  const c = masked ? MASKED : COLORS[colorIndex];
  const ink = masked || DARK_MARKINGS.has(colorIndex) ? '#304b3e' : '#fffaf0';
  const firstThread = Math.ceil((y - 15 - shaftTop) / 5);
  const shaftThreads = shaftId ? Array.from({ length: 4 }, (_, i) => {
    const localY = shaftTop + (firstThread + i) * 5 - y;
    return localY <= 1 ? `<path d="M-7 ${localY}q7 3.2 14 0"/>` : '';
  }).join('') : '';
  const shaft = shaftId ? `<path d="M-7-15H7V3H-7Z" fill="url(#${shaftId})"/>
    <g stroke="#6e8177" stroke-opacity=".28" stroke-width="1" fill="none">${shaftThreads}</g>` : '';
  const symbol = masked
    ? '<text x="0" y="13" text-anchor="middle" font-size="12" font-weight="700">?</text>'
    : `<g transform="translate(-6 3.2) scale(.68)" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${markings[colorIndex % markings.length]}</g>
      <text x="8" y="12.6" text-anchor="middle" font-size="7.3" font-weight="750">${String(colorIndex + 1).padStart(2, '0')}</text>`;
  return `<g class="nut ${className}" transform="translate(${x} ${y})" ${masked ? 'data-masked="true"' : `data-color="${color}"`}>
    <path d="${NUT_BODY}${APERTURE}" fill="${c.dark}" fill-rule="evenodd"/>
    <path d="M-28-5-14 3V17L-28 8Z" fill="${c.fill}"/>
    <path d="M-14 3H14V17H-14Z" fill="${c.fill}"/>
    <path d="m14 3 14-8V8L14 17Z" fill="${c.dark}"/>
    <path d="${NUT_TOP}${APERTURE}" fill="${c.light}" fill-rule="evenodd"/>
    <path d="${OUTER_HOLE}${APERTURE}" fill="${c.dark}" fill-rule="evenodd"/>
    <path d="M-26-5-13-12H13" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="1.2"/>
    <path d="M-9.4-6.4Q0-12 9.4-6.4" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1"/>
    ${shaft}
    <path d="${FRONT_TOP}" fill="${c.light}"/>
    <path d="${FRONT_WALL}" fill="${c.dark}"/>
    <path d="M-8.8-5A8.8 4.2 0 0 0 8.8-5" fill="none" stroke="#263c31" stroke-opacity=".22" stroke-width=".8"/>
    <g fill="${ink}" font-family="system-ui, sans-serif">${symbol}</g>
  </g>`;
}

export function rodGeometry(capacity) {
  const step = 18;
  const baseY = capacity * step + 18;
  return { width: 100, height: baseY + 30, baseY, step, nutOffset: 1, nutBottom: 17, nutTop: -13, shaftTop: 14, shaftWidth: 14, lift: 5, floatingPadding: 12 };
}

export function rodMarkup(rod, capacity, { selected = false, legal = false, complete = false, index = 0, liftCount = 0, hiddenFrom = Infinity, maskedIndices = [] } = {}) {
  const { width, height, baseY, step, nutOffset, shaftTop, shaftWidth } = rodGeometry(capacity);
  const shaftLeft = (width - shaftWidth) / 2;
  const threads = Array.from({ length: Math.ceil((baseY - shaftTop) / 5) }, (_, i) => `<path d="M${shaftLeft} ${shaftTop + i * 5}q7 3.2 ${shaftWidth} 0"/>`).join('');
  const unique = `shaft-${String(index).replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const masked = new Set(maskedIndices);
  const nuts = rod.map((color, i) => i >= hiddenFrom ? '' : nutMarkup(color, 50, baseY - nutOffset - i * step, selected && i >= rod.length - liftCount ? 'selected-nut' : '', { masked: masked.has(i), shaftId: unique, shaftTop })).join('');
  return `<svg class="rod-art" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${unique}" x1="0" x2="1"><stop stop-color="#929f97"/><stop offset=".35" stop-color="#e7eae2"/><stop offset=".6" stop-color="#c9d0c5"/><stop offset="1" stop-color="#8c9a91"/></linearGradient></defs>
    <ellipse cx="50" cy="${baseY + 23}" rx="33" ry="6" fill="#243e31" opacity=".09"/>
    ${legal ? `<ellipse class="legal-ring" cx="50" cy="${baseY + 11}" rx="36" ry="13" fill="none" stroke="#54856a" stroke-width="2" stroke-dasharray="3 4"/>` : ''}
    <path d="M18 ${baseY + 8}v7q32 19 64 0v-7" fill="#98a69b"/>
    <ellipse cx="50" cy="${baseY + 8}" rx="32" ry="12" fill="#d5dcd0"/>
    <ellipse cx="50" cy="${baseY + 7}" rx="26" ry="8.8" fill="#e6e9df"/>
    <path d="M${shaftLeft} ${shaftTop}h${shaftWidth}v${baseY - shaftTop + 3}q-7 4-${shaftWidth} 0Z" fill="url(#${unique})"/>
    <g stroke="#6e8177" stroke-opacity=".28" stroke-width="1" fill="none">${threads}</g>
    <ellipse cx="50" cy="${shaftTop}" rx="7" ry="3.8" fill="#e7eae3"/>
    <ellipse cx="50" cy="${shaftTop - .7}" rx="5.2" ry="2.5" fill="#f3f4ed"/>
    ${nuts}
    ${complete ? `<g class="rod-complete" transform="translate(77 ${baseY + 18})"><circle r="8.5" fill="#345d47"/><path d="m-4 0 2.7 3L4-3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>` : ''}
  </svg>`;
}

export function floatingNutsMarkup(color, count) {
  const { width, step, nutBottom, floatingPadding } = rodGeometry(count);
  const height = count * step + floatingPadding;
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${Array.from({ length: count }, (_, i) => nutMarkup(color, 50, height - nutBottom - i * step)).join('')}</svg>`;
}

export function guideMarkup() {
  const guideY = 30;
  const { baseY, step, nutOffset } = rodGeometry(3);
  const flyingY = guideY + baseY - nutOffset - step;
  return `<svg viewBox="0 0 320 180" role="presentation">
    <g class="guide-rod-left" transform="translate(33 ${guideY})">${rodMarkup([1], 3, { index: 'guide-left' }).replace(/^<svg[^>]*>/, '<g>').replace(/<\/svg>$/, '</g>')}</g>
    <g class="guide-rod-right" transform="translate(188 ${guideY})">${rodMarkup([0], 3, { index: 'guide-right' }).replace(/^<svg[^>]*>/, '<g>').replace(/<\/svg>$/, '</g>')}</g>
    <path class="guide-arc" d="M83 ${flyingY}C95 8 226 8 238 ${flyingY}" fill="none" stroke="#587c65" stroke-width="1.5" stroke-dasharray="3 5"/>
    <g class="guide-flying">${nutMarkup(0, 83, flyingY)}</g>
    <g class="guide-tap"><circle cx="83" cy="${flyingY}" r="23" fill="none" stroke="#375e48" stroke-width="2"/><circle cx="83" cy="${flyingY}" r="29" fill="none" stroke="#375e48" stroke-opacity=".3"/></g>
    <g class="guide-target"><ellipse cx="238" cy="${guideY + baseY + 11}" rx="36" ry="13" fill="none" stroke="#54856a" stroke-width="2" stroke-dasharray="3 4"/></g>
    <text x="83" y="170" text-anchor="middle">先选这一根</text><text x="238" y="170" text-anchor="middle">再点同色落点</text>
  </svg>`;
}
