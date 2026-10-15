# ◈ WebBox

Single-file HTML manager — installable PWA, cloud sync, publish apps with mobile + PIN login.

**2 files needed:** `index.html` + `sw.js`

---

## ✨ Features

- 📦 Unlimited HTML storage (IndexedDB)
- 💾 Auto-captures forms, `localStorage`, `sessionStorage`
- ☁️ Cloud sync (Supabase, email + password)
- 🌐 Publish apps with **mobile + 4-digit PIN** login
- 📲 Installable PWA — offline-first
- 🎨 Emoji/image icons, tags, folders, favorites, color labels, notes
- 🗑️ Trash (30 days), search, QR codes, bundle sharing
- 🌐 Portable HTML export, JSON backup/restore

---

## 🚀 Setup

### 1. Run locally
```bash
python3 -m http.server 8000
```

### 2. Configure Supabase (optional — skip for offline-only)
In `index.html`:
```js
const SUPABASE_URL      = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```

### 3. Deploy to GitHub Pages
```bash
git init && git add . && git commit -m "WebBox"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```
Settings → **Pages** → Branch `main` / root → Save.  
URL: `https://<user>.github.io/<repo>/`

**HTTPS required for PWA.**

---

## 📲 Install

| Platform | Steps |
|---|---|
| Android Chrome | **Install** banner or ⋮ → *Install app* |
| Desktop Chrome/Edge | **⊕** in address bar |
| iOS Safari | Share → *Add to Home Screen* |

Dev helpers: `WebBoxPWA.resetInstallBanner()` · `WebBoxPWA.clearCaches()`

---

## 🗄 Supabase Schema

SQL Editor → New Query → paste & Run:

```sql
create extension if not exists pgcrypto;

-- Owner cloud sync
create table public.webbox_sync (
  sync_key text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  device_name text,
  updated_at timestamptz not null default now()
);
alter table public.webbox_sync enable row level security;
create policy "own" on public.webbox_sync for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Published apps
create table public.published_apps (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  owner_id uuid references auth.users(id) on delete cascade,
  owner_email text,
  name text not null default 'Untitled',
  content text not null default '',
  icon text,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.published_apps enable row level security;
create policy "pub_r" on public.published_apps for select using (active = true);
create policy "own"   on public.published_apps for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Bundles
create table public.published_bundles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  owner_id uuid references auth.users(id) on delete cascade,
  owner_email text,
  name text default 'My WebBox',
  app_slugs jsonb default '[]'::jsonb,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.published_bundles enable row level security;
create policy "pub_r" on public.published_bundles for select using (active = true);
create policy "own"   on public.published_bundles for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Public users (mobile + PIN)
create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  mobile text unique not null,
  pin_hash text not null,
  created_at timestamptz default now(),
  last_login timestamptz
);

create table public.app_entries (
  id uuid primary key default gen_random_uuid(),
  app_id uuid references public.published_apps(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete cascade,
  state jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique(app_id, user_id)
);

-- Pin hash helper
create or replace function public._pin_hash(pin text)
returns text language sql immutable as $$
  select encode(digest(pin, 'sha256'), 'hex');
$$;

-- Signup
create or replace function public.app_signup(p_mobile text, p_pin text)
returns jsonb language plpgsql security definer as $$
declare v_id uuid;
begin
  if length(p_mobile) < 6 then return jsonb_build_object('ok', false, 'error', 'Mobile too short'); end if;
  if length(p_pin) <> 4 then return jsonb_build_object('ok', false, 'error', 'PIN must be 4 digits'); end if;
  if exists (select 1 from public.app_users where mobile = p_mobile) then
    return jsonb_build_object('ok', false, 'error', 'Already registered');
  end if;
  insert into public.app_users (mobile, pin_hash)
  values (p_mobile, public._pin_hash(p_pin)) returning id into v_id;
  return jsonb_build_object('ok', true, 'user_id', v_id, 'mobile', p_mobile);
end; $$;

-- Login
create or replace function public.app_login(p_mobile text, p_pin text)
returns jsonb language plpgsql security definer as $$
declare v_user public.app_users; v_token text;
begin
  select * into v_user from public.app_users where mobile = p_mobile;
  if not found then return jsonb_build_object('ok', false, 'error', 'Not registered'); end if;
  if v_user.pin_hash <> public._pin_hash(p_pin) then
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;
  update public.app_users set last_login = now() where id = v_user.id;
  v_token := encode(digest(v_user.id::text || 'webbox-salt', 'sha256'), 'hex');
  return jsonb_build_object('ok', true, 'user_id', v_user.id,
    'mobile', v_user.mobile, 'token', v_token);
end; $$;

-- Get entries
create or replace function public.app_get_entries(p_app_id uuid, p_token text)
returns jsonb language plpgsql security definer as $$
declare v_user_id uuid; v_state jsonb;
begin
  select id into v_user_id from public.app_users
  where encode(digest(id::text || 'webbox-salt', 'sha256'), 'hex') = p_token;
  if v_user_id is null then return jsonb_build_object('ok', false, 'error', 'Invalid token'); end if;
  select state into v_state from public.app_entries
  where app_id = p_app_id and user_id = v_user_id;
  return jsonb_build_object('ok', true, 'state', coalesce(v_state, '{}'::jsonb));
end; $$;

-- Save entries
create or replace function public.app_save_entries(p_app_id uuid, p_token text, p_state jsonb)
returns jsonb language plpgsql security definer as $$
declare v_user_id uuid;
begin
  select id into v_user_id from public.app_users
  where encode(digest(id::text || 'webbox-salt', 'sha256'), 'hex') = p_token;
  if v_user_id is null then return jsonb_build_object('ok', false, 'error', 'Invalid token'); end if;
  insert into public.app_entries (app_id, user_id, state, updated_at)
  values (p_app_id, v_user_id, p_state, now())
  on conflict (app_id, user_id) do update
    set state = excluded.state, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- Admin (owner only, read-only)
create or replace function public.admin_list_app_entries(p_app_id uuid)
returns jsonb language plpgsql security definer as $$
declare v_owner uuid; v_result jsonb;
begin
  select owner_id into v_owner from public.published_apps where id = p_app_id;
  if v_owner is null or v_owner <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'Not authorized');
  end if;
  select jsonb_agg(jsonb_build_object(
    'entry_id', e.id, 'user_id', u.id, 'mobile', u.mobile,
    'state', e.state, 'updated_at', e.updated_at
  ) order by e.updated_at desc) into v_result
  from public.app_entries e
  join public.app_users u on u.id = e.user_id
  where e.app_id = p_app_id;
  return jsonb_build_object('ok', true, 'entries', coalesce(v_result, '[]'::jsonb));
end; $$;
```

**Then:** Authentication → Providers → Email → Enable

---

## 🌐 Publishing

**Single:** Card ⋮ → *Publish & Share* → `#/p/<slug>` + QR  
**Bundle:** Menu → *🎁 Share Whole WebBox* → `#/b/<slug>` (⚠️ no entries)  
**Unpublish:** Card ⋮ → *Unpublish*

Recipient flow: mobile → 4-digit PIN → app opens → data saved separately per user.

---

## 👑 Admin Panel (Private)

> ⚠️ **Owner only** — hidden unless logged in with owner email. Never shown to mobile+PIN users.

**Access:** Menu → 👑 Admin Panel

**Shows:** All published apps → all users (mobile) → their saved entries (read-only JSON).

**Safety layers:**
| Layer | Protection |
|---|---|
| UI | Hidden without owner `currentUser` |
| RLS | `published_apps` select restricted to owner |
| RPC | `admin_list_app_entries` checks `auth.uid() = owner_id` |
| Writes | Read-only — no modify/delete |

**Example:**
```
👑 Admin Panel
├ 📄 Invoice Generator  → slug: k3x9f2  → 12 users
├ 📄 Quiz App (⛔)      → slug: z7a1b5  → 34 users
└ 📄 Daily Tracker      → slug: p8m2n4  → 7 users
```

---

## 📖 Usage

**Add:** `+` → Upload file or Paste code  
**Organize:** Folders (top bar), tags, favorites, color labels, notes  
**Batch:** Long-press / right-click card → multi-select  
**Edit code:** Card ⋮ → ✏️ Edit HTML

**Auto-capture works with:** native forms, React/Vue/Svelte, localStorage apps  
**Not captured:** canvas, IndexedDB, file inputs

**Shortcuts:** `/` search · `N` new · `Ctrl+B` batch · `Esc` close

---

## 🛠 Troubleshooting

| Issue | Fix |
|---|---|
| Setup banner | Re-run SQL → ☁️ → Re-check Setup |
| Install icon missing | Check HTTPS + `/sw.js` loads + manifest valid |
| iOS prompt missing | Use **Safari** (not Chrome-iOS) |
| Entries not syncing | Check `app_entries` table + browser console |
| Offline error | First visit must be online |
| Update app | Bump `VERSION` in `sw.js` → push |

Force clear: `WebBoxPWA.clearCaches()` → reload

---

## 🧱 Stack

Vanilla JS · IndexedDB · Supabase (Postgres + Auth + RLS + RPC) · Service Worker · Canvas icons

---

## 📜 License

MIT © 2026 WebBox