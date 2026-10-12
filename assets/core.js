// type は必ず参照元 app/data.ts の results 配列順。ポスターの見た目の順序ではない。
export const TYPES = [
  ['reference-runner', 'レファレンス走りながら考える派'],
  ['counter-detective', 'カウンター探偵'],
  ['reference-deep-dive', 'レファレンス沼の住人'],
  ['reference-interview', 'レファレンスインタビュー深掘り派'],
  ['service-lab', '利用者サービス実験部'],
  ['counter-controller', 'カウンター交通整理係'],
  ['user-flow', '利用者動線研究部'],
  ['guide-planner', '館内案内先回り係'],
  ['shelf-browser', '書架ブラウジング派'],
  ['missing-material', '行方不明資料捜索班'],
  ['selection-deep-dive', '選書沼の住人'],
  ['edition-checker', '異版が気になる人'],
  ['shelving-tuner', '配架チューニング派'],
  ['call-number', '請求記号ぴったり派'],
  ['classification-tinkerer', '分類体系いじり屋'],
  ['authority-control', '典拠が合うと落ち着く人'],
].map(([slug, name], i) => ({type: i + 1, slug, name}));
export const RATINGS = {fit: 'しっくり', okay: 'まぁまぁ', surprise: '意外'};
export const SHAPES = {circle: 'まる', square: 'しかく', triangle: 'さんかく', star: 'ほし', heart: 'ハート', diamond: 'ひし形'};
export const COLORS = {'#ef4444': '赤', '#f97316': 'オレンジ', '#f59e0b': '山吹', '#eab308': '黄', '#22c55e': '緑', '#06b6d4': '水色', '#3b82f6': '青', '#8b5cf6': '紫', '#ec4899': 'ピンク', '#64748b': 'グレー', '#111827': '黒'};
export const STICKER_SIZE = 18;
export const RECEIPT_TTL = 10 * 60 * 1000;
const paths = {
  circle: '<circle cx="12" cy="12" r="10"/>',
  square: '<rect x="2" y="2" width="20" height="20" rx="2"/>',
  triangle: '<path d="M12 2 23 22H1Z"/>',
  star: '<path d="m12 1 3.4 7 7.6 1.1-5.5 5.4 1.3 7.6-6.8-3.6-6.8 3.6 1.3-7.6L1 9.1 8.6 8Z"/>',
  heart: '<path d="M12 22C9 19 1 13.5 1 7.5 1 0 9-1 12 5c3-6 11-5 11 2.5 0 6-8 11.5-11 14.5Z"/>',
  diamond: '<path d="m12 1 10 11-10 11L2 12Z"/>',
};
export function stickerSvg(shape, color) {
  if (!SHAPES[shape] || !COLORS[color]) return '';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="${color}" stroke="rgba(0,0,0,.16)" stroke-width=".8">${paths[shape]}</svg>`;
}
export function validSticker(value) {
  return !!value && Number.isInteger(value.type) && value.type >= 1 && value.type <= 16 &&
    Object.hasOwn(RATINGS, value.rating) && Object.hasOwn(SHAPES, value.shape) && Object.hasOwn(COLORS, value.color) &&
    Number.isFinite(value.x) && value.x >= 0 && value.x <= 1 && Number.isFinite(value.y) && value.y >= 0 && value.y <= 1;
}
export function publicSticker(value) {
  if (!validSticker(value) || !Number.isSafeInteger(value.row) || value.row < 2) return null;
  const {row, type, rating, x, y, shape, color} = value;
  return {row, type, rating, x, y, shape, color};
}
export function validOwn(value) {
  return !!publicSticker(value) && typeof value.token === 'string' && value.token.length > 0;
}
export function validPending(value) {
  return !!value && typeof value.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(value.requestId) &&
    value.payload?.requestId === value.requestId && validSticker(value.payload?.sticker) &&
    ['create', 'update'].includes(value.payload.operation) && (value.payload.operation !== 'update' ||
      (Number.isSafeInteger(value.payload.row) && value.payload.row >= 2 && typeof value.payload.token === 'string' && value.payload.token.length > 0));
}
export function clampPosition(x, y, width, height, size = STICKER_SIZE) {
  const rx = Math.min(.5, (size / 2 + 4) / Math.max(1, width));
  const ry = Math.min(.5, (size / 2 + 4) / Math.max(1, height));
  return {x: Math.max(rx, Math.min(1 - rx, x)), y: Math.max(ry, Math.min(1 - ry, y))};
}
