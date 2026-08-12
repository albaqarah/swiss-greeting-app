# 🤖 Super Genius Bot — Polymarket Esports Bot (VPS)

Bot Polymarket kategori **esports** yang jalan sendiri di VPS kamu. Satu proses
Node (via `pm2`) menjalankan semuanya: mesin trading, REST API, dan dashboard
UI. Database pakai SQLite bawaan Node (`node:sqlite`) — **nol dependency
native**, tinggal `npm install` + `npm run build` + `pm2 start`.

```
├── ecosystem.config.cjs   ← config pm2
├── env.example            ← contoh config (copy ke .env)
├── server/                ← backend: bot engine + REST API (Node murni)
│   └── smoke.mjs          ← smoke test otomatis (npm run smoke -w server)
└── web/                   ← dashboard React (di-build ke web/dist)
```

Aturan bot:
- **Esports only** (Gamma tag 64), market resolve 1–24 jam
- **Entry hanya di bawah 5¢** (early entry)
- **Take profit 2×**, stop loss 25%, near-certain exit 95¢
- **Scan tiap 5 detik**, jalan terus 24/7 walau dashboard ditutup
- Default **DRY RUN** (paper trading $1.000 virtual) — live mode terpisah & butuh wiring

---

## 1. Prasyarat VPS

- VPS Linux (Ubuntu/Debian recommended), RAM ≥ 512MB sudah cukup
- **Node.js ≥ 22.5** (pakai Node 24 LTS biar paling aman)
- `git`, `npm`, dan `pm2` (global)

```bash
# install Node 24 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# pm2 global
sudo npm install -g pm2

# cek versi
node -v    # harus v22.5.0 atau lebih baru
```

⚠️ Pastikan VPS bisa akses `gamma-api.polymarket.com` dan `clob.polymarket.com`
(API publik Polymarket, tidak butuh API key).

---

## 2. Copy project ke VPS

```bash
# opsi A — git
git clone <repo-mu> /opt/genius-bot && cd /opt/genius-bot

# opsi B — scp dari laptop
scp -r . root@IP_VPS:/opt/genius-bot/
```

Jangan pernah commit `.env` ke git — `.env` sudah di-`.gitignore`, dan template
config-nya ada di `env.example` (copy, bukan rename).

---

## 3. Install & build

```bash
cd /opt/genius-bot
npm install        # install server + web (workspaces)
npm run build      # compile server + build dashboard
```

Cek cepat dulu (opsional tapi recommended — mengetes server + API + 1 tick
ke Polymarket pakai database sementara):

```bash
npm run smoke -w server
```

Harusnya berakhir dengan `SMOKE TEST PASSED ✓`.

---

## 4. Config

```bash
cp env.example .env
nano .env
```

Yang wajib diganti:

| Variable | Wajib? | Keterangan |
|---|---|---|
| `ADMIN_PIN` | ✅ wajib | PIN buat login dashboard — **ganti!** |
| `PORT` | default 3456 | port server |
| `HOST` | default `0.0.0.0` | biar bisa diakses dari luar; `127.0.0.1` kalau mau lokal-only |
| `BOT_MODE` | default `dry` | `dry` = paper trading. **Jangan `live` dulu!** |
| `SCAN_INTERVAL_MS` | default 5000 | jeda scan |

Sisanya (`POLY_*`) kosongin dulu — cuma dipakai pas live mode nanti.

---

## 5. Jalankan via pm2

```bash
cd /opt/genius-bot
pm2 start ecosystem.config.cjs
pm2 save                  # simpan daftar proses
pm2 startup               # auto-start setelah VPS reboot (ikuti instruksinya)
```

Cek status:

```bash
pm2 status                # genius-bot online
pm2 logs genius-bot       # lihat log bot (scan, entry, error)
```

---

## 6. Buka dashboard

Buka `http://IP_VPS:3456` di browser → login pakai `ADMIN_PIN`.

Yang bisa kamu lakukan:
1. **Arm bot** (switch merah di kiri atas) → bot mulai scan tiap 5 detik.
2. Lihat **Live markets** (esports, resolve ≤ 24 jam), **Positions**, dan
   **Genius journal** (log + trades).
3. Tombol **Run genius now** = paksa 1 tick langsung.
4. **Close all** = tutup semua posisi di harga market (history tetap ada).
   **Reset account** = balikin ke $1.000 dan hapus semua history.

Header dashboard nunjukin mode: **DRY RUN · PAPER** (biru) vs **LIVE** (merah).

---

## 7. Update bot

```bash
cd /opt/genius-bot
git pull                     # atau scp ulang file yang berubah
npm install && npm run build
pm2 restart genius-bot
pm2 logs genius-bot          # cek boot sukses
```

Database (`data/genius.db`) **tidak ikut kehapus** — posisi & journal aman.

---

## 8. Mode LIVE (real money) — BACA DULU

Bot di-ship dengan **live execution yang sengaja BELUM di-wire**. `BOT_MODE=live`
tanpa wiring = bot menolak trading dan tetap dry (aman, log-nya jelas).

Alurnya yang aman:

1. **Dry run dulu minimal beberapa hari** sampai pola entry/TP-nya konsisten
   dan kamu paham cara baca journal.
2. Siapkan wallet Polymarket: deposit USDC ke address Polymarket kamu
   (https://polymarket.com/profile), lalu buat **API Key** (CLOB API keys).
   Kamu butuh: `POLY_API_KEY`, `POLY_API_SECRET`, `POLY_API_PASSPHRASE`,
   `POLY_WALLET_ADDRESS`, dan private key wallet (`POLY_PRIVATE_KEY`).
3. **Wiring live execution** ke bridge di `server/src/live.ts` pakai SDK resmi
   Polymarket (`@polymarket/client`) — minta dibantuin dulu, jangan di-skip.
   Bridge ini yang ngepasang order beneran; sampai itu diisi, bot gak akan
   pernah keluar uang.
4. Set `BOT_MODE=live`, isi keys di `.env`, set `POLY_MAX_ORDER_USD` kecil
   (misal 1–10), restart pm2, dan tes dengan ukuran sekecil mungkin.

> Jangan pernah taruh private key di tempat lain atau commit `.env` ke git.
> `.env` sudah di-gitignore.

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| `pm2 status` merah / restart loop | `pm2 logs genius-bot` → cek error; pastikan `npm run build` sudah jalan |
| Port keblokir | `sudo ufw allow 3456/tcp` (atau pakai reverse proxy) |
| Dashboard kosong / 404 | `WEB_DIR` di `.env` harus `web/dist`, dan `npm run build -w web` sudah jalan |
| Node < 22.5 | `node:sqlite` gak ada → upgrade Node (lihat step 1) |
| Bot gak pernah entry | Itu normal — filter ketat (≤5¢ + signal kuat + esports 1–24 jam). Cek journal buat alasan skip tiap tick |
| Lupa PIN | Edit `ADMIN_PIN` di `.env` → `pm2 restart genius-bot` |
| Mau akses via domain + HTTPS | Pasang Caddy/nginx reverse proxy ke `127.0.0.1:3456` |

---

## Catatan keamanan

- **Ganti `ADMIN_PIN`** sebelum expose ke internet.
- Dashboard cuma dilindungi PIN + cookie session (7 hari). Kalau VPS-mu
  publik, pasang reverse proxy + HTTPS (Caddy = paling gampang, 1 baris config).
- Bot ini **bukan nasihat keuangan**. Esports market volatile; live mode = uang asli.
