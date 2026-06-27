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

// ── JEYOLOKALIZASYON: distans ant 2 pwen (fòmil Haversine, an km) ──
// Sèvi pou filtraj "Toupre m" — montre anons nan yon rayon bay (defo 10km).
function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // reyon tè a an km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
  const { category, location, sort, search, price_min, price_max, condition, days, dept, lat, lng, radius } = req.query;

  const now = new Date().toISOString();
  let query = supabase
    .from('listings')
    .select('*')
    .eq('status', 'active') // moderasyon: piblik wè sèlman anons aktif (pa retire pa admin)
    .or(`featured_until.is.null,featured_until.gt.${now}`) // eskli vedèt ekspire
    .order('boost_tier', { ascending: false }) // vedèt parèt an premye
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

  // ── Filtraj "Toupre m" — sèlman anons nan yon rayon (defo 10km) ──
  // Mande lat + lng (pozisyon itilizatè a). Anons ki pa gen lat/lng pa parèt.
  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  if (!isNaN(userLat) && !isNaN(userLng)) {
    const radiusKm = (radius && !isNaN(radius)) ? Number(radius) : 10;
    const withinRadius = enriched
      .filter(row => row.lat != null && row.lng != null)
      .map(row => ({ ...row, distance_km: distanceKm(userLat, userLng, row.lat, row.lng) }))
      .filter(row => row.distance_km <= radiusKm)
      // Vedèt yo rete an premye; pami yo, pi pre a anvan
      .sort((a, b) => (b.boost_tier || 0) - (a.boost_tier || 0) || a.distance_km - b.distance_km);

    return res.json(withinRadius);
  }

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

// ── ADMIN: PUT /api/admin/listings/:id/feature ─────
// Aktive oswa dezaktive vedèt pou yon anons
// Body: { tier: 0|1|2, days: 7|14|30, notes: "MonCash #xxx", price_htg: 500 }
app.put('/api/admin/listings/:id/feature', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { tier = 0, days = 7, notes = '', price_htg = 0 } = req.body;

  if (![0, 1, 2].includes(tier))
    return res.status(400).json({ error: 'tier dwe 0, 1, oswa 2' });

  // Kalkile dat ekspire
  const expires = new Date();
  expires.setDate(expires.getDate() + Number(days));

  // Mete ajou anons la
  const { data, error } = await supabase
    .from('listings')
    .update({
      is_featured:    tier > 0,
      boost_tier:     tier,
      featured_until: tier > 0 ? expires.toISOString() : null
    })
    .eq('id', req.params.id)
    .select('id, title, seller_id, boost_tier, featured_until')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Anons pa jwenn' });

  // Anrejistre nan istwa promotions (sèlman si nou aktive, pa si nou retire)
  if (tier > 0 && data.seller_id) {
    await supabase.from('promotions').insert({
      listing_id: req.params.id,
      seller_id:  data.seller_id,
      tier,
      price_htg:  Number(price_htg),
      expires_at: expires.toISOString(),
      notes:      notes || null
    });
  }

  res.json({ success: true, listing: data });
});

// ── ADMIN: POST /api/admin/expire-featured ─────────
// Dezaktive manwèlman tout vedèt ki ekspire (backup si cron pa konfigire)
app.post('/api/admin/expire-featured', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { error } = await supabase.rpc('expire_featured_listings');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'Vedèt ekspire yo retire' });
});

// ── GET /api/promotions/my ─────────────────────────
// Istwa pwomosyon yon vandè (pou li wè nan kont li)
app.get('/api/promotions/my', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const { data, error } = await supabase
    .from('promotions')
    .select('id, listing_id, tier, price_htg, paid_at, expires_at, notes')
    .eq('seller_id', user.id)
    .order('paid_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});


// ══════════════════════════════════════════════════════
// REVIEWS & RATINGS
// ══════════════════════════════════════════════════════


// ── GET /api/reviews/:sellerId ─────────────────────
// Tout reviews pou yon vandè (piblik)
app.get('/api/reviews/:sellerId', async (req, res) => {
  const { sellerId } = req.params;
  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, comment, reviewer_name, created_at, listing_id, reviewer_id, seller_response')
    .eq('seller_id', sellerId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });

  // Stats: mwayèn + kantite
  const reviews = data || [];
  const count = reviews.length;
  const avg = count > 0
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10
    : 0;

  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  reviews.forEach(r => { if (dist[r.rating] !== undefined) dist[r.rating]++; });

  res.json({ reviews, count, avg, dist });
});

// ── POST /api/reviews ──────────────────────────────
// Kite yon review (itilizatè konekte sèlman, pa vandè li menm)
app.post('/api/reviews', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Ou dwe konekte pou kite yon kòmantè.' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire. Konekte ankò.' });

  const { seller_id, listing_id, rating, comment } = req.body;

  // Validasyon
  if (!seller_id) return res.status(400).json({ error: 'seller_id obligatwa.' });
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Rating dwe ant 1 ak 5.' });
  if (user.id === seller_id)
    return res.status(403).json({ error: 'Ou pa ka kite yon kòmantè sou pwòp pwofil ou.' });

  // Non reviewer a
  const { data: profData } = await supabase
    .from('profiles').select('full_name').eq('id', user.id).single();
  const reviewer_name = profData?.full_name || user.user_metadata?.full_name || 'Itilizatè';

  const { data, error } = await supabase
    .from('reviews')
    .upsert(
      { seller_id, reviewer_id: user.id, listing_id: listing_id || null,
        rating, comment: comment?.trim() || null, reviewer_name },
      { onConflict: 'seller_id,reviewer_id' }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE /api/reviews/:reviewId ─────────────────
// Efase pwòp review pa yo
app.delete('/api/reviews/:reviewId', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const { error } = await supabase
    .from('reviews')
    .delete()
    .eq('id', req.params.reviewId)
    .eq('reviewer_id', user.id); // sèlman pwopriyetè a

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── ADMIN: DELETE /api/admin/reviews/:reviewId ─────
// Admin ka efase nenpòt review abizif
app.delete('/api/admin/reviews/:reviewId', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { error } = await supabase
    .from('reviews').delete().eq('id', req.params.reviewId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});


// ══════════════════════════════════════════════════════
// CHAT / MESAJ
// ══════════════════════════════════════════════════════

// Fonksyon pou verifye token ak retounen user
async function requireAuth(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'Pa otorize' }); return null; }
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) { res.status(401).json({ error: 'Sesyon ekspire' }); return null; }
  return user;
}

// ── POST /api/conversations ────────────────────────
// Kreye yon nouvo konvèsasyon oswa retounen sa ki deja egziste
// Body: { seller_id, listing_id }
app.post('/api/conversations', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { seller_id, listing_id } = req.body;
  if (!seller_id) return res.status(400).json({ error: 'seller_id obligatwa' });
  if (user.id === seller_id) return res.status(400).json({ error: 'Ou pa ka kòmanse yon chat ak tèt ou' });

  // Chèche si konvèsasyon an deja egziste
  const { data: existing } = await supabase
    .from('conversations')
    .select('*')
    .eq('buyer_id', user.id)
    .eq('seller_id', seller_id)
    .eq('listing_id', listing_id || null)
    .maybeSingle();

  if (existing) return res.json(existing);

  // Kreye nouvo konvèsasyon
  const { data, error } = await supabase
    .from('conversations')
    .insert({ buyer_id: user.id, seller_id, listing_id: listing_id || null })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /api/conversations ─────────────────────────
// Tout konvèsasyon yon itilizatè (kòm achtè oswa vandè)
// ak dènye mesaj + kantite pa li
app.get('/api/conversations', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { data: convs, error } = await supabase
    .from('conversations')
    .select(`
      id, listing_id, buyer_id, seller_id, created_at, last_msg_at,
      listings ( title, images )
    `)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order('last_msg_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });

  // Pou chak konvèsasyon: dènye mesaj + unread count + non lòt moun nan
  const convIds = (convs || []).map(c => c.id);
  const otherIds = [...new Set((convs || []).map(c =>
    c.buyer_id === user.id ? c.seller_id : c.buyer_id
  ))];

  // Dènye mesaj pou chak konvèsasyon
  const { data: lastMsgs } = await supabase
    .from('messages')
    .select('conversation_id, body, file_type, created_at')
    .in('conversation_id', convIds.length ? convIds : ['none'])
    .order('created_at', { ascending: false });

  // Nombre mesaj pa li pou itilizatè a
  const { data: reads } = await supabase
    .from('message_reads')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id)
    .in('conversation_id', convIds.length ? convIds : ['none']);

  const { data: msgCounts } = await supabase
    .from('messages')
    .select('conversation_id, sender_id, created_at')
    .in('conversation_id', convIds.length ? convIds : ['none'])
    .neq('sender_id', user.id);

  // Non + avatar lòt moun yo
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', otherIds.length ? otherIds : ['none']);

  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p.full_name || 'Itilizatè'; });

  const lastMsgMap = {};
  (lastMsgs || []).forEach(m => {
    if (!lastMsgMap[m.conversation_id]) lastMsgMap[m.conversation_id] = m;
  });

  const readMap = {};
  (reads || []).forEach(r => { readMap[r.conversation_id] = r.last_read_at; });

  // Kalkile unread pou chak konvèsasyon
  const unreadMap = {};
  (msgCounts || []).forEach(m => {
    const lastRead = readMap[m.conversation_id];
    if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
      unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] || 0) + 1;
    }
  });

  const enriched = (convs || []).map(c => {
    const otherId = c.buyer_id === user.id ? c.seller_id : c.buyer_id;
    const last    = lastMsgMap[c.id];
    return {
      ...c,
      other_name:  profileMap[otherId] || 'Itilizatè',
      other_id:    otherId,
      last_body:   last?.body || (last?.file_type === 'image' ? '📷 Foto' : '📎 Fichye'),
      last_msg_at: last?.created_at || c.last_msg_at,
      unread:      unreadMap[c.id] || 0,
    };
  });

  res.json(enriched);
});

// ── GET /api/conversations/:id/messages ───────────
// Tout mesaj nan yon konvèsasyon + mak kòm li
app.get('/api/conversations/:id/messages', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  // Verifye ke itilizatè a nan konvèsasyon an
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, buyer_id, seller_id')
    .eq('id', req.params.id)
    .maybeSingle();

  if (!conv) return res.status(404).json({ error: 'Konvèsasyon pa jwenn' });
  if (![conv.buyer_id, conv.seller_id].includes(user.id))
    return res.status(403).json({ error: 'Aksè refize' });

  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_id, body, file_url, file_name, file_type, created_at')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });

  // Mak konvèsasyon kòm li (upsert last_read_at)
  await supabase
    .from('message_reads')
    .upsert({ conversation_id: req.params.id, user_id: user.id, last_read_at: new Date().toISOString() },
             { onConflict: 'conversation_id,user_id' });

  res.json(data);
});

// ── POST /api/messages ─────────────────────────────
// Voye yon mesaj (tèks oswa fichye)
// Body: { conversation_id, body?, file_url?, file_name?, file_type? }
app.post('/api/messages', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { conversation_id, body, file_url, file_name, file_type } = req.body;
  if (!conversation_id) return res.status(400).json({ error: 'conversation_id obligatwa' });
  if (!body && !file_url) return res.status(400).json({ error: 'Mesaj vid' });

  // Verifye ke itilizatè a nan konvèsasyon an
  const { data: conv } = await supabase
    .from('conversations')
    .select('buyer_id, seller_id')
    .eq('id', conversation_id)
    .maybeSingle();

  if (!conv || ![conv.buyer_id, conv.seller_id].includes(user.id))
    return res.status(403).json({ error: 'Aksè refize' });

  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id,
      sender_id: user.id,
      body: body?.trim() || null,
      file_url:   file_url  || null,
      file_name:  file_name || null,
      file_type:  file_type || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── PUT /api/conversations/:id/read ───────────────
// Mak yon konvèsasyon kòm li (rele lè itilizatè a ouvri chat la)
app.put('/api/conversations/:id/read', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { error } = await supabase
    .from('message_reads')
    .upsert(
      { conversation_id: req.params.id, user_id: user.id, last_read_at: new Date().toISOString() },
      { onConflict: 'conversation_id,user_id' }
    );

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── GET /api/unread-count ──────────────────────────
// Kantite total mesaj pa li (pou badge navbar)
app.get('/api/unread-count', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  // Jwenn tout konvèsasyon itilizatè a
  const { data: convs } = await supabase
    .from('conversations')
    .select('id')
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

  const convIds = (convs || []).map(c => c.id);
  if (convIds.length === 0) return res.json({ count: 0 });

  // Dènye read pou chak konvèsasyon
  const { data: reads } = await supabase
    .from('message_reads')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id)
    .in('conversation_id', convIds);

  const readMap = {};
  (reads || []).forEach(r => { readMap[r.conversation_id] = r.last_read_at; });

  // Mesaj voye pa lòt moun yo
  const { data: msgs } = await supabase
    .from('messages')
    .select('conversation_id, created_at')
    .in('conversation_id', convIds)
    .neq('sender_id', user.id);

  let total = 0;
  (msgs || []).forEach(m => {
    const lastRead = readMap[m.conversation_id];
    if (!lastRead || new Date(m.created_at) > new Date(lastRead)) total++;
  });

  res.json({ count: total });
});



// ════════════════════════════════════════════════════
// RECHÈCH PA FOTO — Vision AI
// ════════════════════════════════════════════════════

// ── POST /api/search-by-image ──────────────────────
// Resevwa yon foto (base64), mande Gemini Vision idantifye pwodwi a,
// retounen mo-kle + kategori pou rechèch
app.post('/api/search-by-image', async (req, res) => {
  const { image_base64, media_type = 'image/jpeg' } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'Foto obligatwa' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'Vision AI pa konfigire' });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: { mime_type: media_type, data: image_base64 }
              },
              {
                text: `Gade foto sa a epi idantifye pwodwi oswa objè prensipal la.
Retounen sèlman yon objè JSON konsa (pa gen tèks anvan oswa apre, pa gen backticks):
{
  "query": "non pwodwi a an kreyòl oswa fransè (2-4 mo)",
  "category": "youn nan: Elektwonik, Vwati & Moto, Imobilye, Mòd & Rad, Sèvis, Manje & Bwason, Espò & Lojis, Materyèl & Konstriksyon, Bèt & Plante, Lòt",
  "description": "yon fraz kout (max 12 mo) ki dekri sa ou wè"
}`
              }
            ]
          }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.1 }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API ${response.status}: ${errText}`);
    }

    const aiData = await response.json();
    const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    let parsed = {};
    try { parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); }
    catch { parsed = { query: '', category: 'Lòt', description: 'Pa ka idantifye' }; }

    res.json(parsed);
  } catch (err) {
    console.error('Vision error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ── PUT /api/reviews/:reviewId/response ───────────────────────────
// Vandè ka ajoute yon repons sou yon review ki di yo (1 fwa)
app.put('/api/reviews/:reviewId/response', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const { response } = req.body;
  if (!response || !response.trim()) return res.status(400).json({ error: 'Repons pa ka vid' });
  if (response.trim().length > 800) return res.status(400).json({ error: 'Repons twò long (max 800 karaktè)' });

  // Verifye review a reyèlman pou vandè sa a
  const { data: rev, error: revErr } = await supabase
    .from('reviews').select('id, seller_id, seller_response').eq('id', req.params.reviewId).single();
  if (revErr || !rev) return res.status(404).json({ error: 'Review pa jwenn' });
  if (rev.seller_id !== user.id) return res.status(403).json({ error: 'Ou pa vandè yo evalye a' });

  const { error } = await supabase
    .from('reviews').update({ seller_response: response.trim() }).eq('id', req.params.reviewId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── SEO: paj sèvè pou chak anons (/anons/:id/:slug) ─
function slugify(text) {
  return (text || 'anons')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'anons';
}

function escapeHtml(str) {
  return (str || '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

app.get('/anons/:id/:slug?', async (req, res) => {
  const { id, slug } = req.params;
  const frontendUrl = (process.env.FRONTEND_URL || 'https://ayitimarket.ht').replace(/\/$/, '');

  const { data: item, error } = await supabase
    .from('listings')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !item) {
    return res.status(404).send(`<!DOCTYPE html><html lang="ht"><head><meta charset="utf-8">
      <title>Anons pa jwenn — Ayiti Market</title>
      <meta name="robots" content="noindex">
      <meta http-equiv="refresh" content="2;url=${frontendUrl}/">
      </head><body>Anons sa a pa egziste ankò oswa li retire. Ou pral retounen sou Ayiti Market...</body></html>`);
  }

  const correctSlug = slugify(`${item.title}-${item.location || ''}`);
  if (slug !== correctSlug) {
    return res.redirect(301, `/anons/${id}/${correctSlug}`);
  }

  const priceText = item.price_label || (item.price_val ? `${Number(item.price_val).toLocaleString('fr-FR')} HTG` : 'Sou demann');
  const title = `${item.title} — ${priceText} | Ayiti Market`;
  const description = (item.description || `${item.title} disponib sou Ayiti Market nan ${item.location || 'Ayiti'}.`).slice(0, 160);
  const image = (item.images && item.images.length) ? item.images[0] : `${frontendUrl}/og-image.jpg`;
  const canonicalUrl = `${frontendUrl}/anons/${id}/${correctSlug}`;
  const appUrl = `${frontendUrl}/?anons=${id}`;

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: item.title,
    description: item.description || '',
    image: (item.images && item.images.length) ? item.images : [image],
    offers: {
      '@type': 'Offer',
      price: item.price_val || undefined,
      priceCurrency: 'HTG',
      availability: item.is_sold ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
      url: canonicalUrl
    },
    ...(item.condition ? { itemCondition: `https://schema.org/${item.condition === 'Nèf' ? 'NewCondition' : 'UsedCondition'}` } : {})
  };

  res.send(`<!DOCTYPE html>
<html lang="ht">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:type" content="product">
<meta property="og:title" content="${escapeHtml(item.title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${canonicalUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(item.title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#1a1a2e;line-height:1.6}
  img{width:100%;border-radius:12px;max-height:420px;object-fit:cover;background:#eee}
  .price{font-size:1.6rem;font-weight:800;color:#0a8;margin:12px 0 4px}
  .meta{color:#666;font-size:0.92rem;margin-bottom:18px}
  .btn{display:inline-block;background:#1a1a2e;color:#fff;padding:14px 26px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:18px}
  .desc{white-space:pre-wrap;margin-top:16px}
</style>
</head>
<body>
  <img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)}">
  <h1>${escapeHtml(item.title)}</h1>
  <div class="price">${escapeHtml(priceText)}</div>
  <div class="meta">${escapeHtml(item.location || '')}${item.condition ? ' · ' + escapeHtml(item.condition) : ''}${item.category ? ' · ' + escapeHtml(item.category) : ''}</div>
  <p class="desc">${escapeHtml(item.description || '')}</p>
  <a class="btn" href="${appUrl}">Wè anons lan sou Ayiti Market →</a>
</body>
</html>`);
});

// ── SEO: sitemap.xml dinamik (tout anons aktif) ────
app.get('/sitemap.xml', async (req, res) => {
  const frontendUrl = (process.env.FRONTEND_URL || 'https://ayitimarket.ht').replace(/\/$/, '');
  const { data: items, error } = await supabase
    .from('listings')
    .select('id, title, location, created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) return res.status(500).send('Erè sitemap');

  const urls = (items || []).map(it => {
    const slug = slugify(`${it.title}-${it.location || ''}`);
    const lastmod = (it.created_at || new Date().toISOString()).slice(0, 10);
    return `  <url>
    <loc>${frontendUrl}/anons/${it.id}/${slug}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`;
  }).join('\n');

  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${frontendUrl}/</loc></url>
${urls}
</urlset>`);
});

app.get('/', (req, res) => res.json({ service: 'Ayiti Market API', status: 'ok' }));

// ── GET /health (pou Render konnen sèvis la vivan) ─
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ayiti Market API sou pò ${PORT}`));
