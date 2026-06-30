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
