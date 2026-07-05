-- ════════════════════════════════════════════════════
-- SISTÈM REFERANS / PARENNAJ — migrasyon Supabase
-- Egzekite sa nan Supabase SQL Editor.
-- ════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS referral_rewarded boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON profiles(referred_by);

-- RLS: tout moun ka wè referral_code (li parèt nan lyen piblik), men sèlman
-- backend (service_role) ka modifye li. Pa gen nouvo tab, donk pa gen
-- nouvo policy obligatwa — profiles ta dwe deja gen RLS aktive ak yon
-- policy SELECT piblik. Si w pa sèten, tcheke Authentication > Policies.
