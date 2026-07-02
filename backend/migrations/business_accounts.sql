-- ════════════════════════════════════════════════════
-- KONT ANTREPRIZ (Business Accounts) — migrasyon Supabase
-- Egzekite sa nan Supabase SQL Editor anvan ou deplwaye
-- nouvo kòd backend la.
-- ════════════════════════════════════════════════════

-- 1) Tip kont: 'individual' (vandè nòmal) oswa 'business' (antrepriz).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'individual'
    CHECK (account_type IN ('individual', 'business'));

-- 2) Chan spesifik pou kont Antrepriz sèlman.
--    Nòt: nou reyitilize kolòn ki deja egziste sou "profiles" pou kontak/adrès —
--    "phone", "location", ak "website" — pou nou pa dwaplike done. Sèl kolòn
--    tout nèf yo se sa ki spesifik a yon biznis (kategori, orè, cover, verifye).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS business_name     text,
  ADD COLUMN IF NOT EXISTS business_category text,
  ADD COLUMN IF NOT EXISTS business_hours    text,
  ADD COLUMN IF NOT EXISTS cover_url         text,
  ADD COLUMN IF NOT EXISTS business_verified boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_account_type ON profiles(account_type);

-- ════════════════════════════════════════════════════
-- NÒT: pa gen nouvo tab — nou itilize menm tab "profiles" a men ak yon
-- "account_type" pou distenge Antrepriz de vandè endividyèl. Konsa kont
-- Antrepriz gen menm sistèm anons, mesaj, evalyasyon, elatriye, san n pa
-- gen pou dwaplike tout enfrastrikti a nan yon dezyèm tab apa.
-- ════════════════════════════════════════════════════
