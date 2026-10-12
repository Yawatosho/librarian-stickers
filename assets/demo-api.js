// デモ専用。GASへは接続せず、本番とは異なるlocalStorageキーを使用。
import {TYPES, SHAPES, COLORS, publicSticker} from './core.js';
export class DemoApi {
  constructor(storage) { this.storage = storage; }
  async list() {
    await new Promise(resolve => setTimeout(resolve, 180));
    const saved = JSON.parse(this.storage.getItem('librarian-sticker-demo-board-v1') || 'null');
    return saved || TYPES.flatMap(({type}) => Array.from({length: 2 + type % 5}, (_, i) => ({row: type * 10 + i + 2, type, rating: ['fit','okay','surprise'][i % 3], x: .2 + ((type * 7 + i * 11) % 60) / 100, y: .2 + ((type * 13 + i * 7) % 60) / 100, shape: Object.keys(SHAPES)[(type + i) % 6], color: Object.keys(COLORS)[(type + i) % 11]})));
  }
  async save(sticker, existing, onRequestId) {
    const requestId = crypto.randomUUID();
    const receipt = {row: existing?.row || 1000, token: existing?.token || 'demo-local-only'};
    onRequestId({requestId, payload: {operation: existing ? 'update' : 'create', requestId, sticker, ...(existing ? {row: existing.row, token: existing.token} : {})}});
    const board = (await this.list()).filter(item => item.row !== receipt.row);
    this.storage.setItem('librarian-sticker-demo-board-v1', JSON.stringify([...board, publicSticker({...receipt, ...sticker})]));
    this.storage.setItem('librarian-sticker-demo-receipt-v1', JSON.stringify({requestId, receipt}));
    return receipt;
  }
  async resumeReceipt(requestId) {
    const saved = JSON.parse(this.storage.getItem('librarian-sticker-demo-receipt-v1') || 'null');
    if (saved?.requestId === requestId) return saved.receipt;
    throw new Error('デモの保存結果を確認できません。');
  }
}
