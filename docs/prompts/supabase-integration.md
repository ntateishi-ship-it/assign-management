# Supabase連携・管理者ログイン実装

## 概要
localStorageからSupabaseクラウドDBへの移行と管理者ログイン機能の追加

## Claude Codeへの指示文
```
既存のアサイン管理アプリのデータ保存先をlocalStorageからSupabaseに変更してください。

## 接続情報
SUPABASE_URL: https://iazqnnpfvuklyzxrtqrl.supabase.co
SUPABASE_ANON_KEY: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...（省略）

## テーブル構成（作成済み）
- engineers / projects / assignments / admins

## 変更内容
- supabase-jsをCDNから読み込む
- 全てのCRUD操作をSupabase APIに変更
- 既存のlocalStorageデータは初回起動時にSupabaseに移行
- 管理者ログイン機能（パスワード認証・権限による表示切り替え）
```

## 注意点
- 指示が大きすぎるとタイムアウトするので手順1〜4に分けて実行する
- JavaScriptはapp.jsに分離しておく
- file://では動かないのでnpx serve .で確認する