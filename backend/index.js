import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();

// CORS: nan pwodiksyon, mete FRONTEND_URL nan varyab anviwònman an
// (egzanp: FRONTEND_URL=https://ayitimarket.ht)
// Si li pa konfigire, nou kite '*' tanporèman pou pa bloke devlopman lokal —
// men sa pa dwe rete konsa nan pwodiksyon reyèl.
const allowedOrigin = process.env.FRONTEND_URL || '*';
if (allowedOrigin === '*') {
  console.warn('⚠️  FRONTEND_URL pa konfigire — CORS louvri pou tout domèn. Mete FRONTEND_URL nan Render.');
}
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

// Verifye kle Supabase yo egziste anvan sèvè a demare
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL ak/oswa SUPABASE_SERVICE_KEY pa konfigire. Mete yo nan Environment Variables (Render) oswa nan fichye .env lokal.');
  process.exit(1);
}

// Kle yo viv isit sèlman — janm ale nan frontend
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service_role key — pi puisan
);

// ── ADMIN: lis imèl ki gen dwa admin ──────────────
// (Sekirite ki anplis lè ou ajoute oswa retire yon admin, mete ajou isit la TOU
//  ansanm ak supabase/admin.sql pou rete konsistan.)
const ADMIN_EMAILS = ['dobertojean35@gmail.com', 'jeandoberto55@gmail.com'];

async function requireAdmin(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'Pa otorize' }); return null; }
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) { res.status(401).json({ error: 'Sesyon ekspire' }); return null; }
  if (!ADMIN_EMAILS.includes(user.email)) { res.status(403).json({ error: 'Aksè refize — ou pa admin' }); return null; }
  return user;
}

// ── GET /api/listings ──────────────────────────────
app.get('/api/listings', async (req, res) => {
  const { category, location, sort, search, price_min, price_max, condition, days, dept } = req.query;

  let query = supabase
    .from('listings')
    .select('*')
    .eq('status', 'active') // moderasyon: piblik wè sèlman anons aktif (pa retire pa admin)
    .order('created_at', { ascending: false })
    .limit(200);

  // Filtre debaz
  if (category)  query = query.eq('category', category);
  if (location)  query = query.ilike('location', `%${location}%`);
  if (search)    query = query.or(
    `title.ilike.%${search}%,keywords.ilike.%${search}%,location.ilike.%${search}%`
  );
  if (sort === 'price_low') query = query.gt('price_val', 0).order('price_val', { ascending: true });

  // ── Filtre Avanse ──
  // Pri min/max (kolòn price_val)
  if (price_min && !isNaN(price_min)) query = query.gte('price_val', Number(price_min));
  if (price_max && !isNaN(price_max)) query = query.lte('price_val', Number(price_max));

  // Eta pwodwi (kolòn condition)
  if (condition) query = query.eq('condition', condition);

  // Depatman/vil (kolòn department — oswa location si pa gen kolòn depatman)
  if (dept) query = query.ilike('location', `%${dept}%`);

  // Dat pibliye — filtre sou created_at
  if (days && !isNaN(days)) {
    const since = new Date();
    since.setDate(since.getDate() - Number(days));
    query = query.gte('created_at', since.toISOString());
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Konbine ak profiles.is_verified_seller (vandè verifye pa admin),
  // san depann sou non egzak yon foreign key — 2 rekèt senp, pi solid.
  const sellerIds = [...new Set((data || []).map(row => row.seller_id).filter(Boolean))];
  let verifiedSellerIds = new Set();
  if (sellerIds.length > 0) {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, is_verified_seller')
      .in('id', sellerIds);
    (profilesData || []).forEach(p => { if (p.is_verified_seller) verifiedSellerIds.add(p.id); });
  }
  const enriched = (data || []).map(row => ({
    ...row,
    verified: !!row.verified || verifiedSellerIds.has(row.seller_id)
  }));

  res.json(enriched);
});

// ── GET /api/my-listings ───────────────────────────
// Tout anons PWOP itilizatè a (aktif + retire), pou paj "Mon Kont"
app.get('/api/my-listings', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('seller_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── POST /api/listings ─────────────────────────────
app.post('/api/listings', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  // Verifye itilizatè a
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const listing = { ...req.body, seller_id: user.id };
  const { data, error } = await supabase.from('listings').insert(listing).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── PUT /api/listings/:id ──────────────────────────
app.put('/api/listings/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  // Pa kite moun chanje seller_id/id pa erè oswa move zafè
  const { seller_id, id, created_at, ...updates } = req.body;

  const { data, error } = await supabase
    .from('listings')
    .update(updates)
    .eq('id', req.params.id)
    .eq('seller_id', user.id) // sèlman pwopriyetè a ka modifye
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(403).json({ error: 'Ou pa gen dwa modifye anons sa a' });
  res.json(data);
});

// ── DELETE /api/listings/:id ───────────────────────
app.delete('/api/listings/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Pa otorize' });

  const { error } = await supabase
    .from('listings')
    .delete()
    .eq('id', req.params.id)
    .eq('seller_id', user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── ADMIN: GET /api/admin/listings ─────────────────
// Tout anons (aktif + retire), san filtè status — sèlman pou admin
app.get('/api/admin/listings', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── ADMIN: PUT /api/admin/listings/:id/status ──────
// Mete yon anons 'active' oswa 'removed' (moderasyon apre)
app.put('/api/admin/listings/:id/status', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { status } = req.body;
  if (!['active', 'removed'].includes(status)) {
    return res.status(400).json({ error: "status dwe 'active' oswa 'removed'" });
  }

  const { data, error } = await supabase
    .from('listings')
    .update({ status })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Anons pa jwenn' });
  res.json(data);
});

// ── ADMIN: PUT /api/admin/profiles/:id/verify ──────
// Mete oswa retire badge "Vandè Verifye" sou yon pwofil
app.put('/api/admin/profiles/:id/verify', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { is_verified_seller } = req.body;
  if (typeof is_verified_seller !== 'boolean') {
    return res.status(400).json({ error: 'is_verified_seller dwe true oswa false' });
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ is_verified_seller })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Pwofil pa jwenn' });
  res.json(data);
});


app.get('/', (req, res) => res.json({ service: 'Ayiti Market API', status: 'ok' }));

// ── GET /health (pou Render konnen sèvis la vivan) ─
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ayiti Market API sou pò ${PORT}`));
