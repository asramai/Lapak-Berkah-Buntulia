import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

// Siapa yang sedang mengubah data. diinjeksi ke setiap request sebagai header
// x-actor, lalu dibaca trigger audit di database. Ini bukan kontrol akses,
// hanya atribusi: kalau header tidak ada, jejak audit tetap tercatat tanpa nama.
let auditActor = null;

export function setAuditActor(actor) {
  auditActor = actor && actor.email ? String(actor.email) : null;
}

const fetchAsal = globalThis.fetch.bind(globalThis);

const fetchDenganAktor = (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  if (auditActor) headers.set('x-actor', auditActor);
  return fetchAsal(input, { ...init, headers });
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchDenganAktor },
});
