import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();

// CORS: nan pwodiksyon, ranplase '*' ak domèn egzak frontend ou a
// egzanp: app.use(cors({ origin: 'https://ayitimarket.ht' }));
app.use(cors());
app.use(express.json());

// Kle yo viv isit sèlman — janm ale nan frontend
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service_role key — pi puisan
);

// ── GET /api/listings ──────────────────────────────
app.get('/api/listings', async (req, res) => {
  const { category, location, sort, search, price_min, price_max, condition, days, dept } = req.query;

  let query = supabase
    .from('listings')
    .select('*')
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

// ── GET /health (pou Render konnen sèvis la vivan) ─
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ayiti Market API sou pò ${PORT}`));
