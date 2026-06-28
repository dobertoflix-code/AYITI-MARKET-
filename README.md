# AYITI-MARKET-

ayiti-market/
├── frontend/
│   └── index.html
├── backend/
│   ├── index.js
│   ├── package.json
│   └── .env.example
├── README.md
└── LICENSE

## Deplwaye Backend la (Render)

Frontend la deja konfigire pou rele `https://ayiti-market-40ce.onrender.com`
(gade `API_BASE` nan `frontend/index.html`). Pou backend la reyèlman reponn
lè frontend la rele l, fè etap sa yo:

1. **Pibliye repo a sou GitHub** (si li poko la).
2. Sou [render.com](https://render.com), kreye yon **New → Web Service**, konekte repo GitHub ou a.
3. Mete **Root Directory**: `backend`
4. **Build Command**: `npm install`
5. **Start Command**: `npm start`
6. Anba **Environment**, ajoute varyab sa yo (kopye soti nan `.env.example`):
   - `SUPABASE_URL` — URL pwojè Supabase ou a
   - `SUPABASE_SERVICE_KEY` — **service_role** key (Settings → API nan Supabase). Pa janm mete sa nan frontend la.
   - `FRONTEND_URL` — domèn egzak frontend ou a (ex. `https://ayiti-market.com`), pou CORS pa rete louvri pou tout moun.
7. Klike **Create Web Service**. Render ap bay ou yon URL (ex. `https://ayiti-market-40ce.onrender.com`).
8. Si URL Render ba ou a diferan de sa ki nan `frontend/index.html`, mete ajou `const API_BASE = '...'` nan frontend a pou matche l.
9. Teste: louvri `https://<URL-Render-ou>/health` nan navigatè — li dwe reponn `{"status":"ok"}`.

> ⚠️ Render gratis "dòmi" apre 15 min san trafik — premye rekèt apre sa ka pran 30-50 segond pou reveye sèvis la. Sa nòmal sou plan gratis.
