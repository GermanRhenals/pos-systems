import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return respond({ error: 'Authentication required' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return respond({ error: 'Server configuration is incomplete' }, 500)

  const accessToken = authorization.replace(/^Bearer\s+/i, '')
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: authData, error: authError } = await authClient.auth.getUser(accessToken)
  if (authError || !authData.user) return respond({ error: 'Authentication failed' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: actor, error: actorError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .maybeSingle()
  if (actorError) return respond({ error: 'Could not verify account permissions' }, 500)
  if (actor?.role !== 'admin') return respond({ error: 'Administrator access required' }, 403)
  const { data: rootActor, error: rootActorError } = await adminClient
    .from('root_users')
    .select('id')
    .eq('id', authData.user.id)
    .maybeSingle()
  if (rootActorError) return respond({ error: 'Could not verify account permissions' }, 500)
  if (rootActor) return respond({ error: 'Root accounts cannot use establishment staff management' }, 403)

  let payload: { action?: string; establishmentId?: string; id?: string; name?: string; username?: string; password?: string; role?: string; zone?: string }
  try {
    payload = await request.json()
  } catch {
    return respond({ error: 'Invalid request body' }, 400)
  }

  if (!payload.establishmentId) return respond({ error: 'Establishment is required' }, 400)
  const { data: establishment, error: establishmentError } = await adminClient
    .from('establishments')
    .select('id')
    .eq('id', payload.establishmentId)
    .eq('owner_id', authData.user.id)
    .maybeSingle()
  if (establishmentError) return respond({ error: 'Could not verify establishment access' }, 500)
  if (!establishment) return respond({ error: 'Establishment not found' }, 404)

  if (payload.action === 'delete') {
    if (!payload.id) return respond({ error: 'User id is required' }, 400)
    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('id, role, establishment_id')
      .eq('id', payload.id)
      .maybeSingle()
    if (targetError) return respond({ error: 'Could not verify target account' }, 500)
    if (!target || target.role === 'admin' || target.establishment_id !== establishment.id) {
      return respond({ error: 'Staff account not found in this establishment' }, 404)
    }
    const { error } = await adminClient.auth.admin.deleteUser(target.id)
    if (error) return respond({ error: error.message }, 400)
    return respond({ success: true })
  }

  if (payload.action !== 'create') return respond({ error: 'Unsupported action' }, 400)
  const username = payload.username?.trim().toLowerCase().replace(/\s+/g, '.')
  const role = payload.role
  const name = payload.name?.trim()
  const password = payload.password
  if (!name || !username || !password || !/^[a-z0-9._-]{3,32}$/.test(username) || password.length < 8) {
    return respond({ error: 'Provide a valid name, username and password of at least 8 characters' }, 400)
  }
  if (role !== 'waiter' && role !== 'bar') return respond({ error: 'Invalid staff role' }, 400)

  const { data: existing, error: existingError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()
  if (existingError) return respond({ error: 'Could not verify username availability' }, 500)
  if (existing) return respond({ error: 'That username is already in use' }, 409)

  const syntheticEmail = `${username}@staff.${new URL(supabaseUrl).hostname}`
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: syntheticEmail,
    password,
    email_confirm: true,
    app_metadata: { role, username, full_name: name, zone: role === 'bar' ? 'Bar' : (payload.zone ?? ''), establishment_id: establishment.id },
  })
  if (createError) return respond({ error: createError.message }, 400)
  return respond({ success: true, id: created.user.id })
})
