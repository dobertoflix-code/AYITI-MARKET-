-- ════════════════════════════════════════════════════
-- KONT BOUTIK PRO — migrasyon Supabase
-- Egzekite sa nan Supabase SQL Editor anvan ou deplwaye
-- nouvo kòd backend la.
-- ════════════════════════════════════════════════════

-- 1) Dat ekspirasyon Kont Boutik Pro sou chak pwofil vandè.
--    NULL = pa gen abònman aktif. Si dat la nan tan kap vini, vandè a se Pro.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pro_seller_until timestamptz;

-- 2) Istwa tout abònman Boutik Pro ki te aktive (peman MonCash, NatCash, oswa manyèl).
CREATE TABLE IF NOT EXISTS pro_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  price_htg   numeric NOT NULL DEFAULT 0,
  days        integer NOT NULL,
  expires_at  timestamptz NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3) Dosye chak tantativ/konfimasyon peman pou Boutik Pro (MonCash/NatCash).
CREATE TABLE IF NOT EXISTS shop_pro_payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id               uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  days                    integer NOT NULL DEFAULT 30,
  price_htg               numeric NOT NULL DEFAULT 2000,
  method                  text NOT NULL CHECK (method IN ('moncash', 'natcash')),
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'paid', 'pending_review', 'failed', 'rejected', 'expired')),
  moncash_order_id        text,
  moncash_transaction_id  text,
  natcash_reference       text,
  paid_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_pro_payments_seller ON shop_pro_payments(seller_id);
CREATE INDEX IF NOT EXISTS idx_shop_pro_payments_status ON shop_pro_payments(status);
CREATE INDEX IF NOT EXISTS idx_pro_subscriptions_seller ON pro_subscriptions(seller_id);

-- 4) (Opsyonèl) RPC pou netwaye/verifye estati Pro ekspire si ou vle yon cron
--    ki retire badge Pro otomatikman (pa obligatwa — backend deja verifye
--    pro_seller_until > now() chak fwa, donk badge la disparèt tèt li).

-- ════════════════════════════════════════════════════
-- 5) ROW LEVEL SECURITY — backend lan sèvi ak SERVICE_ROLE key (pase RLS
--    otomatikman), donk règ sa yo se SÈLMAN yon pwoteksyon adisyonèl pou
--    anpeche kliyan front-end (anon/authenticated keys) li/ekri dirèkteman
--    nan tab sa yo san pase pa backend.
-- ════════════════════════════════════════════════════

ALTER TABLE shop_pro_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pro_subscriptions ENABLE ROW LEVEL SECURITY;

-- shop_pro_payments: yon vandè ka WÈ sèlman pwòp dosye peman li (lekti sèlman,
-- ekri/modifye toujou pase pa backend ak service_role).
DROP POLICY IF EXISTS "Sellers can view own shop_pro_payments" ON shop_pro_payments;
CREATE POLICY "Sellers can view own shop_pro_payments"
  ON shop_pro_payments FOR SELECT
  USING (auth.uid() = seller_id);

-- pro_subscriptions: menm bagay — istwa li ka wè se sèlman pa l.
DROP POLICY IF EXISTS "Sellers can view own pro_subscriptions" ON pro_subscriptions;
CREATE POLICY "Sellers can view own pro_subscriptions"
  ON pro_subscriptions FOR SELECT
  USING (auth.uid() = seller_id);

-- Pa gen policy INSERT/UPDATE/DELETE pou anon/authenticated — sa vle di
-- sèl fason pou modifye tab sa yo se pa backend lan (service_role), ki
-- toujou pase RLS san restriksyon.

-- ════════════════════════════════════════════════════
-- 6) STORAGE — bucket "uploads" pou foto pwofil & imaj anons
-- ════════════════════════════════════════════════════
-- PA BEZWEN SQL pou sa: backend lan kreye bucket "uploads" otomatikman
-- (piblik, max 5MB pa fichye) premye fwa li demare, gras a kòd ki nan
-- backend/index.js. Si pou yon rezon ou vle kreye l manyèlman nan
-- Supabase Dashboard → Storage → New Bucket: non = "uploads", piblik = wi.
