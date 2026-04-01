# Qibitech アサインシステム

## 会社概要
- 会社名：Qibitech（キビテク）
- 事業：ロボット遠隔制御システム「HATS」の開発
- 形態：スタートアップ

## このシステムの目的
- エンジニア約50名のアサイン状況を可視化・管理する社内ツール
- 受注済み・受注見込み案件への工数充足状況を週次で確認する
- 経営層・営業マネージャー・開発マネージャー・PMが閲覧する

## 技術スタック
- フロントエンド：HTML / CSS / JavaScript
- JavaScriptはapp.jsに分離済み、index.htmlと2ファイル構成
- データベース：Supabase（PostgreSQL）
- ホスティング：GitHub Pages
- リポジトリ：https://github.com/ntateishi-ship-it/assign-management

## Supabase接続情報
- URL：https://iazqnnpfvuklyzxrtqrl.supabase.co
- テーブル：engineers / projects / assignments
## 既知のバグ・修正履歴
- 2026/03/27 アサイン登録でUUID型変換バグを修正（Number()削除）
- 2026/03/27 node_modulesをgit管理から除外（.gitignore追加）
- 2026/03/28 Supabase CDN URLを正しいパスに修正
- 2026/03/28 JavaScriptをapp.jsに分離（index.htmlから切り出し）

## 今後の改修予定
- 案件登録フォームから売上項目を削除
- デザイン変更（Qibitechロゴ・緑カラーテーマへ）
- Vercelへの移行
- 個人アカウント付与・権限設計（管理者/マネージャー/本人）
- GoogleアカウントSSO対応
- パスワード変更機能の追加

## ローカル確認方法
- file://では動かないためnpx serve .でlocalhost:3000を使う
- GitHub Pages反映はgit push origin masterで自動

## 注意事項
- index.htmlとapp.jsの2ファイル構成を維持する
- Supabase UUIDは文字列のまま扱う（Number()変換しない）

## 本番URL
- Vercel（正式）：https://assign-management.vercel.app
- GitHub Pages：https://ntateishi-ship-it.github.io/assign-management/