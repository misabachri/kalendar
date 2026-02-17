import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PersistedState } from './storage';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const SUPABASE_SYNC_KEY = (import.meta.env.VITE_SUPABASE_SYNC_KEY as string | undefined) ?? 'default';
const SUPABASE_TABLE = (import.meta.env.VITE_SUPABASE_SYNC_TABLE as string | undefined) ?? 'kalendar_sync';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return null;
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}

export function isCloudSyncEnabled(): boolean {
  return Boolean(getClient());
}

export async function loadCloudState(): Promise<PersistedState | null> {
  const supabase = getClient();
  if (!supabase) {
    return null;
  }
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select('payload')
    .eq('sync_key', SUPABASE_SYNC_KEY)
    .maybeSingle();
  if (error) {
    console.warn('Cloud sync load failed:', error.message);
    return null;
  }
  const payload = data?.payload;
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  return payload as PersistedState;
}

export async function saveCloudState(state: PersistedState): Promise<void> {
  const supabase = getClient();
  if (!supabase) {
    return;
  }
  const { error } = await supabase
    .from(SUPABASE_TABLE)
    .upsert(
      {
        sync_key: SUPABASE_SYNC_KEY,
        payload: state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'sync_key' },
    );
  if (error) {
    console.warn('Cloud sync save failed:', error.message);
  }
}
