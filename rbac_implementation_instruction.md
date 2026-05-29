# アサイン管理アプリ：ロールベース権限制御（RBAC）実装指示書

## 概要

現在の単一パスワード認証（admin/閲覧者の2段階）を、3つの権限グループ（admin / planner / operator）によるロールベース権限制御に拡張する。

## 権限設計の思想

- 8つの業務ロールを3つの権限グループに集約し、メンテナンスを最小化する
- 「何ができるか」は権限グループで制御、「どの範囲が見えるか」はスコープで制御（スコープは今回未実装、将来対応）
- 新ロール追加時はグループ割当のみで対応可能にする

## 権限グループ定義

| グループ | できること | 該当ロール |
|---|---|---|
| admin | 全機能フルアクセス | 開発部M（CTO兼務）、CTO、人事、経営層 |
| planner | EG閲覧、候補サーチ、案件管理（担当PJ）、アサイン計画起草 | PM、EM |
| operator | EG閲覧（スキル・アサイン含む）、案件閲覧、実績更新、ダッシュボード | UM、営業M |

## 変更対象ファイル

1. **Supabase** — usersテーブル新設、adminsテーブル廃止
2. **app.js** — 認証ロジックの変更（約50行）
3. **index.html** — CSSクラス追加、ボタンへの権限クラス付与

---

## 1. Supabase: usersテーブル新設

Supabase管理画面のSQL Editorで以下を実行する。

```sql
-- usersテーブル作成
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  permission_group TEXT NOT NULL
    CHECK (permission_group IN ('admin', 'planner', 'operator')),
  scope TEXT DEFAULT 'all',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS有効化（anonキーでのアクセスを許可）
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon read for login" ON users
  FOR SELECT USING (true);

-- 既存adminユーザーを移行
INSERT INTO users (name, role, permission_group, password_hash)
SELECT '管理者', 'dev_manager', 'admin', password_hash
FROM admins LIMIT 1;

-- 動作確認後にadminsテーブルを削除（先にアプリ側の変更を完了してから）
-- DROP TABLE admins;
```

### ユーザー追加例（後で管理画面から追加する想定）

```sql
-- PMユーザー追加例
INSERT INTO users (name, email, role, permission_group, password_hash)
VALUES (
  '山田太郎',
  'yamada@qibitech.com',
  'pm',
  'planner',
  -- パスワード 'pm1234' のSHA-256ハッシュ
  'a5d091481045dcc76e2bcf1d528b1b3d38de0e786b13c67bca89a86b67c18bad'
);

-- 営業Mユーザー追加例
INSERT INTO users (name, email, role, permission_group, password_hash)
VALUES (
  '鈴木一郎',
  'suzuki@qibitech.com',
  'sales_manager',
  'operator',
  -- パスワード 'sales1234' のSHA-256ハッシュ
  -- 実際のハッシュはアプリのsha256関数で事前に生成すること
  ''
);
```

---

## 2. app.js: 認証ロジックの変更

### 2-1. 定数の変更（kibitech → qibitech）

ファイル内の `kibitech_` をすべて `qibitech_` に一括置換する。

```
kibitech_admin → （削除、下記に統合）
kibitech_ → qibitech_
```

### 2-2. 認証関数の書き換え

以下の関数を書き換える。

**変更前（現在のコード）:**

```javascript
function isAdmin() { return sessionStorage.getItem('kibitech_admin') === '1'; }
```

**変更後:**

```javascript
// ===== 権限グループ取得 =====
function getPermGroup() {
  return sessionStorage.getItem('qibitech_perm') || '';
}
function getCurrentUser() {
  const raw = sessionStorage.getItem('qibitech_user');
  return raw ? JSON.parse(raw) : null;
}
function isAdmin() { return getPermGroup() === 'admin'; }
function isPlanner() { return getPermGroup() === 'planner'; }
function isOperator() { return getPermGroup() === 'operator'; }
function isLoggedIn() { return !!getPermGroup(); }
// planner以上の権限があるか
function isPlannerUp() { return isAdmin() || isPlanner(); }
// operator以上の権限があるか（ログイン済みなら全員）
function isOperatorUp() { return isLoggedIn(); }
```

### 2-3. updateAuthUI() の書き換え

**変更前:**

```javascript
function updateAuthUI() {
  const admin = isAdmin();
  document.body.classList.toggle('is-admin', admin);
  const label = document.getElementById('auth-label');
  const btn   = document.getElementById('auth-btn');
  if (admin) {
    label.textContent = '🔓 管理者モード中';
    btn.textContent   = 'ログアウト';
    btn.classList.add('btn-header-logout');
  } else {
    label.textContent = '';
    btn.textContent   = '管理者ログイン';
    btn.classList.remove('btn-header-logout');
  }
}
```

**変更後:**

```javascript
function updateAuthUI() {
  const perm = getPermGroup();
  const user = getCurrentUser();

  // 権限クラスをリセット
  document.body.classList.remove('is-admin', 'perm-admin', 'perm-planner', 'perm-operator');

  // 後方互換: is-admin も維持
  if (perm === 'admin') {
    document.body.classList.add('perm-admin', 'is-admin');
  } else if (perm === 'planner') {
    document.body.classList.add('perm-planner');
  } else if (perm === 'operator') {
    document.body.classList.add('perm-operator');
  }

  const label = document.getElementById('auth-label');
  const btn   = document.getElementById('auth-btn');
  if (perm) {
    const roleLabel = {
      admin: '管理者',
      planner: 'プランナー',
      operator: 'オペレーター'
    }[perm] || perm;
    const userName = user?.name || '';
    label.textContent = `🔓 ${userName}（${roleLabel}）`;
    btn.textContent   = 'ログアウト';
    btn.classList.add('btn-header-logout');
  } else {
    label.textContent = '';
    btn.textContent   = 'ログイン';
    btn.classList.remove('btn-header-logout');
  }
}
```

### 2-4. doLogin() の書き換え

**変更前:**

```javascript
async function doLogin() {
  const pw = document.getElementById('login-pw').value;
  if (!pw) return;
  const hash = await sha256(pw);
  const {data, error} = await sb.from('admins').select('id').eq('password_hash', hash).maybeSingle();
  if (error || !data) {
    const el = document.getElementById('login-error');
    el.textContent = 'パスワードが正しくありません';
    el.style.display = 'block';
    return;
  }
  sessionStorage.setItem('kibitech_admin', '1');
  closeModal('login-modal');
  updateAuthUI();
}
```

**変更後:**

```javascript
async function doLogin() {
  const pw = document.getElementById('login-pw').value;
  if (!pw) return;
  const hash = await sha256(pw);
  const { data, error } = await sb
    .from('users')
    .select('id, name, role, permission_group, scope')
    .eq('password_hash', hash)
    .maybeSingle();
  if (error || !data) {
    const el = document.getElementById('login-error');
    el.textContent = 'パスワードが正しくありません';
    el.style.display = 'block';
    return;
  }
  sessionStorage.setItem('qibitech_perm', data.permission_group);
  sessionStorage.setItem('qibitech_user', JSON.stringify({
    id: data.id,
    name: data.name,
    role: data.role,
    scope: data.scope
  }));
  closeModal('login-modal');
  updateAuthUI();
}
```

### 2-5. onAuthBtnClick() の書き換え

**変更前:**

```javascript
function onAuthBtnClick() {
  if (isAdmin()) {
    if (confirm('ログアウトしますか？')) {
      sessionStorage.removeItem('kibitech_admin');
      updateAuthUI();
    }
  } else {
    document.getElementById('login-pw').value = '';
    document.getElementById('login-error').style.display = 'none';
    openModal('login-modal');
  }
}
```

**変更後:**

```javascript
function onAuthBtnClick() {
  if (isLoggedIn()) {
    if (confirm('ログアウトしますか？')) {
      sessionStorage.removeItem('qibitech_perm');
      sessionStorage.removeItem('qibitech_user');
      updateAuthUI();
    }
  } else {
    document.getElementById('login-pw').value = '';
    document.getElementById('login-error').style.display = 'none';
    openModal('login-modal');
  }
}
```

### 2-6. ensureDefaultAdmin() の書き換え

**変更前:**

```javascript
async function ensureDefaultAdmin() {
  const {data} = await sb.from('admins').select('id').limit(1);
  if (!data || data.length === 0) {
    const hash = await sha256('admin1234');
    await sb.from('admins').insert({password_hash: hash});
  }
}
```

**変更後:**

```javascript
async function ensureDefaultAdmin() {
  const { data } = await sb.from('users').select('id').limit(1);
  if (!data || data.length === 0) {
    const hash = await sha256('admin1234');
    await sb.from('users').insert({
      name: '管理者',
      role: 'dev_manager',
      permission_group: 'admin',
      password_hash: hash
    });
  }
}
```

---

## 3. index.html: CSSとHTMLの変更

### 3-1. CSSの追加

既存の `.is-admin` ルールの後に以下を追加する。既存の `.is-admin` ルールはそのまま残す（後方互換）。

```css
/* ===== RBAC権限制御 ===== */
/* デフォルト: 権限系ボタンはすべて非表示 */
.admin-only,
.planner-up,
.operator-up { display: none !important; }

/* admin: すべて表示 */
body.perm-admin .admin-only,
body.perm-admin .planner-up,
body.perm-admin .operator-up { display: initial !important; }

/* planner: planner-up と operator-up を表示 */
body.perm-planner .planner-up,
body.perm-planner .operator-up { display: initial !important; }

/* operator: operator-up のみ表示 */
body.perm-operator .operator-up { display: initial !important; }
```

### 3-2. HTMLボタンへの権限クラス付与

以下のボタン・要素に適切なクラスを追加する。

| 要素 | 現在のクラス | 追加するクラス |
|---|---|---|
| ＋ 新規案件登録ボタン | (既存) | `admin-only` |
| ＋ 新規エンジニア登録ボタン | (既存) | `admin-only` |
| ＋ アサイン登録ボタン | (既存) | `admin-only` |
| 案件の編集・削除ボタン | (既存) | `admin-only` |
| EGの編集・削除ボタン | (既存) | `admin-only` |
| アサインの編集・削除ボタン | (既存) | `admin-only` |
| 候補エンジニアサーチ機能 | (既存) | `planner-up` |

**注意:** 現在これらのボタンの表示制御は `body.is-admin` で行われている可能性がある。その場合、既存の `.is-admin` CSSルールはそのまま残し、`perm-admin` でも同じ効果が出るようにする（上記2-3で `is-admin` クラスも同時に付与している）。

### 3-3. ログインモーダルの変更

現在のモーダルタイトル「管理者ログイン」を「ログイン」に変更する。

```html
<!-- 変更前 -->
<h3>🔐 管理者ログイン</h3>

<!-- 変更後 -->
<h3>🔐 ログイン</h3>
```

---

## 4. テスト手順

1. Supabase SQLを実行してusersテーブルを作成
2. app.js と index.html を変更してデプロイ
3. 以下を確認:
   - admin1234 でログイン → 全機能が利用可能
   - usersテーブルに planner ユーザーを追加 → ログイン → 登録・削除ボタンが非表示、候補サーチは利用可能
   - usersテーブルに operator ユーザーを追加 → ログイン → 閲覧とダッシュボードのみ利用可能
   - ログアウト → すべてのボタンが非表示
4. 動作確認後、adminsテーブルを削除:
   ```sql
   DROP TABLE admins;
   ```

---

## 5. 今後の拡張予定（今回は未実装）

- **スコープ制御:** EM/UM/PMの閲覧範囲をチーム/PJ単位で制限
- **Google SSO:** Supabase Authによるログイン
- **ユーザー管理画面:** admin権限でユーザーの追加・編集・削除
- **パスワード変更機能:** ログイン後に自分のパスワードを変更
