-- Enum
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','moderator','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  teacher_name text NOT NULL DEFAULT '',
  school text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Fixed owner account
CREATE OR REPLACE FUNCTION public.fixed_admin_email()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'uuxz272@gmail.com'::text $$;

CREATE OR REPLACE FUNCTION public.is_fixed_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = _user_id AND lower(u.email) = public.fixed_admin_email()
  )
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (_role = 'admin' AND public.is_fixed_admin(_user_id))
      OR EXISTS (
        SELECT 1 FROM public.user_roles r
        WHERE r.user_id = _user_id AND r.role = _role
      )
$$;

-- Subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  generations_used integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own subscription select" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own subscription insert" ON public.subscriptions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own subscription update" ON public.subscriptions FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Activation codes
CREATE TABLE IF NOT EXISTS public.activation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  plan text NOT NULL,
  duration_days integer NOT NULL DEFAULT 30,
  max_uses integer NOT NULL DEFAULT 1,
  used_count integer NOT NULL DEFAULT 0,
  note text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.activation_codes TO authenticated;
GRANT ALL ON public.activation_codes TO service_role;
ALTER TABLE public.activation_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage codes" ON public.activation_codes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES public.activation_codes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  device_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.code_redemptions TO authenticated;
GRANT ALL ON public.code_redemptions TO service_role;
ALTER TABLE public.code_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own redemptions" ON public.code_redemptions FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Lessons
CREATE TABLE IF NOT EXISTS public.user_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  package jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_lessons TO authenticated;
GRANT ALL ON public.user_lessons TO service_role;
ALTER TABLE public.user_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own lessons" ON public.user_lessons FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.lesson_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  title text NOT NULL,
  package jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lesson_shares TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_shares TO authenticated;
GRANT ALL ON public.lesson_shares TO service_role;
ALTER TABLE public.lesson_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public share read" ON public.lesson_shares FOR SELECT TO anon USING (true);
CREATE POLICY "own shares" ON public.lesson_shares FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Permanent admin guard: role row can never be removed or downgraded
CREATE OR REPLACE FUNCTION public.protect_fixed_admin_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'admin' AND public.is_fixed_admin(OLD.user_id) THEN
      RETURN NULL; -- silently keep the owner's admin row
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.role = 'admin' AND public.is_fixed_admin(OLD.user_id) AND NEW.role <> 'admin' THEN
    NEW.role := 'admin';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_fixed_admin_role ON public.user_roles;
CREATE TRIGGER protect_fixed_admin_role
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.protect_fixed_admin_role();

-- Permanent admin guard: restore role + premium subscription whenever the
-- owner account touches the app again (new signup, migration, restore).
CREATE OR REPLACE FUNCTION public.ensure_fixed_admin(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_fixed_admin(_user_id) THEN RETURN; END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.subscriptions (user_id, plan, status, expires_at, generations_used)
  VALUES (_user_id, 'yearly', 'active', now() + interval '100 years', 0)
  ON CONFLICT (user_id) DO UPDATE
    SET plan = 'yearly', status = 'active',
        expires_at = GREATEST(COALESCE(public.subscriptions.expires_at, now()), now() + interval '100 years'),
        updated_at = now();

  INSERT INTO public.code_redemptions (code_id, user_id)
  SELECT c.id, _user_id FROM public.activation_codes c
  WHERE c.code = 'UUXZ@272'
    AND NOT EXISTS (
      SELECT 1 FROM public.code_redemptions r WHERE r.code_id = c.id AND r.user_id = _user_id
    );
END $$;

CREATE OR REPLACE FUNCTION public.ensure_fixed_admin_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.ensure_fixed_admin(
    CASE TG_TABLE_NAME WHEN 'profiles' THEN NEW.id ELSE NEW.user_id END
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ensure_fixed_admin_on_profile ON public.profiles;
CREATE TRIGGER ensure_fixed_admin_on_profile
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_fixed_admin_trg();

DROP TRIGGER IF EXISTS ensure_fixed_admin_on_subscription ON public.subscriptions;
CREATE TRIGGER ensure_fixed_admin_on_subscription
AFTER INSERT ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.ensure_fixed_admin_trg();

-- Owner serial, always present
INSERT INTO public.activation_codes (code, plan, duration_days, max_uses, note, active)
VALUES ('UUXZ@272', 'yearly', 36500, 1000000, 'سيريال المالك الدائم', true)
ON CONFLICT (code) DO UPDATE
  SET plan = 'yearly', duration_days = 36500, max_uses = 1000000, active = true;
