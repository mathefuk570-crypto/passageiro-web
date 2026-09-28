import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  'https://wtfceelwjauydzilmfzy.supabase.co';

const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZmNlZWx3amF1eWR6aWxtZnp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMzc4NjgsImV4cCI6MjA5OTkxMzg2OH0.80T5FnZWlYHSaIQqxnMk9Ug00DVxFMzQR9FEvtCv-CE';

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
