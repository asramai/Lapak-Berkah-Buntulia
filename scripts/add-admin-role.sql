-- Add 'admin' role to users table constraint
-- Run in Supabase SQL Editor

-- 1. Drop existing constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. Add new constraint with admin role
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'owner', 'mitra', 'kasir'));

-- 3. Update INSERT policy for users to allow admin role
DROP POLICY IF EXISTS "users_tambah_mitra" ON users;
CREATE POLICY "users_tambah_all" ON users
  FOR INSERT TO anon, authenticated
  WITH CHECK (role IN ('admin', 'owner', 'mitra', 'kasir'));

-- 4. Verify
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'users'::regclass AND contype = 'c';