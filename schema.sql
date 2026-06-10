-- ════════════════════════════════════════════════════════════════════════
-- FirstRow VR · Esquema de base de datos (Supabase / Postgres)
-- ════════════════════════════════════════════════════════════════════════
-- Este archivo documenta el esquema actual de la base de datos.
-- Las tablas YA están creadas en producción (Supabase dashboard).
-- Este archivo sirve como:
--   1. Referencia para entender qué espera el frontend.
--   2. Punto de partida si hay que recrear o migrar el proyecto.
--   3. Documentación de las políticas RLS que DEBEN estar activas.
--
-- Para aplicar este schema desde cero:
--   - Supabase Dashboard → SQL Editor → New query → pegar este archivo → Run.
--
-- IMPORTANTE: cualquier cambio que hagas en producción (nuevas columnas,
-- índices, policies, etc.), reflejarlo aquí para no perder el rastro.
-- ════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────
-- TABLA: profiles
-- Datos públicos del usuario (lo que va más allá de auth.users).
-- Actualmente: nombre completo. El email vive en auth.users.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Cada usuario solo ve y modifica su propia fila.
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);


-- ──────────────────────────────────────────────────────────────────────
-- TABLA: user_subscriptions
-- Suscripción activa del usuario. plan_id: 'free' | 'basic' | 'premium'.
-- status: 'active' | 'cancelled' | 'expired'. Hoy se crea manualmente
-- (no hay pasarela de pago). Una fila por suscripción; la más reciente
-- con status='active' es la vigente.
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id     text NOT NULL CHECK (plan_id IN ('free','basic','premium')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_active
  ON public.user_subscriptions (user_id, started_at DESC)
  WHERE status = 'active';

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Solo lectura para el dueño. Inserts/updates se hacen desde el backend
-- (cuando exista) o desde el dashboard de Supabase como admin.
CREATE POLICY "subscriptions_select_own"
  ON public.user_subscriptions FOR SELECT
  USING (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────────────────
-- TABLA: video_tickets
-- Cada compra o alquiler de un video puntual.
-- ticket_type: 'buy' (acceso permanente) | 'rent' (con expires_at).
-- video_id: el slug usado en VIDEO_CATALOG ('danza', 'cocina', etc).
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.video_tickets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id      text NOT NULL,
  ticket_type   text NOT NULL CHECK (ticket_type IN ('buy','rent')),
  purchased_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_video_tickets_user
  ON public.video_tickets (user_id, purchased_at DESC);

ALTER TABLE public.video_tickets ENABLE ROW LEVEL SECURITY;

-- Solo lectura para el dueño. Inserts vendrán del backend de pagos.
CREATE POLICY "tickets_select_own"
  ON public.video_tickets FOR SELECT
  USING (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────────────────
-- TRIGGER: mantener profiles.updated_at al día
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ──────────────────────────────────────────────────────────────────────
-- TRIGGER: crear fila en profiles al registrarse un usuario
-- Toma full_name de raw_user_meta_data (donde signUp lo guarda).
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ════════════════════════════════════════════════════════════════════════
-- CHECKLIST DE VERIFICACIÓN MANUAL EN SUPABASE DASHBOARD
-- ════════════════════════════════════════════════════════════════════════
-- [ ] Authentication → URL Configuration
--       Site URL: https://firstrow.cl
--       Redirect URLs incluye: https://firstrow.cl/login.html
--
-- [ ] Authentication → Providers → Email
--       "Confirm email" habilitado o deshabilitado según política deseada.
--
-- [ ] Database → Tables → cada tabla muestra "RLS enabled" (candado verde).
--
-- [ ] Database → Policies → revisar que existen las 4 policies de arriba.
--
-- [ ] (Pendiente) Edge Functions / backend → para INSERT en
--     user_subscriptions y video_tickets cuando exista pasarela de pago.
-- ════════════════════════════════════════════════════════════════════════
