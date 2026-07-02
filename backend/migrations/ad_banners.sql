-- ════════════════════════════════════════════════════
-- ESPAS PIBLISITE (Ad Banners) — migrasyon Supabase
-- Egzekite sa nan Supabase SQL Editor anvan ou deplwaye
-- nouvo kòd backend la.
-- ════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ad_banners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  image_url   text NOT NULL,
  link_url    text NOT NULL,
  position    text NOT NULL DEFAULT 'akey_anwo'
                CHECK (position IN ('akey_anwo', 'akey_mitan', 'sidebar', 'paj_anons')),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  clicks      integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_banners_position_active ON ad_banners(position, is_active);

-- ════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — backend lan sèvi ak SERVICE_ROLE key (pase RLS
-- otomatikman). Men nou aktive RLS ak yon règ lekti piblik pou banner
-- aktif yo, pou frontend ka li yo dirèkteman si l bezwen (opsyonèl,
-- backend deja ekspoze /api/ads pou sa).
-- ════════════════════════════════════════════════════

ALTER TABLE ad_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tout moun ka wè banner aktif" ON ad_banners;
CREATE POLICY "Tout moun ka wè banner aktif"
  ON ad_banners FOR SELECT
  USING (is_active = true);

-- Pa gen policy INSERT/UPDATE/DELETE pou anon/authenticated — sèl fason
-- pou modifye tab sa a se pa backend lan (service_role) nan admin.html.
