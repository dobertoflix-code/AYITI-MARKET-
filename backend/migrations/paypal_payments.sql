-- ════════════════════════════════════════════════════
-- PEMAN PAYPAL — migrasyon Supabase
-- Egzekite sa nan Supabase SQL Editor anvan ou deplwaye
-- nouvo kòd backend la (ajoute 'paypal' kòm metòd peman
-- valid pou Boost anons ak Kont Boutik Pro).
-- ════════════════════════════════════════════════════

-- 1) Boost anons (boost_payments)
ALTER TABLE boost_payments ADD COLUMN IF NOT EXISTS paypal_order_id text;

ALTER TABLE boost_payments DROP CONSTRAINT IF EXISTS boost_payments_method_check;
ALTER TABLE boost_payments ADD CONSTRAINT boost_payments_method_check
  CHECK (method IN ('moncash', 'natcash', 'paypal'));

-- 2) Kont Boutik Pro (shop_pro_payments)
ALTER TABLE shop_pro_payments ADD COLUMN IF NOT EXISTS paypal_order_id text;

ALTER TABLE shop_pro_payments DROP CONSTRAINT IF EXISTS shop_pro_payments_method_check;
ALTER TABLE shop_pro_payments ADD CONSTRAINT shop_pro_payments_method_check
  CHECK (method IN ('moncash', 'natcash', 'paypal'));
