CREATE UNIQUE INDEX IF NOT EXISTS activation_codes_code_key ON public.activation_codes (code);

INSERT INTO public.activation_codes (id, code, plan, duration_days, max_uses, used_count, note, active)
VALUES
  ('9e188386-1d26-4fa2-93d3-5f385ff11e14', 'PVBZ-L7GK-Z67H', 'monthly', 8, 30, 0, 'هدية 8 أيام', true),
  ('7542c050-3e54-4a45-8868-2dd1cc7d9c5d', 'UUXZ@272', 'yearly', 36500, 1000, 0, 'سيريال الأدمن', true)
ON CONFLICT (code) DO UPDATE
  SET plan = EXCLUDED.plan,
      duration_days = EXCLUDED.duration_days,
      max_uses = EXCLUDED.max_uses,
      note = EXCLUDED.note,
      active = true,
      expires_at = NULL;