# みんなの図書館員タイプ — シールボード

図書館総合展向けの参加型ページです。16タイプのカードの下に「しっくり」「まぁまぁ」「意外」の48枠を用意しています。形と色を選び、枠内の好きな場所に仮置きしてから確定します。同じブラウザのシールは一枚で、貼り直すと前の位置から移動します。

- 公開フロントエンド：<https://yawatosho.github.io/librarian-stickers/>
- 参照元：<https://github.com/Yawatosho/librarian-type>
- サーバー：既存のGoogle Apps Script（GAS）。フロントエンドをGAS HTML Serviceで配信しません。

## 制作方針と参照元

新規リポジトリ `librarian-stickers` で独立して管理し、既存の診断コードは変更していません。HTML/CSS/JavaScriptのみで動作し、ビルドやnpm依存は不要です。

参照した既存リポジトリのコミットは `54a440ac10c268b0a4d44f907f9797fee141ddd4` です。`types/index.html`、`assets/styles.css`、`app/data.ts` を確認し、背景色、フォント、4色のアクセント、カード画像を再利用しました。ポスターの「画像＋3枠」の構成をHTMLで作っています。

タイプ名・スラッグ・番号は **`app/data.ts` の `results` 配列順** に一致します。ポスターの掲載順とは異なります。`assets/core.js` に定義し、独立した参照元データ `tests/upstream-types.json` と照合しています。

16枚の `assets/result-ogp/*.webp` と `assets/favicon.svg` は参照元をそのままコピーしています。キャラクターの切り抜き、描き直し、画像の加工はしていません。画像をローカルに保持しているため、参加時に診断サイトの画像配信を待つ必要はありません。

## GASの設定

`config.js` の **`window.STICKER_CONFIG.gasUrl`** 一箇所に `/exec` のURLを設定します。指定されたデプロイURLは設定済みです。`/dev` は使用しません。

```js
window.STICKER_CONFIG = Object.freeze({
  gasUrl: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
  diagnosisUrl: 'https://yawatosho.github.io/librarian-type/',
});
```

GASは利用者がGoogleにログインしていなくてもアクセスできる公開設定が必要です。GASを再デプロイしてURLが変わった場合は、ここを変更してコミット・プッシュします。APIキーや署名用秘密鍵はフロントエンドに設定しません。

添付の `sticker-api.js` を **`assets/sticker-api.js` に組み込んでいます**。一覧は読み取り専用JSONP、書き込みは `text/plain;charset=UTF-8` の `no-cors` POST、結果は `requestId` を使う読み取り専用JSONPで確認します。POST応答をJSONとして読む処理はありません。

Chromeで複数のGoogleアカウントにログインしている場合の読み込み失敗への対策として、JSONPのscript要素に `crossOrigin = 'anonymous'`、POSTに `credentials: 'omit'` を追加しています。どちらもGoogleのログインCookieを送信しません。公開GASの初回応答と `script.googleusercontent.com` へのリダイレクト後の応答が `Access-Control-Allow-Origin: *` を返すことを実際に確認して、この設定を採用しました。JSONP方式と結果確認の仕組みは維持しています。

## GitHub Pagesへの公開

1. リポジトリの Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定します。
2. 完成ファイルを `main` にコミット・プッシュします。
3. Actions の **Deploy sticker board to GitHub Pages** が成功すると公開されます。

`.github/workflows/pages.yml` は基本テストを実行し、`index.html`、`config.js`、`.nojekyll`、`assets/` だけをPagesに配置します。README、テストコード、テスト画像は配信されません。すべて相対パスで、GitHub Pagesのリポジトリサブパスに対応しています。

## ローカル起動・デモ

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

ブラウザで `http://127.0.0.1:8000/` を開きます。`file://` ではES Modulesと通信が正常に動作しません。本番はHTTPS、ローカルは `localhost` / `127.0.0.1` を使ってください（`crypto.randomUUID()` が必要です）。

**デモ：** `http://127.0.0.1:8000/?demo=1` または公開URLに `?demo=1` を付けます。`config.js` の `gasUrl` が空の場合も明示的なデモになります。画面に「会場のボードには投稿されません」と表示し、本番とは別の保存キーを使います。デモはこのブラウザ内で完結し、GASに接続しません。ブラウザのデバイス表示機能でスマートフォンサイズを確認できます。

## 保存・エラー時の動作

- 成功が確認されるまでは、本番の確定済みlocalStorage情報を変更しません。
- 本番確定情報：`librarian-sticker-v1`（`row, token, type, rating, x, y, shape, color`）。
- 送信前に `librarian-sticker-pending-v1`（`requestId, payload, createdAt`）を保存します。保存できない場合はPOSTしません。
- 不明な保存結果はpendingを保持し、新しいPOSTを停止します。「保存結果を再確認」や再訪で `resumeReceipt()` だけを実行します。
- 10分超、または時刻のないpendingは「結果不明」と明示し、自動送信・自動再確認を行いません。手動の結果確認は可能です。無条件で新規投稿し直す操作はありません。
- GASが明確に失敗を返した場合は、仮置きを残して再試行できます。更新失敗時には前の確定済みシールを保持します。
- 自分のシールには二重の輪、仮置きには点線の輪を表示します。背景の他の参加者のシールには編集操作を用意していません。
- localStorageが使えない・既存情報が壊れている場合は閲覧のみとします。
- 同一オリジンの複数タブはWeb Locksで保存を直列化し、送信直前に保存情報を読み直します。Web Locks非対応の古いブラウザではlocalStorageの期限付きロックで保守的に処理します。
- 一覧を60〜90秒のランダム間隔で更新します。非表示タブでは定期更新を停止し、再表示・オンライン復帰時に取得します。更新しても仮置きは失われません。取得失敗時は前回の一覧を表示します。

`row` はシールの行番号です。`token` はブラウザの保存情報と更新POSTにのみ使用し、URL、DOM、公開一覧、ログには含めません。名前・メールアドレス・ユーザーIDは収集しません。GAS側のスプレッドシートの内部保存処理はこのリポジトリの範囲外です。

同じGitHub Pagesオリジン内でブラウザに一枚を保持する方式です。保存データの削除、プライベートブラウズ、別ブラウザ・別端末は別参加になります。厳密な一人一枚の本人認証は行いません。

## ネットワークの注意点

GAS ContentServiceのブラウザ向けCORS制約に合わせた添付アダプターを使用しています。ネットワークで `script.google.com` / `script.googleusercontent.com` が制限されると一覧・結果確認に失敗します。JSONPは外部スクリプトとして実行されるため、GASのURLは信頼できる自分のデプロイに限定してください。会場で使用する回線・端末でも本番接続を確認してください。

POSTは無認証のため、大量投稿の完全な防止はできません。署名トークンの検証や保存先の保護は既存GAS側の責務です。

## 操作・アクセシビリティ

- PC：4列、タブレット：3列／2列、スマートフォン：1列。
- 枠はクリック／タップできます。座標は枠の左上から0〜1の相対値です。
- 枠内制限には18pxのシールと自分のシールの輪の余白を含めます。画面幅が変わった場合も描画位置を枠内に制限し、保存直前に座標を再補正します。
- キーボード：Tabで枠を選択、Enter／Spaceで中央に仮置き、矢印キーで4px、Shift＋矢印で12px移動、Escapeで仮置き解除。
- フォーカス表示、形と色のラベル、選択状態、読み込み／保存ステータスの読み上げを用意しています。

## テスト

基本テスト（追加依存不要）：

```bash
npm test
```

ブラウザテスト：

```bash
npm install --no-save playwright
npx playwright install chromium
# 別のターミナルで python3 -m http.server 43240 --bind 127.0.0.1 を起動
npm run test:browser
# インストール済みChromeを使う場合
QA_BROWSER_CHANNEL=chrome npm run test:browser
```

`QA_BASE_URL` で別ポートに変更できます。`tests/browser.cjs` は隔離したテスト用ブラウザを起動し、**すべてのGAS通信を模擬バックエンドへ差し替えるため、本番に投稿しません**。スクリーンショットはgit対象外の `test-results/` に出力します。

チェック対象：16タイプ／48枠、四隅の貼付、二重クリック防止、新規保存と移動、再訪、自分だけの強調、キーボード、更新中の仮置き保持、保存拒否と再試行、一覧取得失敗と復旧、2ブラウザ同時投稿、結果確認不能とリロード復元、10分超の不明状態、320／390／768／1024／1440px表示、タッチ、デモの本番隔離、GAS未設定時のUI。

本番GASの読み取り接続は別途確認します。本番へのPOSTは、テスト用のゴミシールを残さないため、自動テストでは行いません。
