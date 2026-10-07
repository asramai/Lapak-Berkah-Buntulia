-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Function to hash password before insert/update
CREATE OR REPLACE FUNCTION hash_user_password()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.password IS NOT NULL AND NEW.password != '' THEN
    -- Only hash if password is not already a bcrypt hash
    IF NEW.password !~ '^\$2[aby]\$' THEN
      NEW.password = crypt(NEW.password, gen_salt('bf', 10));
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-hash passwords
DROP TRIGGER IF EXISTS hash_user_password_trigger ON users;
CREATE TRIGGER hash_user_password_trigger
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION hash_user_password();
-- Login RPC function using crypt() for secure comparison
-- Role auto-detected from database (no p_role parameter)

CREATE OR REPLACE FUNCTION login_user(p_email TEXT, p_password TEXT)
RETURNS TABLE(id UUID, email TEXT, role TEXT, nama TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.role, u.nama
  FROM users u
  WHERE u.email = p_email
    AND u.password = crypt(p_password, u.password);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp;

REVOKE ALL ON FUNCTION login_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_user(TEXT, TEXT) TO anon, authenticated;
