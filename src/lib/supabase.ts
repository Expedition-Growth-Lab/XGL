import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://gmcmueoxitzyriifavxs.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_pQGqvQtkJI1E2MnaKxQj6w_9OKtiRUt';

export function createPublicClient() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function createBrowserClient() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
