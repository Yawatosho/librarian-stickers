/* Browser-side transport adapter for GitHub Pages -> Google Apps Script.
 * Use a GAS /exec deployment URL; do NOT use /dev.
 * Requires an HTTPS GitHub Pages origin and modern browser with crypto.randomUUID().
 */
(function () {
  'use strict';

  class StickerApi {
    constructor(endpoint) {
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(endpoint)) {
        throw new Error('GAS の /exec URL を設定してください。');
      }
      this.endpoint = endpoint;
    }

    jsonp_(params, timeoutMs = 16000) {
      return new Promise((resolve, reject) => {
        const callback = '__stickerCallback_' + crypto.randomUUID().replace(/-/g, '');
        const script = document.createElement('script');
        // Don't send Google account cookies with cross-origin JSONP reads.
        // The deployed GAS and its ContentService redirect return ACAO: *.
        // This avoids account-selection/login HTML in multi-account browsers.
        script.crossOrigin = 'anonymous';
        const query = new URLSearchParams({...params, callback, _: Date.now().toString()});
        let finished = false;
        const timer = setTimeout(() => finish(new Error('読み込みがタイムアウトしました。')), timeoutMs);
        const finish = (err, result) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          delete window[callback];
          script.remove();
          if (err) reject(err); else resolve(result);
        };
        window[callback] = (data) => finish(null, data);
        script.onerror = () => finish(new Error('読み込みに失敗しました。'));
        script.src = this.endpoint + '?' + query;
        document.head.appendChild(script);
      });
    }

    async list() {
      const data = await this.jsonp_({action: 'list'});
      if (!data || !data.ok || !Array.isArray(data.stickers)) {
        throw new Error('シール一覧を取得できませんでした。');
      }
      return data.stickers;
    }

    /**
     * existing: null for first sticker, or {row, token} from localStorage.
     * Returns: {row, token}. Save it to localStorage ONLY after state=success.
     * On uncertainty, save a pending operation locally and try resumeReceipt() later.
     */
    async save(sticker, existing, onRequestId) {
      const requestId = crypto.randomUUID();
      const payload = {
        operation: existing ? 'update' : 'create', requestId, sticker,
        ...(existing ? {row: existing.row, token: existing.token} : {})
      };
      if (typeof onRequestId === 'function') onRequestId({requestId, payload});

      // No CORS-readable POST response. The server writes a short-lived receipt
      // to CacheService, fetched separately via read-only JSONP.
      fetch(this.endpoint, {
        method: 'POST', mode: 'no-cors', credentials: 'omit', redirect: 'follow',
        headers: {'Content-Type': 'text/plain;charset=UTF-8'},
        body: JSON.stringify(payload)
      }).catch(() => { /* poll below determines whether processing succeeded */ });
      return this.resumeReceipt(requestId);
    }

    async resumeReceipt(requestId, timeoutMs = 40000) {
      const started = Date.now();
      let lastError = null;
      while (Date.now() - started < timeoutMs) {
        try {
          const data = await this.jsonp_({action: 'receipt', requestId}, 10000);
          if (data && data.state === 'success' && Number.isSafeInteger(data.row) && data.token) {
            return {row: data.row, token: data.token};
          }
          if (data && data.state === 'error') {
            const error = new Error(data.error || '保存に失敗しました。');
            error.serverRejected = true;
            throw error;
          }
          if (data && data.ok === false) throw new Error(data.error || '保存結果を取得できません。');
        } catch (err) {
          if (err.serverRejected) {
            throw err;
          }
          lastError = err;
        }
        await new Promise(resolve => setTimeout(resolve, 1300));
      }
      throw new Error('保存結果を確認できません。連続投稿せず、後で再確認してください。' +
        (lastError ? ' (' + lastError.message + ')' : ''));
    }
  }

  window.StickerApi = StickerApi;
}());
