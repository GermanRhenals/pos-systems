import { createClient } from '@supabase/supabase-js'

// Only the browser-safe project URL and publishable key belong in frontend variables.
// The service-role key is reserved for trusted server-side environments.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null

export const staffAuthEmail = (username: string) => {
  if (!supabaseUrl) return ''
  // Staff sign in with usernames that map to the synthetic email format provisioned by manage-staff.
  return `${username}@staff.${new URL(supabaseUrl).hostname}`
}
