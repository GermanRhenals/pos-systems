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
  const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(accessToken)
  if (claimsError || claimsData?.claims.aal !== 'aal2') return respond({ error: 'Root access requires multi-factor authentication' }, 403)

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: root, error: rootError } = await adminClient
    .from('root_users')
    .select('id')
    .eq('id', authData.user.id)
    .maybeSingle()
  if (rootError) return respond({ error: 'Could not verify root access' }, 500)
  if (!root) return respond({ error: 'Root access required' }, 403)

  let payload: {
    action?: string
    targetUserId?: string
    establishmentId?: string
    fullName?: string
    email?: string
    name?: string
    city?: string
    country?: string
    taxId?: string
    active?: boolean
  }
  try {
    payload = await request.json()
  } catch {
    return respond({ error: 'Invalid request body' }, 400)
  }

  const isProtectedTarget = async (userId: string) => {
    const { data, error } = await adminClient
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', userId)
      .eq('role', 'admin')
      .maybeSingle()
    if (error) throw new Error('Could not verify administrator account')
    if (!data) return null
    const { data: targetRoot, error: targetRootError } = await adminClient
      .from('root_users')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
    if (targetRootError) throw new Error('Could not verify protected root account')
    if (targetRoot) return null
    return data
  }

  const writeAudit = async (action: string, targetUserId: string, details: Record<string, unknown>) => {
    const { error } = await adminClient.from('root_audit_log').insert({
      actor_id: authData.user.id,
      action,
      target_user_id: targetUserId,
      details,
    })
    if (error) throw new Error('The change succeeded but its audit entry could not be recorded')
  }

  try {
    if (payload.action === 'list') {
      const { data: profiles, error: profilesError } = await adminClient
        .from('profiles')
        .select('id, full_name, created_at')
        .eq('role', 'admin')
        .order('created_at', { ascending: false })
        .limit(100)
      if (profilesError) return respond({ error: 'Could not load administrator accounts' }, 500)

      const accounts = []
      for (const profile of profiles ?? []) {
        const { data: targetRoot, error: targetRootError } = await adminClient
          .from('root_users')
          .select('id')
          .eq('id', profile.id)
          .maybeSingle()
        if (targetRootError) return respond({ error: 'Could not verify protected accounts' }, 500)
        if (targetRoot) continue
        const [{ data: authAccount, error: authAccountError }, { data: establishments, error: establishmentsError }] = await Promise.all([
          adminClient.auth.admin.getUserById(profile.id),
          adminClient.from('establishments').select('id, name, city, country, tax_id').eq('owner_id', profile.id).order('created_at'),
        ])
        if (authAccountError || establishmentsError) return respond({ error: 'Could not load administrator details' }, 500)
        if (!authAccount.user) continue
        accounts.push({
          id: profile.id,
          fullName: profile.full_name,
          email: authAccount.user.email ?? '',
          createdAt: authAccount.user.created_at,
          lastSignInAt: authAccount.user.last_sign_in_at,
          emailConfirmedAt: authAccount.user.email_confirmed_at,
          bannedUntil: authAccount.user.banned_until,
          establishments: (establishments ?? []).map((establishment) => ({
            id: establishment.id,
            name: establishment.name,
            city: establishment.city,
            country: establishment.country,
            taxId: establishment.tax_id,
          })),
        })
      }
      const { data: audit, error: auditError } = await adminClient
        .from('root_audit_log')
        .select('id, action, target_user_id, details, created_at')
        .eq('actor_id', authData.user.id)
        .order('created_at', { ascending: false })
        .limit(30)
      if (auditError) return respond({ error: 'Could not load audit history' }, 500)
      return respond({ accounts, audit })
    }

    if (!payload.targetUserId) return respond({ error: 'Administrator account is required' }, 400)
    const target = await isProtectedTarget(payload.targetUserId)
    if (!target) return respond({ error: 'Administrator account not found or protected' }, 404)

    if (payload.action === 'update_admin') {
      const fullName = payload.fullName?.trim()
      const email = payload.email?.trim().toLowerCase()
      if (!fullName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return respond({ error: 'Provide a valid administrator name and email' }, 400)
      }
      const { data: authAccount, error: authAccountError } = await adminClient.auth.admin.getUserById(target.id)
      if (authAccountError || !authAccount.user) return respond({ error: 'Could not load administrator account' }, 500)
      const { error: profileUpdateError } = await adminClient
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', target.id)
        .eq('role', 'admin')
      if (profileUpdateError) return respond({ error: 'Could not update administrator profile' }, 500)
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(target.id, { email, email_confirm: true })
      if (authUpdateError) {
        const { error: rollbackError } = await adminClient.from('profiles').update({ full_name: target.full_name }).eq('id', target.id)
        if (rollbackError) return respond({ error: 'Email update failed and the profile name rollback also failed' }, 500)
        return respond({ error: 'Could not update administrator email: ' + authUpdateError.message }, 400)
      }
      await writeAudit('update_admin', target.id, {
        before: { fullName: target.full_name, email: authAccount.user.email },
        after: { fullName, email },
      })
      return respond({ success: true })
    }

    if (payload.action === 'update_establishment') {
      const name = payload.name?.trim()
      const city = payload.city?.trim()
      const country = payload.country?.trim()
      const taxId = payload.taxId?.trim()
      if (!payload.establishmentId || !name || !city || !country || !taxId) {
        return respond({ error: 'Complete all establishment fields' }, 400)
      }
      const { data: before, error: lookupError } = await adminClient
        .from('establishments')
        .select('id, name, city, country, tax_id')
        .eq('id', payload.establishmentId)
        .eq('owner_id', target.id)
        .maybeSingle()
      if (lookupError) return respond({ error: 'Could not verify establishment' }, 500)
      if (!before) return respond({ error: 'Establishment not found for this administrator' }, 404)
      const { error: updateError } = await adminClient
        .from('establishments')
        .update({ name, city, country, tax_id: taxId })
        .eq('id', before.id)
        .eq('owner_id', target.id)
      if (updateError) return respond({ error: 'Could not update establishment' }, 500)
      await writeAudit('update_establishment', target.id, {
        establishmentId: before.id,
        before: { name: before.name, city: before.city, country: before.country, taxId: before.tax_id },
        after: { name, city, country, taxId },
      })
      return respond({ success: true })
    }

    if (payload.action === 'set_status') {
      if (typeof payload.active !== 'boolean') return respond({ error: 'Account status is required' }, 400)
      const { data: authAccount, error: authAccountError } = await adminClient.auth.admin.getUserById(target.id)
      if (authAccountError || !authAccount.user) return respond({ error: 'Could not load administrator account' }, 500)
      const { error: updateError } = await adminClient.auth.admin.updateUserById(target.id, {
        ban_duration: payload.active ? 'none' : '876000h',
      })
      if (updateError) return respond({ error: 'Could not update account status: ' + updateError.message }, 400)
      await writeAudit('set_status', target.id, {
        before: { bannedUntil: authAccount.user.banned_until ?? null },
        after: { active: payload.active },
      })
      return respond({ success: true })
    }

    return respond({ error: 'Unsupported action' }, 400)
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : 'Unexpected root console error' }, 500)
  }
})
