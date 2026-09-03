CREATE OR REPLACE FUNCTION public.bootstrap_account(_user_id uuid, _teacher_name text DEFAULT '', _school text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, teacher_name, school)
  VALUES (_user_id, COALESCE(_teacher_name, ''), COALESCE(_school, ''))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.subscriptions (user_id)
  VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM public.ensure_fixed_admin(_user_id);
END $$;

GRANT EXECUTE ON FUNCTION public.bootstrap_account(uuid, text, text) TO authenticated, service_role;
