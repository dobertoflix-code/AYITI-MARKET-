import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import {
  sendWelcomeEmail,
  sendSoldEmail,
  sendListingSoldNoticeToBuyer,
  sendBoostConfirmedEmail,
  sendShopProConfirmedEmail,
  sendNewMessageEmail,
  sendBroadcastEmail,
} from './mailer.js';

const app = express();

// CORS: nan pwodiksyon, mete FRONTEND_URL nan varyab anviwònman an
// (egzanp: FRONTEND_URL=https://ayiti-market.com)
// Si li pa konfigire, nou kite '*' tanporèman pou pa bloke devlopman lokal —
// men sa pa dwe rete konsa nan pwodiksyon reyèl.
const allowedOrigin = process.env.FRONTEND_URL || '*';
if (allowedOrigin === '*') {
  console.warn('⚠️  FRONTEND_URL pa konfigire — CORS louvri pou tout domèn. Mete FRONTEND_URL nan Render.');
}
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());
const uploadJsonParser = express.json({ limit: '8mb' });

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

// ── STORAGE: kreye bucket piblik pou imaj upload yo (avatar, anons, elatriye) ──
// si li poko egziste. Sa kouri yon sèl fwa lè sèvè a demare.
const UPLOAD_BUCKET = 'uploads';
(async () => {
  try {
    const { data: existing } = await supabase.storage.getBucket(UPLOAD_BUCKET);
    if (!existing) {
      const { error } = await supabase.storage.createBucket(UPLOAD_BUCKET, {
        public: true,
        fileSizeLimit: '5MB',
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
      });
      if (error && !/already exists/i.test(error.message)) {
        console.warn('⚠️  Pa kapab kreye bucket "uploads":', error.message);
      } else {
        console.log('✅ Bucket Supabase Storage "uploads" kreye.');
      }
    }
  } catch (err) {
    console.warn('⚠️  Verifikasyon bucket "uploads" echwe:', err.message);
  }
})();


// ── VAPID — Push Notifications ─────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:dobertojean35@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('⚠️  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY pa konfigire — push notifications dezaktive.');
}

// Voye notifikasyon push bay yon itilizatè (san bloke repons HTTP la)
async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  try {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', userId);
    if (!subs || subs.length === 0) return;
    const msg = JSON.stringify(payload);
    await Promise.allSettled(
      subs.map(row => webpush.sendNotification(row.subscription, msg))
    );
  } catch (err) {
    console.warn('Push error:', err.message);
  }
}
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

// ── POST /api/welcome-email ────────────────────────
// Rele pa frontend la jis apre yon enskripsyon (auth.signUp) reisi.
// Pa janm bloke — si Resend pa konfigire oswa echwe, nou senpman log li.
// Aksepte 2 ka: (1) sesyon imedya disponib → Authorization: Bearer <token>
//               (2) Supabase mande verifikasyon imèl → pa gen sesyon ankò,
//                   kidonk frontend voye { email, fullName } nan kò a.
//                   Nou verifye ak Admin API ke kont sa a egziste reyèlman
//                   anvan voye, pou anpeche moun spam wòt email.
app.post('/api/welcome-email', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Sesyon ekspire' });
    const fullName = user.user_metadata?.full_name || '';
    sendWelcomeEmail({ to: user.email, fullName }).catch(() => {});
    return res.json({ success: true });
  }

  // Pa gen token — ka verifikasyon imèl Supabase aktive
  const { email, fullName } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Imèl obligatwa' });

  try {
    const { data: usersPage, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;
    const matchedUser = (usersPage?.users || []).find(u => u.email === email);
    if (!matchedUser) return res.status(404).json({ error: 'Kont pa jwenn' });

    sendWelcomeEmail({ to: email, fullName: fullName || matchedUser.user_metadata?.full_name || '' }).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    console.warn('Erè welcome-email (san sesyon):', err.message);
    res.status(500).json({ error: 'Erè entèn' });
  }
});

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

// ── GET /api/seller/:id/listings ───────────────────
// Piblik — tout anons AKTIF yon vandè espesifik (pou paj seller.html).
// Pa gen limit 200 ka pa pase nan /api/listings lè platfòm lan vin gwo,
// e li filtre pa seller_id dirèkteman nan SQL (pa nan navigatè a).
app.get('/api/seller/:id/listings', async (req, res) => {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('seller_id', req.params.id)
    .eq('status', 'active')
    .order('boost_tier', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── GET /api/seller/:id/stats ──────────────────────
// Estatistik reyèl/dinamik pou paj profil piblik vandè a:
// kantite anons aktif egzak, kategori distenk, ak dat li vin manm.
app.get('/api/seller/:id/stats', async (req, res) => {
  const sellerId = req.params.id;

  const { data: listings, error } = await supabase
    .from('listings')
    .select('category, status')
    .eq('seller_id', sellerId);

  if (error) return res.status(500).json({ error: error.message });

  const activeListings = (listings || []).filter(l => l.status === 'active');
  const categories = [...new Set(activeListings.map(l => l.category).filter(Boolean))];

  const { data: profile } = await supabase
    .from('profiles')
    .select('created_at')
    .eq('id', sellerId)
    .maybeSingle();

  res.json({
    activeListingsCount: activeListings.length,
    totalListingsCount: (listings || []).length,
    categoriesCount: categories.length,
    categories,
    memberSince: profile?.created_at || null
  });
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

  // "Mache Tande" — notifye tout moun ki gen yon alèt sou kategori sa a
  // (san bloke repons HTTP la; itilizatè a pa bezwen tann sa).
  notifyCategoryAlerts(data).catch(err => console.warn('Erè alèt mache:', err.message));

  // Si se premye anons vandè a epi li te enskri ak yon kòd referans, rekonpanse.
  maybeRewardReferral(user.id).catch(err => console.warn('Erè referans:', err.message));

  res.json(data);
});

// ── MACHE TANDE — Alèt pa Kategori ─────────────────
// Voye push notification bay tout moun ki gen yon alèt aktif sou
// kategori anons ki sòt pibliye a (eksepte vandè a li menm).
async function notifyCategoryAlerts(listing) {
  if (!listing?.category) return;

  const { data: alerts, error } = await supabase
    .from('category_alerts')
    .select('user_id')
    .eq('category', listing.category);

  if (error || !alerts || alerts.length === 0) return;

  const recipientIds = [...new Set(alerts.map(a => a.user_id))].filter(id => id !== listing.seller_id);

  recipientIds.forEach(userId => {
    sendPushToUser(userId, {
      title: `🔔 Nouvo nan ${listing.category}`,
      body: listing.title,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      url: `/index.html?anons=${listing.id}`,
    });
  });
}

// ── GET /api/alerts ─────────────────────────────────
// Lis kategori "Mache Tande" itilizatè a abòne ladan yo
app.get('/api/alerts', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const { data, error } = await supabase
    .from('category_alerts')
    .select('id, category, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── POST /api/alerts ─────────────────────────────────
// Abòne itilizatè a a yon kategori (idempotan — pa duplike si li deja la)
app.post('/api/alerts', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const { category } = req.body;
  if (!category) return res.status(400).json({ error: 'Kategori obligatwa' });

  const { data: existing } = await supabase
    .from('category_alerts')
    .select('id')
    .eq('user_id', user.id)
    .eq('category', category)
    .maybeSingle();

  if (existing) return res.json(existing);

  const { data, error } = await supabase
    .from('category_alerts')
    .insert({ user_id: user.id, category })
    .select('id, category, created_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE /api/alerts/:id ────────────────────────────
app.delete('/api/alerts/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const { error } = await supabase
    .from('category_alerts')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── GET /api/listings/:id/price-history ────────────
// ── GET /api/listings/:id ─── Yon sèl anons pa ID (piblik) ──
app.get('/api/listings/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('id', id)
    .eq('status', 'active')
    .single();
  if (error || !data) {
    console.error('Erè /api/listings/:id', id, JSON.stringify(error));
    return res.status(404).json({ error: 'Anons pa jwenn', detail: error?.message });
  }
  res.json(data);
});

app.get('/api/listings/:id/price-history', async (req, res) => {
  const { data, error } = await supabase
    .from('listing_price_history')
    .select('old_price_val, old_price_label, changed_at')
    .eq('listing_id', req.params.id)
    .order('changed_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ── POST /api/listings/:id/view ────────────────────
// Anrejistre yon vizit sou yon anons (klike pou wè detay li).
// Pa notifye vandè a pou CHAK klik (sa ta vin spam) — yon sèl
// notifikasyon pa vizitè/24è pou anons sa a. Vandè a pa notifye
// pou pwòp anons pa li.
app.post('/api/listings/:id/view', async (req, res) => {
  const listingId = req.params.id;
  const token = req.headers.authorization?.replace('Bearer ', '');
  let viewerId = null;
  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) viewerId = user.id;
  }

  // Jwenn anons lan (pou konn vandè a + tit la)
  const { data: listing } = await supabase
    .from('listings')
    .select('id, title, seller_id')
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) return res.status(404).json({ error: 'Anons pa jwenn' });

  // Pa anrejistre/notifye si se pwòp vandè a k ap gade anons pa li
  const isOwner = viewerId && viewerId === listing.seller_id;

  // Anrejistre vizit la (toujou, menm pou vizitè anonim — viewer_id null)
  supabase
    .from('listing_views')
    .insert({ listing_id: listingId, viewer_id: viewerId })
    .then(({ error }) => {
      if (error) console.warn('Erè anrejistre view:', error.message);
    });

  if (isOwner) return res.json({ success: true });

  // ── Notifye vandè a, men pa plis pase 1 fwa pa vizitè pa 24è ──
  (async () => {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      let dupQuery = supabase
        .from('listing_views')
        .select('id', { count: 'exact', head: true })
        .eq('listing_id', listingId)
        .gte('created_at', since);

      dupQuery = viewerId
        ? dupQuery.eq('viewer_id', viewerId)
        : dupQuery.is('viewer_id', null);

      const { count } = await dupQuery;
      // Si gen plis pase 1 (sa nou sot enskri a + ansyen yo), deja te notifye
      if ((count || 0) > 1) return;

      sendPushToUser(listing.seller_id, {
        title: '👀 Yon moun gade anons ou',
        body: `"${listing.title}" fèk gen yon nouvo vizit.`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-96.png',
        url: `/index.html?anons=${listingId}`,
      });
    } catch (err) {
      console.warn('Erè notifikasyon view:', err.message);
    }
  })();

  res.json({ success: true });
});

// ── PUT /api/listings/:id ──────────────────────────
app.put('/api/listings/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  // Pa kite moun chanje seller_id/id pa erè oswa move zafè
  const { seller_id, id, created_at, ...updates } = req.body;

  // ── Istorik Pri: si price_val chanje, anrejistre ansyen pri a ──
  if (updates.price_val !== undefined) {
    const { data: current } = await supabase
      .from('listings')
      .select('price_val, price_label, seller_id')
      .eq('id', req.params.id)
      .single();

    if (current && current.seller_id === user.id &&
        current.price_val !== null &&
        Number(current.price_val) !== Number(updates.price_val)) {
      await supabase.from('listing_price_history').insert({
        listing_id: req.params.id,
        old_price_val: current.price_val,
        old_price_label: current.price_label || null,
        changed_at: new Date().toISOString()
      });
    }
  }

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

// ── POST /api/listings/:id/renew ───────────────────
// Vandè a konfime anons li toujou disponib — reyajiste renewed_at
app.post('/api/listings/:id/renew', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const { data, error } = await supabase
    .from('listings')
    .update({ renewed_at: new Date().toISOString(), status: 'active' })
    .eq('id', req.params.id)
    .eq('seller_id', user.id)
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Anons pa jwenn oswa aksè refize' });
  res.json({ success: true });
});

// ── POST /api/listings/:id/mark-sold ───────────────
// Vandè a make anons li kòm VANN — retire l nan rezilta piblik yo,
// voye yon imèl konfimasyon ba li, epi avèti achtè ki te kontakte l
// (atravè konvèsasyon ki gen rapò ak anons sa a) ke atik la pa disponib ankò.
app.post('/api/listings/:id/mark-sold', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pa otorize' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Sesyon ekspire' });

  const { data, error } = await supabase
    .from('listings')
    .update({ status: 'sold', sold_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('seller_id', user.id)
    .select('id, title, seller_id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Anons pa jwenn oswa aksè refize' });

  // Imèl konfimasyon bay vandè a (pa janm bloke repons HTTP la)
  sendSoldEmail({ to: user.email, listingTitle: data.title, listingId: data.id }).catch(() => {});

  // Avèti achtè ki te kontakte vandè a sou anons sa a presizeman
  (async () => {
    try {
      const { data: convs } = await supabase
        .from('conversations')
        .select('buyer_id')
        .eq('listing_id', data.id)
        .eq('seller_id', user.id);

      const buyerIds = [...new Set((convs || []).map(c => c.buyer_id))];
      if (buyerIds.length === 0) return;

      // Jwenn imèl achtè yo (admin API — sèlman backend gen aksè ak service_role)
      for (const buyerId of buyerIds) {
        const { data: buyerUser } = await supabase.auth.admin.getUserById(buyerId);
        if (buyerUser?.user?.email) {
          sendListingSoldNoticeToBuyer({ to: buyerUser.user.email, listingTitle: data.title }).catch(() => {});
        }
        sendPushToUser(buyerId, {
          title: '👀 Atik sa a vann deja',
          body: `"${data.title}" pa disponib ankò.`,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-96.png',
          url: '/index.html',
        });
      }
    } catch (err) {
      console.warn('Erè notifikasyon achtè (mark-sold):', err.message);
    }
  })();

  res.json({ success: true });
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

// ── ADMIN: PUT /api/admin/profiles/:id/pro ─────────
// Aktive/dezaktive Kont Boutik Pro manyèlman pou yon vandè (peman kach, fidelite, elatriye).
// Body: { days: 30, notes: "Peye kach" }  → ajoute 'days' sou dat ekspirasyon aktyèl la.
// Body: { deactivate: true } → retire estati Pro a imedyatman.
app.put('/api/admin/profiles/:id/pro', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  if (req.body?.deactivate) {
    const { data, error } = await supabase
      .from('profiles')
      .update({ pro_seller_until: null })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Pwofil pa jwenn' });
    return res.json(data);
  }

  const days = Number(req.body?.days) || BOUTIK_PRO_DAYS;
  try {
    const data = await applyShopPro({
      sellerId: req.params.id, days, priceHtg: 0,
      notes: req.body?.notes || `Aktive manyèlman pa ${user.email}`, method: 'admin'
    });
    res.json({ success: true, profile: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

  try {
    const data = await applyBoost({
      listingId: req.params.id, tier, days, priceHtg: price_htg, notes
    });
    res.json({ success: true, listing: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADMIN: POST /api/admin/expire-featured ─────────
// Dezaktive manwèlman tout vedèt ki ekspire (backup si cron pa konfigire)
// ── Tarif ofisyèl pou vedèt — sèl VERITE a, backend lan. Pa janm fè konfyans
// nan pri ki soti nan kliyan (moun ka modifye li nan navigatè a).
const BOOST_TIERS = [
  { tier: 1, days: 7,  price: 500  },
  { tier: 2, days: 14, price: 1200 },
  { tier: 2, days: 30, price: 2500 },
];
function findBoostPrice(tier, days) {
  const opt = BOOST_TIERS.find(o => o.tier === Number(tier) && o.days === Number(days));
  return opt ? opt.price : null;
}

// ════════════════════════════════════════════════════
// KONT BOUTIK PRO — abònman mansyèl pou vandè
// ════════════════════════════════════════════════════
// Tarif ofisyèl — sèl VERITE a se backend lan, pa janm fè konfyans nan pri
// ki soti nan kliyan an (moun ka modifye li nan navigatè a).
const BOUTIK_PRO_PRICE_HTG = 2000;
const BOUTIK_PRO_DAYS = 30;

// Aktive Kont Boutik Pro sou yon pwofil vandè + anrejistre nan istwa pro_subscriptions.
// Si vandè a deja gen yon abònman aktif ki poko ekspire, nouvo jou yo AJOUTE sou
// tan ki rete a (pa rekòmanse soti nan jodi a) — vandè a pa pèdi tan li te peye.
async function applyShopPro({ sellerId, days, priceHtg, notes, method }) {
  const { data: current } = await supabase
    .from('profiles').select('pro_seller_until, full_name').eq('id', sellerId).single();

  const now = new Date();
  const currentExpiry = current?.pro_seller_until ? new Date(current.pro_seller_until) : null;
  const base = (currentExpiry && currentExpiry > now) ? currentExpiry : now;

  const expires = new Date(base);
  expires.setDate(expires.getDate() + Number(days));

  const { data, error } = await supabase
    .from('profiles')
    .update({ pro_seller_until: expires.toISOString() })
    .eq('id', sellerId)
    .select('id, full_name, pro_seller_until')
    .single();

  if (error || !data) throw new Error(error?.message || 'Pwofil pa jwenn');

  await supabase.from('pro_subscriptions').insert({
    seller_id:  sellerId,
    price_htg:  Number(priceHtg) || 0,
    days:       Number(days),
    expires_at: expires.toISOString(),
    notes:      notes || null
  });

  // Imèl konfimasyon peman Boutik Pro (pa janm bloke flux la si echwe)
  (async () => {
    try {
      const { data: sellerUser } = await supabase.auth.admin.getUserById(sellerId);
      if (sellerUser?.user?.email) {
        await sendShopProConfirmedEmail({
          to: sellerUser.user.email,
          days, priceHtg, method: method || 'admin',
          expiresAt: expires.toISOString()
        });
      }
    } catch (err) {
      console.warn('Erè imèl konfimasyon Boutik Pro:', err.message);
    }
  })();

  return data;
}

function isShopProActive(profile) {
  return !!(profile?.pro_seller_until && new Date(profile.pro_seller_until) > new Date());
}

// ════════════════════════════════════════════════════
// SISTÈM REFERANS / PARENNAJ
// ════════════════════════════════════════════════════
const REFERRAL_REFERRER_DAYS = 7; // rekonpans pou moun ki envite a
const REFERRAL_NEWUSER_DAYS = 3;  // ti kado pou nouvo moun lan

function generateReferralCodeRaw() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // san karaktè ki ka konfonn (0/O, 1/I)
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Jenere yon kòd referans inik (reesèye si gen koud, ekstrèmman ra ak 6 karaktè).
async function ensureReferralCode(userId) {
  const { data: profile } = await supabase.from('profiles').select('referral_code').eq('id', userId).single();
  if (profile?.referral_code) return profile.referral_code;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCodeRaw();
    const { data, error } = await supabase
      .from('profiles').update({ referral_code: code }).eq('id', userId)
      .select('referral_code').single();
    if (!error && data) return data.referral_code;
  }
  throw new Error('Pa kapab jenere yon kòd referans, eseye ankò');
}

// ── GET /api/referral/my ────────────────────────────
app.get('/api/referral/my', async (req, res) => {
  const user = await requireAuthUser(req, res);
  if (!user) return;

  try {
    const referralCode = await ensureReferralCode(user.id);
    const { count: referredCount } = await supabase
      .from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', user.id);
    const { count: rewardedCount } = await supabase
      .from('profiles').select('id', { count: 'exact', head: true })
      .eq('referred_by', user.id).eq('referral_rewarded', true);

    res.json({
      referral_code: referralCode,
      referral_link: `${process.env.FRONTEND_URL || ''}/index.html?ref=${referralCode}`,
      referred_count: referredCount || 0,
      rewarded_count: rewardedCount || 0,
      reward_days: REFERRAL_REFERRER_DAYS
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/referral/register ─────────────────────
// Rele jis aprè yon nouvo moun konekte pou premye fwa, si yon kòd referans
// te kaptire nan URL la (?ref=CODE). Idempotan — pa fè anyen si itilizatè a
// deja gen yon 'referred_by' anrejistre (premye kòd la genyen, definitivman).
app.post('/api/referral/register', async (req, res) => {
  const user = await requireAuthUser(req, res);
  if (!user) return;

  const code = (req.body?.referral_code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Kòd referans obligatwa' });

  const { data: me } = await supabase.from('profiles').select('referred_by').eq('id', user.id).single();
  if (me?.referred_by) return res.json({ success: true, message: 'Deja gen yon referans anrejistre' });

  const { data: referrer } = await supabase.from('profiles').select('id').eq('referral_code', code).single();
  if (!referrer) return res.status(404).json({ error: 'Kòd referans pa valid' });
  if (referrer.id === user.id) return res.status(400).json({ error: 'Ou pa ka itilize pwòp kòd ou' });

  const { error } = await supabase.from('profiles').update({ referred_by: referrer.id }).eq('id', user.id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ success: true });
});

// Aprè yon nouvo anons pibliye, verifye si se PREMYE anons vandè a epi si gen
// yon referans ki poko rekonpanse — si wi, bay parenn nan ${REFERRAL_REFERRER_DAYS}j
// Boutik Pro gratis, ak nouvo moun lan ${REFERRAL_NEWUSER_DAYS}j kòm byenveni.
async function maybeRewardReferral(sellerId) {
  const { count: listingCount } = await supabase
    .from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', sellerId);
  if (listingCount !== 1) return; // se pa premye anons lan

  const { data: profile } = await supabase
    .from('profiles').select('referred_by, referral_rewarded').eq('id', sellerId).single();
  if (!profile?.referred_by || profile.referral_rewarded) return;

  await applyShopPro({
    sellerId: profile.referred_by, days: REFERRAL_REFERRER_DAYS, priceHtg: 0,
    notes: 'Rekonpans referans — yon zanmi pibliye premye anons li', method: 'referral'
  }).catch(err => console.warn('Erè rekonpans parenn:', err.message));

  await applyShopPro({
    sellerId, days: REFERRAL_NEWUSER_DAYS, priceHtg: 0,
    notes: 'Kado byenveni — enskri ak yon kòd referans', method: 'referral'
  }).catch(err => console.warn('Erè rekonpans nouvo moun:', err.message));

  await supabase.from('profiles').update({ referral_rewarded: true }).eq('id', sellerId);
}

// ════════════════════════════════════════════════════
// ADMIN: ANONS BAY TOUT ITILIZATÈ (broadcast email)
// ════════════════════════════════════════════════════

// Voye imèl bay yon lis adrès, an chenn (yonn aprè lòt) ak yon ti delè ant chak
// pou respekte limit Resend (evite rate-limit/echèk anmas). Pa janm throw —
// nou kontinye menm si yon imèl echwe, epi nou jis konte siksè/echèk yo.
async function sendBroadcastInBatches(emails, { subject, bodyHtml, imageUrl }) {
  let sent = 0, failed = 0;
  for (const to of emails) {
    try {
      await sendBroadcastEmail({ to, subject, bodyHtml, imageUrl });
      sent++;
    } catch (err) {
      failed++;
      console.warn('Erè anons pou', to, ':', err.message);
    }
    await new Promise(r => setTimeout(r, 550)); // ~1.8 imèl/segond
  }
  console.log(`Broadcast fini: ${sent} voye, ${failed} echwe sou ${emails.length}`);
}

// ── POST /api/admin/broadcast ───────────────────────
// Body: { subject, message, test_only: boolean }
// Si test_only=true, imèl la voye sèlman bay admin k ap konekte a (pou previzyon).
// Otreman, imèl la voye an background bay TOUT itilizatè ki gen yon imèl valid.
// Repons lan retounen IMEDYATMAN (pa tann tout imèl yo fini voye).
app.post('/api/admin/broadcast', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { subject, message, test_only, image_url } = req.body;
  if (!subject || !subject.trim()) return res.status(400).json({ error: 'Antre yon objè (sijè) pou imèl la' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'Antre yon mesaj' });

  let imageUrl = (image_url || '').trim() || null;
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
    return res.status(400).json({ error: 'Lyen imaj la dwe kòmanse ak http:// oswa https://' });
  }

  // Konvèti newlines an <br> pou HTML lan, San touche tèks orijinal la twòp.
  const bodyHtml = message.trim()
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 14px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  if (test_only) {
    try {
      await sendBroadcastEmail({ to: user.email, subject: `[TEST] ${subject}`, bodyHtml, imageUrl });
      return res.json({ success: true, message: `Imèl tès voye bay ${user.email}` });
    } catch (err) {
      return res.status(500).json({ error: 'Erè pandan voye imèl tès la: ' + err.message });
    }
  }

  // Rale tout itilizatè yo (paginasyon, Supabase retounen 50 pa paj pa default)
  let allEmails = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return res.status(500).json({ error: 'Erè pandan rale lis itilizatè: ' + error.message });
    const emails = (data?.users || []).map(u => u.email).filter(Boolean);
    allEmails = allEmails.concat(emails);
    if (!data?.users || data.users.length < 1000) break;
    page++;
  }
  allEmails = [...new Set(allEmails)];

  if (allEmails.length === 0) return res.status(400).json({ error: 'Pa gen okenn itilizatè ak imèl' });

  // Reponn imedyatman, epi voye imèl yo an background (sa ka pran plizyè minit).
  res.json({ success: true, message: `Ap voye anons bay ${allEmails.length} itilizatè an background.`, recipient_count: allEmails.length });

  sendBroadcastInBatches(allEmails, { subject, bodyHtml, imageUrl }).catch(err => {
    console.error('Erè jeneral broadcast:', err.message);
  });
});

// ── POST /api/upload-image ──────────────────────────
// Upload yon imaj (foto pwofil, imaj anons, elatriye) bay Supabase Storage.
// Body: { image_base64: "data:image/png;base64,...", folder: "avatars"|"broadcast"|"misc" }
// Repons: { url: "https://...public-url..." }
// Itilizatè konekte sèlman (pa bezwen admin — tout moun ka chanje foto pwofil yo).
app.post('/api/upload-image', uploadJsonParser, async (req, res) => {
  const user = await requireAuthUser(req, res);
  if (!user) return;

  const { image_base64, folder } = req.body;
  if (!image_base64 || typeof image_base64 !== 'string') {
    return res.status(400).json({ error: 'Pa gen imaj voye' });
  }

  const match = image_base64.match(/^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/i);
  if (!match) return res.status(400).json({ error: 'Fòma imaj pa sipòte (sèlman PNG, JPG, WEBP, GIF)' });

  const mime = match[1].toLowerCase();
  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const buffer = Buffer.from(match[3], 'base64');

  if (buffer.length > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Imaj la twò gwo (maksimòm 5MB)' });
  }

  const safeFolder = ['avatars', 'broadcast', 'listings'].includes(folder) ? folder : 'misc';
  const filename = `${safeFolder}/${user.id}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(filename, buffer, { contentType: mime, upsert: true });

  if (upErr) return res.status(500).json({ error: 'Erè pandan upload: ' + upErr.message });

  const { data: pub } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filename);
  res.json({ url: pub.publicUrl });
});

// Aktive vedèt la sou yon anons + anrejistre nan istwa promotions.
// Itilize pa: admin manyèl, ak konfimasyon peman MonCash/NatCash otomatik.
// Si anons lan deja gen yon vedèt aktif ki poko ekspire, nouvo jou yo AJOUTE sou
// tan ki rete a (pa rekòmanse soti nan jodi a) — vandè a pa pèdi tan li te peye.
async function applyBoost({ listingId, sellerId, tier, days, priceHtg, notes, method }) {
  let expires;

  if (tier > 0) {
    const { data: current } = await supabase
      .from('listings').select('featured_until').eq('id', listingId).single();

    const now = new Date();
    const currentExpiry = current?.featured_until ? new Date(current.featured_until) : null;
    const base = (currentExpiry && currentExpiry > now) ? currentExpiry : now;

    expires = new Date(base);
    expires.setDate(expires.getDate() + Number(days));
  } else {
    expires = new Date(); // pa itilize si tier===0, men kenbe yon valè valid
  }

  const { data, error } = await supabase
    .from('listings')
    .update({
      is_featured:    tier > 0,
      boost_tier:     tier,
      featured_until: tier > 0 ? expires.toISOString() : null
    })
    .eq('id', listingId)
    .select('id, title, seller_id, boost_tier, featured_until')
    .single();

  if (error || !data) throw new Error(error?.message || 'Anons pa jwenn');

  if (tier > 0) {
    await supabase.from('promotions').insert({
      listing_id: listingId,
      seller_id:  sellerId || data.seller_id,
      tier,
      price_htg:  Number(priceHtg) || 0,
      expires_at: expires.toISOString(),
      notes:      notes || null
    });

    // Imèl konfimasyon peman boost (pa janm bloke flux la si echwe)
    (async () => {
      try {
        const finalSellerId = sellerId || data.seller_id;
        const { data: sellerUser } = await supabase.auth.admin.getUserById(finalSellerId);
        if (sellerUser?.user?.email) {
          await sendBoostConfirmedEmail({
            to: sellerUser.user.email,
            listingTitle: data.title,
            tier, days, priceHtg, method: method || 'admin'
          });
        }
      } catch (err) {
        console.warn('Erè imèl konfimasyon boost:', err.message);
      }
    })();
  }
  return data;
}

app.post('/api/admin/expire-featured', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { error } = await supabase.rpc('expire_featured_listings');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'Vedèt ekspire yo retire' });
});

// ── ADMIN: POST /api/admin/expire-stale-boost-payments ──────
// Netwayaj: mache kòm 'expired' tout dosye boost_payments ki rete 'pending'
// (peman MonCash pa konplete oswa NatCash pa janm soumèt referans) plis pase 48h.
// Sa pa touche okenn anons — se sèlman pwòpte istorik peman an. Bon pou rele
// regilyèman (cron, oswa bouton admin manyèl).
app.post('/api/admin/expire-stale-boost-payments', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('boost_payments')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .select('id');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, expired_count: data?.length || 0 });
});

// ── ADMIN: POST /api/admin/expire-stale-shop-pro-payments ──────
// Netwayaj: mache kòm 'expired' tout dosye shop_pro_payments ki rete 'pending' plis pase 48h.
app.post('/api/admin/expire-stale-shop-pro-payments', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('shop_pro_payments')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .select('id');

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, expired_count: data?.length || 0 });
});

// ════════════════════════════════════════════════════
// PEMAN VEDÈT — MonCash + NatCash, dirèkteman sou platfòm
// (ranplase ansyen flux "voye WhatsApp epi tann admin")
// ════════════════════════════════════════════════════

const MONCASH_MODE = process.env.MONCASH_MODE === 'live' ? 'live' : 'sandbox';
const MONCASH_BASE = MONCASH_MODE === 'live'
  ? 'https://moncashbutton.digicelgroup.com'
  : 'https://sandbox.moncashbutton.digicelgroup.com';

async function getMoncashToken() {
  const creds = Buffer.from(`${process.env.MONCASH_CLIENT_ID}:${process.env.MONCASH_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${MONCASH_BASE}/Api/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: 'grant_type=client_credentials&scope=read,write'
  });
  if (!r.ok) throw new Error('Pa kapab konekte ak MonCash (verifye kle API yo)');
  const data = await r.json();
  return data.access_token;
}

async function requireAuthUser(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).json({ error: 'Pa otorize' }); return null; }
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) { res.status(401).json({ error: 'Sesyon ekspire' }); return null; }
  return user;
}

// ── POST /api/boost/initiate ───────────────────────
// Body: { listing_id, tier, days, method: 'moncash'|'natcash' }
app.post('/api/boost/initiate', async (req, res) => {
  const user = await requireAuthUser(req, res);
  if (!user) return;

  const { listing_id, tier, days, method } = req.body;
  const price = findBoostPrice(tier, days);
  if (!price) return res.status(400).json({ error: 'Nivo/dire envalid' });
  if (!['moncash', 'natcash'].includes(method)) return res.status(400).json({ error: 'Metòd peman envalid' });

  // Verifye se vrè pwopriyetè anons lan k ap mande boost
  const { data: listing, error: listErr } = await supabase
    .from('listings').select('id, title, seller_id').eq('id', listing_id).single();
  if (listErr || !listing) return res.status(404).json({ error: 'Anons pa jwenn' });
  if (listing.seller_id !== user.id) return res.status(403).json({ error: 'Se pa anons pa w sa a' });

  // Kreye yon dosye peman an atant
  const { data: payment, error: payErr } = await supabase
    .from('boost_payments')
    .insert({
      listing_id, seller_id: user.id, tier: Number(tier), days: Number(days),
      price_htg: price, method, status: 'pending'
    })
    .select().single();
  if (payErr) return res.status(500).json({ error: payErr.message });

  if (method === 'moncash') {
    try {
      const accessToken = await getMoncashToken();
      const orderId = `boost-${payment.id}`;
      const createRes = await fetch(`${MONCASH_BASE}/Api/v1/CreatePayment`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ amount: price, orderId })
      });
      const createData = await createRes.json();
      const payToken = createData?.payment_token?.token;
      if (!payToken) throw new Error('MonCash pa retounen yon token peman');

      await supabase.from('boost_payments').update({ moncash_order_id: orderId }).eq('id', payment.id);

      return res.json({
        payment_id: payment.id,
        method: 'moncash',
        redirect_url: `${MONCASH_BASE}/Api/v1/Redirect?token=${payToken}`
      });
    } catch (err) {
      await supabase.from('boost_payments').update({ status: 'failed' }).eq('id', payment.id);
      return res.status(502).json({ error: 'Erè MonCash: ' + err.message });
    }
  }

  // NatCash pa gen API piblik pou peman otomatik — itilizatè a peye manyèlman
  // nan nimewo machann lan, epi soumèt referans tranzaksyon an pou verifikasyon.
  return res.json({
    payment_id: payment.id,
    method: 'natcash',
    instructions: {
      phone: process.env.NATCASH_MERCHANT_PHONE || '509-XXXX-XXXX',
      amount: price,
      note: `Peye ${price} HTG sou NatCash nan nimewo a, epi antre referans tranzaksyon an pou nou konfime.`
    }
  });
});

// ── GET /api/boost/moncash/return ──────────────────
// MonCash redireksyone isit aprè peman an (configire nan dashboard MonCash ou)
app.get('/api/boost/moncash/return', async (req, res) => {
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const { transactionId, orderId } = req.query;

  try {
    const accessToken = await getMoncashToken();
    const verifyRes = await fetch(`${MONCASH_BASE}/Api/v1/RetrieveTransactionPayment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ transactionId })
    });
    const verifyData = await verifyRes.json();
    const tx = verifyData?.payment;
    if (!tx || tx.message !== 'successful') throw new Error('Tranzaksyon pa konfime');

    // Sekirite: pa janm fè konfyans nan 'orderId' ki soti nan URL la sèlman (nenpòt moun
    // ka chanje l manyèlman). Sous verite a se referans ke MONCASH LIMENM voye tounen nan
    // tranzaksyon konfime a. Si 'orderId' nan URL pa matche referans verifye a, rejte.
    const verifiedOrderId = tx.reference || tx.order_id || tx.orderId || null;
    if (!verifiedOrderId) throw new Error('MonCash pa retounen referans tranzaksyon an');
    if (orderId && orderId !== verifiedOrderId) {
      throw new Error('Referans peman pa matche — posib tantativ fwod');
    }

    const paymentId = String(verifiedOrderId).replace('boost-', '');
    const { data: payment } = await supabase.from('boost_payments').select('*').eq('id', paymentId).single();
    if (!payment) throw new Error('Dosye peman pa jwenn');

    // Sekirite: konfime montan peye a (selon MonCash) egal ak pri ki te dwe peye a.
    // Sa anpeche yon moun peye yon nivo bon mache epi kredite yon nivo pi chè.
    const paidAmount = Number(tx.amount ?? tx.cost ?? tx.total ?? 0);
    if (!paidAmount || Math.abs(paidAmount - Number(payment.price_htg)) > 0.01) {
      throw new Error('Montan peye a pa egal ak pri boost la');
    }
    // Sekirite: dosye peman an dwe deja gen menm orderId MonCash ki te kreye l la
    // (anpeche kredite yon dosye lòt moun ak yon transactionId reyèl men pa pou li).
    if (payment.moncash_order_id && payment.moncash_order_id !== verifiedOrderId) {
      throw new Error('Dosye peman pa koresponn ak referans MonCash la');
    }

    if (payment.status !== 'paid') {
      await applyBoost({
        listingId: payment.listing_id, sellerId: payment.seller_id,
        tier: payment.tier, days: payment.days, priceHtg: payment.price_htg,
        notes: `MonCash #${transactionId}`, method: 'moncash'
      });
      await supabase.from('boost_payments').update({
        status: 'paid', moncash_transaction_id: transactionId, paid_at: new Date().toISOString()
      }).eq('id', paymentId);
    }
    return res.redirect(302, `${frontendUrl}/account.html?boost=success`);
  } catch (err) {
    return res.redirect(302, `${frontendUrl}/account.html?boost=failed`);
  }
});

// ── POST /api/boost/natcash/confirm ────────────────
// Vandè a soumèt referans tranzaksyon NatCash li aprè li fin peye manyèlman.
// Sa mete dosye a "pending_review" — admin konfime nan panel admin.
app.post('/api/boost/natcash/confirm', async (req, res) => {
  const user = await requireAuthUser(req, res);
  if (!user) return;

  const { payment_id, reference } = req.body;
  if (!reference || !reference.trim()) return res.status(400).json({ error: 'Antre referans tranzaksyon an' });

  const { data: payment, error } = await supabase
    .from('boost_payments').select('*').eq('id', payment_id).eq('seller_id', user.id).single();
  if (error || !payment) return res.status(404).json({ error: 'Dosye peman pa jwenn' });

  await supabase.from('boost_payments').update({
    status: 'pending_review', natcash_reference: reference.trim()
  }).eq('id', payment_id);

  res.json({ success: true, message: 'Referans ou anrejistre. Admin ap verifye l nan kèk èdtan.' });
});

// ── GET /api/boost/my ───────────────────────────────
app.get('/api/boost/my', async (req, res) => {
  const user = await requireAuthUser(req, res);
  if (!user) return;
  const { data, error } = await supabase
    .from('boost_payments').select('*').eq('seller_id', user.id)
    .order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── ADMIN: GET /api/admin/boost-payments?status=pending_review
app.get('/api/admin/boost-payments', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const { status } = req.query;
  let q = supabase.from('boost_payments').select('*, listings(title)').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── ADMIN: PUT /api/admin/boost-payments/:id/approve (NatCash manyèl)
app.put('/api/admin/boost-payments/:id/approve', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { data: payment, error } = await supabase
    .from('boost_payments').select('*').eq('id', req.params.id).single();
  if (error || !payment) return res.status(404).json({ error: 'Dosye pa jwenn' });
  if (payment.status === 'paid') return res.status(400).json({ error: 'Peman sa a deja konfime' });

  await applyBoost({
    listingId: payment.listing_id, sellerId: payment.seller_id,
    tier: payment.tier, days: payment.days, priceHtg: payment.price_htg,
    notes: `NatCash #${payment.natcash_reference} (verifye pa ${user.email})`, method: 'natcash'
  });
  await supabase.from('boost_payments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', req.params.id);

  res.json({ success: true });
});

// ── ADMIN: PUT /api/admin/boost-payments/:id/reject
app.put('/api/admin/boost-payments/:id/reject', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const { error } = await supabase.from('boost_payments').update({ status: 'rejected' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
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


// ════════════════════════════════════════════════════
// PEMAN KONT BOUTIK PRO — MonCash + NatCash
// ════════════════════════════════════════════════════

// ── POST /api/shop-pro/initiate ────────────────────
// Body: { method: 'moncash'|'natcash' }  — pri/dire fiks: 2000 HTG / 30 jou
app.post('/api/shop-pro/initiate', async (req, res) => {
  const user = await requireAuthUser(req, res);
  if (!user) return;

  const { method } = req.body;
  if (!['moncash', 'natcash'].includes(method)) return res.status(400).json({ error: 'Metòd peman envalid' });

  const price = BOUTIK_PRO_PRICE_HTG;
  const days = BOUTIK_PRO_DAYS;

  const { data: payment, error: payErr } = await supabase
    .from('shop_pro_payments')
    .insert({ seller_id: user.id, days, price_htg: price, method, status: 'pending' })
    .select().single();
  if (payErr) return res.status(500).json({ error: payErr.message });

  if (method === 'moncash') {
    try {
      const accessToken = await getMoncashToken();
      const orderId = `pro-${payment.id}`;
      const createRes = await fetch(`${MONCASH_BASE}/Api/v1/CreatePayment`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ amount: price, orderId })
      });
      const createData = await createRes.json();
      const payToken = createData?.payment_token?.token;
      if (!payToken) throw new Error('MonCash pa retounen yon token peman');

      await supabase.from('shop_pro_payments').update({ moncash_order_id: orderId }).eq('id', payment.id);

      return res.json({
        payment_id: payment.id,
        method: 'moncash',
        redirect_url: `${MONCASH_BASE}/Api/v1/Redirect?token=${payToken}`
      });
    } catch (err) {
      await supabase.from('shop_pro_payments').update({ status: 'failed' }).eq('id', payment.id);
      return res.status(502).json({ error: 'Erè MonCash: ' + err.message });
    }
  }

  // NatCash pa gen API piblik pou peman otomatik — itilizatè a peye manyèlman
  // nan nimewo machann lan, epi soumèt referans tranzaksyon an pou verifikasyon.
  return res.json({
    payment_id: payment.id,
    method: 'natcash',
    instructions: {
      phone: process.env.NATCASH_MERCHANT_PHONE || '509-XXXX-XXXX',
      amount: price,
      note: `Peye ${price} HTG sou NatCash nan nimewo a, epi antre referans tranzaksyon an pou nou konfime.`
    }
  });
});

// ── GET /api/shop-pro/moncash/return ───────────────
app.get('/api/shop-pro/moncash/return', async (req, res) => {
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const { transactionId, orderId } = req.query;

  try {
    const accessToken = await getMoncashToken();
    const verifyRes = await fetch(`${MONCASH_BASE}/Api/v1/RetrieveTransactionPayment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ transactionId })
    });
    const verifyData = await verifyRes.json();
    const tx = verifyData?.payment;
    if (!tx || tx.message !== 'successful') throw new Error('Tranzaksyon pa konfime');

    // Sekirite: pa janm fè konfyans nan 'orderId' ki soti nan URL la sèlman — sous
    // verite a se referans ke MONCASH LIMENM voye tounen nan tranzaksyon konfime a.
    const verifiedOrderId = tx.reference || tx.order_id || tx.orderId || null;
    if (!verifiedOrderId) throw new Error('MonCash pa retounen referans tranzaksyon an');
    if (orderId && orderId !== verifiedOrderId) {
      throw new Error('Referans peman pa matche — posib tantativ fwod');
    }

    const paymentId = String(verifiedOrderId).replace('pro-', '');
    const { data: payment } = await supabase.from('shop_pro_payments').select('*').eq('id', paymentId).single();
    if (!payment) throw new Error('Dosye peman pa jwenn');

    // Sekirite: konfime montan peye a egal ak pri Boutik Pro a.
    const paidAmount = Number(tx.amount ?? tx.cost ?? tx.total ?? 0);
    if (!paidAmount || Math.abs(paidAmount - Number(payment.price_htg)) > 0.01) {
      throw new Error('Montan peye a pa egal ak pri Boutik Pro la');
    }
    if (payment.moncash_order_id && payment.moncash_order_id !== verifiedOrderId) {
      throw new Error('Dosye peman pa koresponn ak referans MonCash la');
    }

    if (payment.status !== 'paid') {
      await applyShopPro({
        sellerId: payment.seller_id, days: payment.days, priceHtg: payment.price_htg,
        notes: `MonCash #${transactionId}`, method: 'moncash'
      });
      await supabase.from('shop_pro_payments').update({
        status: 'paid', moncash_transaction_id: transactionId, paid_at: new Date().toISOString()
      }).eq('id', paymentId);
    }
    return res.redirect(302, `${frontendUrl}/account.html?pro=success`);
  } catch (err) {
    return res.redirect(302, `${frontendUrl}/account.html?pro=failed`);
  }
});

// ── POST /api/shop-pro/natcash/confirm ─────────────
// Vandè a soumèt referans tranzaksyon NatCash li aprè li fin peye manyèlman.
app.post('/api/shop-pro/natcash/confirm', async (req, res) => {
  const user = await requireAuthUser(req, res);
  if (!user) return;

  const { payment_id, reference } = req.body;
  if (!reference || !reference.trim()) return res.status(400).json({ error: 'Antre referans tranzaksyon an dabò' });

  const { data: payment, error } = await supabase
    .from('shop_pro_payments').select('*').eq('id', payment_id).eq('seller_id', user.id).single();
  if (error || !payment) return res.status(404).json({ error: 'Dosye peman pa jwenn' });

  await supabase.from('shop_pro_payments').update({
    status: 'pending_review', natcash_reference: reference.trim()
  }).eq('id', payment_id);

  res.json({ success: true, message: 'Referans ou anrejistre. Admin ap verifye l nan kèk èdtan.' });
});

// ── GET /api/shop-pro/my ────────────────────────────
app.get('/api/shop-pro/my', async (req, res) => {
  const user = await requireAuthUser(req, res);
  if (!user) return;

  const { data: profile, error: profErr } = await supabase
    .from('profiles').select('pro_seller_until').eq('id', user.id).single();
  if (profErr) return res.status(500).json({ error: profErr.message });

  const { data: payments, error } = await supabase
    .from('shop_pro_payments').select('*').eq('seller_id', user.id)
    .order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    pro_seller_until: profile?.pro_seller_until || null,
    is_pro_active: isShopProActive(profile),
    payments
  });
});

// ── ADMIN: GET /api/admin/shop-pro-payments?status=pending_review
app.get('/api/admin/shop-pro-payments', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const { status } = req.query;
  let q = supabase.from('shop_pro_payments').select('*, profiles(full_name)').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q.limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── ADMIN: PUT /api/admin/shop-pro-payments/:id/approve (NatCash manyèl)
app.put('/api/admin/shop-pro-payments/:id/approve', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  const { data: payment, error } = await supabase
    .from('shop_pro_payments').select('*').eq('id', req.params.id).single();
  if (error || !payment) return res.status(404).json({ error: 'Dosye pa jwenn' });
  if (payment.status === 'paid') return res.status(400).json({ error: 'Peman sa a deja konfime' });

  await applyShopPro({
    sellerId: payment.seller_id, days: payment.days, priceHtg: payment.price_htg,
    notes: `NatCash #${payment.natcash_reference} (verifye pa ${user.email})`, method: 'natcash'
  });
  await supabase.from('shop_pro_payments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', req.params.id);

  res.json({ success: true });
});

// ── ADMIN: PUT /api/admin/shop-pro-payments/:id/reject
app.put('/api/admin/shop-pro-payments/:id/reject', async (req, res) => {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const { error } = await supabase.from('shop_pro_payments').update({ status: 'rejected' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});


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

  // Verifye si itilizatè a deja kite yon review pou vandè sa a — UPDATE si wi, INSERT si non.
  // (Nou fè sa manyèlman olye de .upsert(onConflict:...) paske sa mande yon "unique
  // constraint" egzat nan tab Supabase la. Si konstrent sa a pa la, upsert echwe ak yon
  // erè 500 silansye e PESÒN pa ka kite okenn evalyasyon — pwoblèm sa a te dekouvri pandan odit.)
  const { data: existing } = await supabase
    .from('reviews').select('id')
    .eq('seller_id', seller_id).eq('reviewer_id', user.id).maybeSingle();

  let data, error;
  if (existing) {
    ({ data, error } = await supabase
      .from('reviews')
      .update({ rating, comment: comment?.trim() || null, listing_id: listing_id || null, reviewer_name })
      .eq('id', existing.id)
      .select()
      .single());
  } else {
    ({ data, error } = await supabase
      .from('reviews')
      .insert({ seller_id, reviewer_id: user.id, listing_id: listing_id || null,
        rating, comment: comment?.trim() || null, reviewer_name })
      .select()
      .single());
  }

  if (error) return res.status(500).json({ error: error.message });

  // ── Notifye vandè a (sèlman pou nòt nèf, pa update) ──
  if (!existing && data) {
    sendPushToUser(seller_id, {
      title: '⭐ Nouvo Nòt sou Ayiti Market',
      body: `${reviewer_name} ba ou ${rating} ★${comment ? ' — "' + comment.slice(0, 60) + (comment.length > 60 ? '...' : '') + '"' : ''}`,
      icon: '/icons/icon-192.png',
      url: '/account.html#reviews'
    }).catch(err => console.warn('Erè push nòt:', err.message));
  }

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
    .upsert({ conversation_id: Number(req.params.id), user_id: user.id, last_read_at: new Date().toISOString() },
             { onConflict: 'conversation_id,user_id' });

  res.json(data);
});


// ── GET /api/vapid-public-key ──────────────────────
app.get('/api/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: 'Push pa konfigire' });
  res.json({ key });
});

// ── POST /api/push-subscribe ───────────────────────
// Anrejistre abònman push yon navigatè pou itilizatè a
app.post('/api/push-subscribe', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Abònman envalid' });

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: user.id, endpoint: subscription.endpoint, subscription },
      { onConflict: 'endpoint' }
    );

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── DELETE /api/push-unsubscribe ──────────────────
app.delete('/api/push-unsubscribe', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint obligatwa' });

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint);

  res.json({ success: true });
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

  // ── Notifye destinatè a (pa voye pou expéditeur) ──
  const recipientId = user.id === conv.buyer_id ? conv.seller_id : conv.buyer_id;
  const senderName  = user.user_metadata?.full_name || 'Yon moun';
  sendPushToUser(recipientId, {
    title: `💬 Nouvo mesaj — ${senderName}`,
    body:  body?.trim()?.slice(0, 100) || '📎 Fichye voye',
    icon:  '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    url:   '/messages.html',
  });

  // Imèl nouvo mesaj (pa janm bloke repons HTTP la)
  (async () => {
    try {
      const { data: recipientUser } = await supabase.auth.admin.getUserById(recipientId);
      if (recipientUser?.user?.email) {
        sendNewMessageEmail({
          to: recipientUser.user.email,
          senderName,
          messagePreview: body?.trim(),
          conversationId: conversation_id,
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('Erè imèl nouvo mesaj:', err.message);
    }
  })();

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
      { conversation_id: Number(req.params.id), user_id: user.id, last_read_at: new Date().toISOString() },
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

// ── KATEGORI: mapping slug → non egzak kolòn 'category' nan DB ────
// Dwe rete sentonize ak data-cat nan frontend/index.html (seksyon #kategori).
const CATEGORY_SLUGS = {
  'elektronik':      'Elektwonik',
  'vwati-moto':      'Vwati & Moto',
  'imobilye':        'Imobilye',
  'mod-rad':         'Mòd & Rad',
  'sevis':           'Sèvis',
  'manje-bwason':    'Manje & Bwason',
  'atizay':          'Atizay',
  'lot':             'Lòt'
};

// ── SEO: paj dedye pou chak kategori (/kategori/elektronik) ───────
// Rann sèvè-kote ak meta tags + yon apèsi anons yo pou Google/rezo sosyal,
// epi voye moun lan sou SPA a (/?cat=...) ak filtraj la deja aplike.
app.get('/kategori/:slug', async (req, res) => {
  const { slug } = req.params;
  const frontendUrl = (process.env.FRONTEND_URL || 'https://ayiti-market.com').replace(/\/$/, '');
  const category = CATEGORY_SLUGS[slug];

  if (!category) {
    return res.status(404).send(`<!DOCTYPE html><html lang="ht"><head><meta charset="utf-8">
      <title>Kategori pa jwenn — Ayiti Market</title>
      <meta name="robots" content="noindex">
      <meta http-equiv="refresh" content="2;url=${frontendUrl}/">
      </head><body>Kategori sa a pa egziste. Ou pral retounen sou Ayiti Market...</body></html>`);
  }

  const now = new Date().toISOString();
  const { data: items, error } = await supabase
    .from('listings')
    .select('*')
    .eq('status', 'active')
    .eq('category', category)
    .or(`featured_until.is.null,featured_until.gt.${now}`)
    .order('boost_tier', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(24);

  if (error) {
    return res.status(500).send('Erè sèvè. Tanpri eseye ankò pita.');
  }

  const total = items ? items.length : 0;
  const title = `${category} — Anons ann Ayiti | Ayiti Market`;
  const description = `Jwenn ${category.toLowerCase()} pou vann oswa achte toupatou nan peyi a. ${total} anons disponib kounye a sou Ayiti Market — gratis pou pibliye.`;
  const canonicalUrl = `${frontendUrl}/kategori/${slug}`;
  const appUrl = `${frontendUrl}/?cat=${encodeURIComponent(category)}`;
  const image = `${frontendUrl}/og-image.jpg`;

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonicalUrl
  };

  const cardsHtml = (items || []).slice(0, 24).map(item => {
    const priceText = item.price_label || (item.price_val ? `${Number(item.price_val).toLocaleString('fr-FR')} HTG` : 'Sou demann');
    const img = (item.images && item.images.length) ? item.images[0] : image;
    const itemSlug = slugify(`${item.title}-${item.location || ''}`);
    return `<a class="card" href="${frontendUrl}/anons/${item.id}/${itemSlug}">
      <img src="${escapeHtml(img)}" alt="${escapeHtml(item.title)}" loading="lazy">
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="card-price">${escapeHtml(priceText)}</div>
        <div class="card-loc">${escapeHtml(item.location || '')}</div>
      </div>
    </a>`;
  }).join('\n');

  res.send(`<!DOCTYPE html>
<html lang="ht">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${canonicalUrl}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;max-width:1080px;margin:0 auto;padding:24px;color:#14181F;line-height:1.6;background:#FBF6EC}
  h1{font-size:1.5rem;margin-bottom:4px}
  .sub{color:#4A4F5A;font-size:0.92rem;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
  .card{display:block;background:#fff;border:1px solid #E4DCC8;border-radius:14px;overflow:hidden;text-decoration:none;color:inherit}
  .card img{width:100%;height:150px;object-fit:cover;background:#eee;display:block}
  .card-body{padding:12px}
  .card-title{font-weight:700;font-size:0.92rem;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .card-price{color:#B91C3C;font-weight:800;font-size:0.95rem}
  .card-loc{color:#4A4F5A;font-size:0.8rem;margin-top:2px}
  .empty{color:#4A4F5A;padding:40px 0;text-align:center}
  .btn{display:inline-block;background:#14181F;color:#fff;padding:14px 26px;border-radius:10px;text-decoration:none;font-weight:600;margin:24px 0}
</style>
</head>
<body>
  <h1>${escapeHtml(category)}</h1>
  <div class="sub">${total} anons disponib ann Ayiti</div>
  <a class="btn" href="${appUrl}">Wè tout anons ${escapeHtml(category.toLowerCase())} sou Ayiti Market →</a>
  <div class="grid">
    ${cardsHtml || '<div class="empty">Pa gen anons nan kategori sa a kounye a. Tounen pita oswa pibliye yon anons!</div>'}
  </div>
</body>
</html>`);
});

// ── Ansyen chemen Fransè (/categorie/:slug) — redireksyon pèmanan ──
// Konsève pou pa kraze lyen ki te deja pataje/endèkse anvan chanjman an.
app.get('/categorie/:slug', (req, res) => {
  res.redirect(301, `/kategori/${req.params.slug}`);
});

app.get('/anons/:id/:slug?', async (req, res) => {
  const { id, slug } = req.params;
  const frontendUrl = (process.env.FRONTEND_URL || 'https://ayiti-market.com').replace(/\/$/, '');

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
  const frontendUrl = (process.env.FRONTEND_URL || 'https://ayiti-market.com').replace(/\/$/, '');
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

  const categoryUrls = Object.keys(CATEGORY_SLUGS).map(slug =>
    `  <url><loc>${frontendUrl}/kategori/${slug}</loc></url>`
  ).join('\n');

  res.set('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${frontendUrl}/</loc></url>
${categoryUrls}
${urls}
</urlset>`);
});

app.get('/', (req, res) => res.json({ service: 'Ayiti Market API', status: 'ok' }));

// ── GET /health (pou Render konnen sèvis la vivan) ─
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ayiti Market API sou pò ${PORT}`));
