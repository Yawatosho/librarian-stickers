import {TYPES, RATINGS, SHAPES, COLORS, STICKER_SIZE, RECEIPT_TTL, stickerSvg, validOwn, validPending, publicSticker, clampPosition} from './core.js';
import {DemoApi} from './demo-api.js';

const $ = id => document.getElementById(id);
const config = window.STICKER_CONFIG || {};
const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const demo = localPreview && (new URLSearchParams(location.search).get('demo') === '1' || !config.gasUrl);
const prefix = demo ? 'librarian-sticker-demo' : 'librarian-sticker';
const ownKey = `${prefix}-v1`;
const pendingKey = `${prefix}-pending-v1`;
const lockName = `${prefix}-save-lock`;
let storage, storageReady = false, storageProblem = '', api;
let own = null, pending = null, draft = null, stickers = [];
let shape = 'circle', color = '#ef4444';
let busy = false, loading = false, loaded = false, refreshTimer, lastUpdated = null;
let saveMessage = '', saveError = false, remoteBusy = false;

function readStored(key, validate) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!validate(value)) throw new Error('保存情報を読み取れません。ブラウザ内のデータを確認してください。');
  return value;
}
try {
  storage = window.localStorage;
  const probe = `${prefix}-probe`;
  storage.setItem(probe, '1');
  storage.removeItem(probe);
  own = readStored(ownKey, validOwn);
  pending = readStored(pendingKey, validPending);
  storageReady = true;
  if (own) { shape = own.shape; color = own.color; }
} catch (err) {
  storageProblem = 'このブラウザに参加情報を保存できないため、閲覧のみ利用できます。' + err.message;
}
try { api = demo ? new DemoApi(storage) : new window.StickerApi(config.gasUrl); }
catch (err) { storageProblem = err.message; }

document.querySelectorAll('.diagnosis-link').forEach(link => { link.href = config.diagnosisUrl || 'https://yawatosho.github.io/librarian-type/'; });
if (localPreview) {
  const link = document.createElement('a');
  link.id = 'demo-link';
  link.href = '?demo=1';
  link.textContent = 'デモで試してみる';
  document.querySelector('.participation-note').append(link);
}
if (demo) {
  $('mode-banner').hidden = false;
  $('mode-banner').textContent = 'デモモード — このブラウザだけで試せます。会場のボードには投稿されません。';
  $('demo-link').textContent = config.gasUrl ? '本番のシールボードへ戻る' : 'GAS未設定のため、デモを表示しています';
  $('demo-link').href = './';
}
if (storageProblem) {
  $('mode-banner').hidden = false;
  $('mode-banner').textContent = storageProblem;
}

function buildBoard() {
  $('board').innerHTML = TYPES.map(({type, slug, name}) => `<article class="type-card" id="type-${type}" aria-label="${name}">
    <div class="card-index"><span>TYPE / ${String(type).padStart(2,'0')}</span><span class="card-count" data-count-type="${type}">— 枚</span></div>
    <img class="type-image" src="assets/result-ogp/${slug}.webp" alt="${name}のキャラクターカード" width="1672" height="941" loading="${type <= 4 ? 'eager' : 'lazy'}" decoding="async">
    <div class="rating-grid">${Object.entries(RATINGS).map(([rating, label]) => `<div class="rating-column ${rating}"><div class="rating-label" id="label-${type}-${rating}">${label}<span data-count-zone="${type}-${rating}"></span></div><button type="button" class="sticker-zone" data-type="${type}" data-rating="${rating}" aria-pressed="false" aria-label="${name}：${label}の枠に仮置き" aria-describedby="board-help"><span class="zone-hint" aria-hidden="true">＋</span><span class="sticker-layer" aria-hidden="true"></span></button></div>`).join('')}</div>
  </article>`).join('');
}
function buildPicker() {
  $('shape-picker').innerHTML = Object.entries(SHAPES).map(([key, label]) => `<button type="button" class="shape-option" data-shape="${key}" aria-label="${label}" aria-pressed="${key === shape}">${stickerSvg(key,'#111827')}<span>${label}</span></button>`).join('');
  $('color-picker').innerHTML = Object.entries(COLORS).map(([key, label]) => `<button type="button" class="color-option" data-color="${key}" style="--swatch:${key}" aria-label="${label}" aria-pressed="${key === color}"><span aria-hidden="true">✓</span></button>`).join('');
}
function renderPicker() {
  document.querySelectorAll('[data-shape]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.shape === shape));
    button.disabled = busy || !!pending || remoteBusy || !storageReady;
  });
  document.querySelectorAll('[data-color]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.color === color));
    button.disabled = busy || !!pending || remoteBusy || !storageReady;
  });
  $('sticker-preview').innerHTML = stickerSvg(shape, color);
}
function renderBoard() {
  // Strip all private/server-extra fields and identify one public row per sticker.
  const visible = new Map(stickers.map(item => [item.row, item]));
  if (own) visible.set(own.row, publicSticker(own));
  const all = [...visible.values()];
  $('total-count').textContent = loaded || own ? all.length.toLocaleString('ja-JP') : '—';
  document.querySelectorAll('[data-count-type]').forEach(el => {
    const type = Number(el.dataset.countType);
    el.textContent = loaded || own ? `${all.filter(s => s.type === type).length} 枚` : '— 枚';
  });
  document.querySelectorAll('.sticker-zone').forEach(zone => {
    const type = Number(zone.dataset.type), rating = zone.dataset.rating;
    const placed = all.filter(s => s.type === type && s.rating === rating);
    const isDraft = draft?.type === type && draft?.rating === rating;
    const mine = own?.type === type && own?.rating === rating;
    zone.classList.toggle('has-draft', isDraft);
    zone.classList.toggle('has-own', mine);
    zone.setAttribute('aria-pressed', String(isDraft));
    zone.setAttribute('aria-label', `${TYPES[type-1].name}：${RATINGS[rating]}、${placed.length}枚${mine ? '、あなたのシールがあります' : ''}。Enterで仮置き、矢印キーで位置調整`);
    zone.disabled = busy || !!pending || remoteBusy || !storageReady;
    const renderSticker = (item, extra) => `<span class="sticker ${extra}" style="left:clamp(13px,${item.x * 100}%,calc(100% - 13px));top:clamp(13px,${item.y * 100}%,calc(100% - 13px))">${stickerSvg(item.shape,item.color)}</span>`;
    zone.querySelector('.sticker-layer').innerHTML = placed.map(item => renderSticker(item, item.row === own?.row ? 'is-own' : '')).join('') + (isDraft ? renderSticker(draft,'is-draft') : '');
    zone.querySelector('.zone-hint').hidden = placed.length > 0 || isDraft;
    document.querySelector(`[data-count-zone="${type}-${rating}"]`).textContent = loaded ? placed.length : '';
  });
}
function renderConfirmation() {
  const selected = pending?.payload.sticker || draft || own;
  $('confirmation').hidden = !selected && !saveMessage;
  document.body.classList.toggle('with-confirmation', !$('confirmation').hidden);
  if (selected) {
    $('selection-label').textContent = `${TYPES[selected.type-1].name} / ${RATINGS[selected.rating]}`;
    $('confirm-preview').innerHTML = stickerSvg(selected.shape, selected.color);
  }
  $('save-status').textContent = saveMessage || (draft ? '仮置き中。位置を変えるには、枠の中をもう一度タップ。' : own ? (demo ? 'デモのシールです。会場には投稿されていません。' : '二重の輪があなたのシール。別の枠にも貼り直せます。') : '');
  $('save-status').classList.toggle('is-error', saveError);
  $('confirm').hidden = !draft || !!pending;
  $('confirm').disabled = busy || remoteBusy || !loaded || !storageReady;
  $('confirm').textContent = busy ? '保存結果を確認中…' : demo ? 'デモでこの場所に貼る' : own ? 'この場所に貼り直す ↗' : 'この場所に貼る ↗';
  $('cancel').hidden = !draft || !!pending;
  $('cancel').disabled = busy || remoteBusy;
  $('receipt-retry').hidden = !pending;
  $('receipt-retry').disabled = busy || remoteBusy || !storageReady;
  $('receipt-retry').textContent = busy ? '保存結果を確認中…' : '保存結果を再確認';
  document.querySelector('.change-link').hidden = !draft || !!pending || busy;
}
function render() { renderPicker(); renderBoard(); renderConfirmation(); }
function place(zone, x, y) {
  if (busy || pending || remoteBusy || !storageReady) return;
  const position = clampPosition(x,y,zone.clientWidth,zone.clientHeight);
  draft = {type: Number(zone.dataset.type), rating: zone.dataset.rating, ...position, shape, color};
  saveMessage = ''; saveError = false;
  render();
}
buildBoard(); buildPicker(); render();
$('shape-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-shape]');
  if (!button || button.disabled) return;
  shape = button.dataset.shape;
  if (draft) draft.shape = shape;
  render();
});
$('color-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-color]');
  if (!button || button.disabled) return;
  color = button.dataset.color;
  if (draft) draft.color = color;
  render();
});
$('board').addEventListener('click', event => {
  const zone = event.target.closest('.sticker-zone');
  if (!zone) return;
  if (event.detail === 0) {
    const same = draft?.type === Number(zone.dataset.type) && draft?.rating === zone.dataset.rating;
    place(zone,same ? draft.x : .5,same ? draft.y : .5);
  } else {
    const rect = zone.getBoundingClientRect();
    place(zone, (event.clientX - rect.left - zone.clientLeft) / zone.clientWidth, (event.clientY - rect.top - zone.clientTop) / zone.clientHeight);
  }
});
$('board').addEventListener('keydown', event => {
  const zone = event.target.closest('.sticker-zone');
  if (!zone || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape'].includes(event.key)) return;
  event.preventDefault();
  if (busy || pending || remoteBusy) return;
  if (event.key === 'Escape') { draft = null; saveMessage = ''; render(); return; }
  const same = draft?.type === Number(zone.dataset.type) && draft?.rating === zone.dataset.rating;
  const point = same ? draft : {x:.5,y:.5};
  const step = event.shiftKey ? 12 : 4;
  place(zone,point.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / zone.clientWidth,point.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) / zone.clientHeight);
});
$('cancel').addEventListener('click', () => {
  if (busy || pending) return;
  const zone = draft && document.querySelector(`[data-type="${draft.type}"][data-rating="${draft.rating}"]`);
  draft = null; saveMessage = ''; render(); zone?.focus({preventScroll:true});
});

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!document.hidden) refreshTimer = setTimeout(refresh, 60000 + Math.random() * 30000);
}
async function refresh() {
  clearTimeout(refreshTimer);
  if (loading || !api) { scheduleRefresh(); return; }
  loading = true;
  $('refresh').disabled = true;
  $('connection-status').textContent = loaded ? 'みんなのシールを更新中…' : 'みんなのシールを読み込み中…';
  try {
    const data = await api.list();
    stickers = data.map(publicSticker).filter(Boolean);
    loaded = true;
    lastUpdated = new Date();
    $('load-error').hidden = true;
    $('connection-status').textContent = `${demo ? 'デモ表示' : '接続中'} · ${lastUpdated.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} 更新`;
    $('connection-status').classList.remove('is-error');
  } catch (err) {
    $('connection-status').textContent = '通信を確認してください';
    $('connection-status').classList.add('is-error');
    $('load-error').hidden = false;
    $('load-error').textContent = (loaded ? '更新できませんでした。前回取得したシールを表示しています。' : 'みんなのシールを取得できませんでした。接続後に「更新」を押してください。') + ' ' + err.message;
  } finally {
    loading = false; $('refresh').disabled = false; render(); scheduleRefresh();
  }
}
$('refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => {
  clearTimeout(refreshTimer);
  if (!document.hidden) {
    refresh();
    if (pending && !busy && !expired(pending)) recover();
  }
});
window.addEventListener('online', () => {
  if (!document.hidden) { refresh(); if (pending && !busy && !expired(pending)) recover(); }
});
function expired(operation) { return !Number.isFinite(operation.createdAt) || Date.now() - operation.createdAt >= RECEIPT_TTL; }
function unknownMessage() { return '保存結果は不明です。10分を超えて確認情報が失われた可能性があります。重複を避けるため新しい投稿は停止しています。「保存結果を再確認」で確認できます。'; }

// Serialize writes across tabs of this origin. The lock is held until receipt checks finish.
async function withSaveLock(action) {
  if (busy || !storageReady || !api) return;
  busy = true; render();
  const run = async () => {
    try {
      own = readStored(ownKey, validOwn);
      pending = readStored(pendingKey, validPending);
      await action();
    } catch (err) { handleSaveError(err); }
  };
  try {
    if (navigator.locks) {
      await navigator.locks.request(lockName, {ifAvailable: true}, async lock => {
        if (!lock) { saveMessage = '別のタブで保存中です。保存が終わってから操作してください。'; return; }
        await run();
      });
    } else {
      // Older browsers: conservative lease plus re-read of pending before any POST.
      const leaseKey = `${prefix}-lease-v1`, id = crypto.randomUUID();
      const lease = JSON.parse(storage.getItem(leaseKey) || 'null');
      if (lease && lease.until > Date.now()) { saveMessage = '別のタブで保存中です。少し待ってから再確認してください。'; return; }
      storage.setItem(leaseKey, JSON.stringify({id, until: Date.now() + 90000}));
      await new Promise(resolve => setTimeout(resolve, 100));
      if (JSON.parse(storage.getItem(leaseKey) || 'null')?.id !== id) { saveMessage = '別のタブの保存が終わるまでお待ちください。'; return; }
      try { await run(); }
      finally { if (JSON.parse(storage.getItem(leaseKey) || 'null')?.id === id) storage.removeItem(leaseKey); }
    }
  } catch (err) { handleSaveError(err); }
  finally { busy = false; render(); }
}
function handleSaveError(err) {
  saveError = true;
  if (err.receiptConfirmed) {
    saveMessage = err.message + ' 新しい投稿を停止しています。このブラウザの保存設定を確認してください。';
  } else if (err.serverRejected) {
    // A confirmed rejection permits a new attempt; uncertainty never does.
    if (pending) draft = {...pending.payload.sticker};
    try { storage.removeItem(pendingKey); pending = null; }
    catch { storageReady = false; }
    saveMessage = '保存に失敗しました。' + err.message + ' 位置を確認して、もう一度お試しください。';
  } else if (pending) {
    saveMessage = expired(pending) ? unknownMessage() : '保存結果を確認できませんでした。仮置き情報はこのブラウザに残っています。「保存結果を再確認」を押してください。新しいシールは送信しません。';
  } else { saveMessage = '送信できませんでした。' + err.message; }
}
function commit(receipt, sticker) {
  if (!validOwn({...receipt,...sticker})) throw new Error('保存結果の形式が正しくありません。');
  const confirmed = {...receipt,...sticker};
  try {
    storage.setItem(ownKey, JSON.stringify(confirmed));
    storage.removeItem(pendingKey);
  } catch {
    // Keep pending; even after server success, don't allow an untracked extra create.
    storageReady = false;
    const error = new Error('サーバーの保存は成功しましたが、ブラウザに情報を保存できませんでした。');
    error.receiptConfirmed = true;
    throw error;
  }
  own = confirmed; pending = null; draft = null;
  stickers = stickers.filter(item => item.row !== receipt.row);
  stickers.push(publicSticker(confirmed));
  saveMessage = demo ? 'デモで貼りました。会場のボードには投稿されていません。' : '貼りました！ あなたの一枚が、みんなのボードに加わりました。';
  saveError = false;
  render();
  // Keep the server-confirmed own sticker visible while the background list catches up.
  refresh();
}
async function checkPending() {
  const operation = pending;
  saveMessage = '保存結果を確認中です。画面を閉じても、次回同じ結果を確認できます。';
  saveError = false; render();
  const receipt = await api.resumeReceipt(operation.requestId);
  commit(receipt, operation.payload.sticker);
}
function recover() { return withSaveLock(async () => { if (pending) await checkPending(); }); }
$('receipt-retry').addEventListener('click', recover);
$('confirm').addEventListener('click', () => withSaveLock(async () => {
  if (pending) { await checkPending(); return; }
  if (!draft || !loaded) return;
  // Dimensions may have changed since initial placement.
  const zone = document.querySelector(`[data-type="${draft.type}"][data-rating="${draft.rating}"]`);
  const sticker = {...draft,...clampPosition(draft.x,draft.y,zone.clientWidth,zone.clientHeight)};
  saveMessage = '保存中です。結果を確認するまでお待ちください。';
  saveError = false; render();
  const receipt = await api.save(sticker, own, operation => {
    const next = {...operation, createdAt: Date.now()};
    // This callback must complete before StickerApi sends POST.
    storage.setItem(pendingKey, JSON.stringify(next));
    pending = next; render();
  });
  commit(receipt, sticker);
}));
window.addEventListener('storage', event => {
  if (![ownKey,pendingKey].includes(event.key) || busy || !storageReady) return;
  try {
    own = readStored(ownKey, validOwn);
    pending = readStored(pendingKey, validPending);
    remoteBusy = false;
    saveMessage = pending ? '別のタブで送信されたシールの保存結果を確認できます。新しい投稿は停止しています。' : '';
    render();
  } catch (err) { storageReady = false; saveMessage = err.message; saveError = true; render(); }
});
refresh();
if (pending) {
  if (expired(pending)) { saveMessage = unknownMessage(); saveError = true; render(); }
  else recover();
}
