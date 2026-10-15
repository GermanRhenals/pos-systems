# Análisis completo y detallado del proyecto Kuantika POS

> Documento generado a partir de la lectura directa del repositorio: `src/App.tsx` (completo), `src/domain/operational.ts`, `src/supabase.ts`, `src/components/PrivacyNotice.tsx`, todas las migraciones SQL (`20261006000000_initial_schema.sql`, `20261007000000_root_operator.sql`, `20261008000000_operational_state.sql`, `20261009000000_root_sandbox.sql`), Edge Functions (`supabase/functions/manage-staff/index.ts`, `supabase/functions/root-console/index.ts`), `supabase/config.toml`, `vite.config.ts`, `package.json`, `.oxlintrc.json`, `.github/workflows/deploy.yml`, `README.md` completo, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `POLITICA-DERECHOS-AUTOR.md`, `index.html`, `src/main.tsx`, `tsconfig*.json`.

---

## 1. Flujo completo: creación establecimiento, registro admin, creación staff, turno (inicio/cierre), pedido mesero → bar despacha → ventas → cierre/reporte

### 1.1 Creación de establecimiento y registro del administrador

1. **Registro de administrador**: El primer actor es un administrador dueño. Se registra con correo y contraseña desde el login (modo `register` en `App.tsx`). Al hacer signup (`signUpAdministrator`, `src/App.tsx:644-666`), Supabase crea usuario en `auth.users`. El trigger `handle_new_user()` en `20261006000000_initial_schema.sql:54-90` detecta `role='admin'` y crea `profiles` con `role='admin'`, `establishment_id` nulo, y `full_name` desde metadatos.
2. **Creación de establecimiento**: Tras autenticarse como admin, en la vista "Establecimientos" (`src/App.tsx:945`) completa nombre, país, ciudad e identificación fiscal. Al enviar, inserta en `public.establishments` con `owner_id = auth.uid()` (política INSERT `Owners can create establishments`, migración inicial + ajustes en sandbox). En cliente (`src/App.tsx:831-860`): crea fila vía Supabase, añade al estado local `establishments`, inicializa `operational_state` vacío (`revision 0`, snapshot vacío) y selecciona el establecimiento activo. En BD, el admin es dueño (`establishments.owner_id`).
3. **Primer import legacy**: Cuando el admin inicia sesión, el cliente carga sus establecimientos (`src/App.tsx:203-305`) y para cada uno lee `operational_state`. Si no existe fila y es admin, intenta importar desde `localStorage` (legacy): toma `loadRecords(recordsStorageKey)` y `readTurnStates(turnsStorageKey)`, construye `OperationalState` con `operationalStateFor(...)` y lo hidrata en memoria (`src/App.tsx:236-274`). Una vez que existe la fila en DB, la fuente es autoritaria.

### 1.2 Creación de staff (meseros/bar)

1. **Acceso requerido**: Solo un administrador autenticado (o root en su sandbox) invoca `manage-staff` Edge Function. Creación vía UI en vista "Usuarios" (`src/App.tsx:947`): formulario requiere nombre completo, usuario (3-32, `[a-z0-9._-]{3,32}` normalizado), contraseña (>=8), rol (`waiter|bar`) y zona para mesero (`src/App.tsx:785-820`).
2. **Llamada a función**: `supabase.functions.invoke('manage-staff', { body: { action: 'create', establishmentId, name, username, password, role, zone } })` (`src/App.tsx:792-802`). Validaciones servidor (`manage-staff/index.ts`): JWT válido, actor es admin; si root, exige `aal2` y establecimiento es su sandbox (`is_sandbox`). Verifica que el establecimiento pertenece al actor (`owner_id = auth.uid()`). Username normalizado y validado, rol válido. Comprueba unicidad en `profiles.username`. Crea usuario Auth con correo sintético `username@staff.<project-host>` (`new URL(supabaseUrl).hostname`), `email_confirm: true`, y `app_metadata` contiene `role, username, full_name, zone, establishment_id`. Retorna `id`.
3. **Refresco en cliente**: Tras éxito, se lee el perfil recién creado de `profiles` y se añade a `users` del establecimiento (`src/App.tsx:804-817`). Staff no se guarda en `operational_state`, vive en `profiles` (`docs/DATABASE.md:39`). Eliminación: función `delete` borra cuentas no-admin del mismo establecimiento (`manage-staff/index.ts:75-89`); UI confirma antes (`src/App.tsx:821-830`).

### 1.3 Inicio y cierre de turno

1. **Modelo**: Turno = `{ startedAt: number, endedAt: number|null }` en estado operativo (`src/domain/operational.ts:13`, `OperationalState.turn`).
2. **Inicio**: Solo admin (`isAdmin`) puede iniciar turno cuando está cerrado (`activeTurn.endedAt !== null`). `startTurn()` (`src/App.tsx:692-698`) establece `startedAt = Date.now()`, `endedAt = null` y actualiza `turns[establishmentId]`; esto provoca efecto de persistencia que guarda estado vía RPC.
3. **Cierre**: `finishTurn()` (`src/App.tsx:685-691`) establece `endedAt = Date.now()` (no cambia `startedAt`). UI muestra duración (`formatDuration`) y vista "Cierre de turno" con totales del turno (`src/App.tsx:955`).
4. **Restricciones operativas**: Mientras `endedAt !== null` (turno cerrado), meseros no pueden agregar productos al carrito ni enviar solicitudes (`src/App.tsx:754`, `777`); bar no puede despachar/pagar (`src/App.tsx:711`). Solo admin inicia/cierra.
5. **Bootstrap**: `initializeTurnStates()` lee legacy localStorage y crea turnos faltantes (`src/domain/operational.ts:114-129`).

### 1.4 Pedido mesero → bar despacha → ventas → cierre/reporte

1. **Pedido mesero** (`createWaiterRequest`, `src/App.tsx:752-775`): Requiere turno abierto. Toma carrito `waiterCart` (productoId → cantidad), valida stock suficiente contra `latestRecords.products` (`stockShortages`), construye `itemsList = { productId, quantity, unitPrice }`, calcula total. Crea `Request` con `id = requestedAt`, `requesterId = session.user?.id`, `server = user.name`, `table`, `items` (resumen + total), `itemsList`, `time`, `createdAt`, `status = 'Pendiente'`. Añade a `requests` (prepend). Limpia carrito/formulario. Persistido vía RPC.
2. **Bar recibe**: Vista "Solicitudes" (modo bar) muestra bandeja (`src/App.tsx:953`). Cada solicitud pendiente tiene botón "Despachar".
3. **Despacho bar** (`dispatchRequest(requestId)`, `src/App.tsx:710-746`): Verifica turno abierto. Busca request pendiente con `itemsList`. Chequea stock suficiente para todas las líneas (suma). Si OK, calcula `dispatchedTotal = requestTotal(...)`. Genera `salesToAdd`: por cada línea crea `Sale` con `id = dispatchedAt + line.productId`, `product = name`, `quantity`, `total = unitPrice*quantity`, `time`, `server = request.server`, `createdAt = dispatchedAt`, `requestId`, `requestedAt`, `table`. Actualiza `products`: descuenta `quantity` por línea. Actualiza `sales`: prepend `salesToAdd`. Actualiza `requests`: marca request como `Despachado`. Muestra toast con total.
4. **Ventas**: `Sale` incluye metadatos de pedido (`requestId`, `requestedAt`, `table`) para agrupar por orden (`groupSalesByOrder`, `src/domain/operational.ts:163-185`). Ventas del turno se filtran por `createdAt` entre `startedAt` y `endedAt??now` (`src/App.tsx:116`). Reportes por período (Día/Semana/Mes/Trimestre/Año): `getSalesPeriodBounds` define rangos por calendario local (`src/domain/operational.ts:140-155`), se filtran `allSales` con `createdAt >= start < end`, se calculan totales/unidades y ledger agrupado (`src/App.tsx:124-128`, 949).
5. **Cierre/reporte**: Vista "Cierre de turno" muestra conteo de ventas, total, unidades despachadas, duración del turno y botón para imprimir (`window.print()`, `src/App.tsx:955`).

---

## 2. RPC `save_operational_state`: firma, parámetros, lógica, qué valida por rol, conflictos, security definer, aislamiento por tenant

**Firma**: `public.save_operational_state(target_establishment_id uuid, new_state jsonb, expected_revision bigint) RETURNS bigint` (`20261008000000_operational_state.sql:28-37`).

**Parámetros**: `target_establishment_id` (inquilino), `new_state` (payload `{ products,sales,requests,turn }`), `expected_revision` (optimistic locking; 0 solo para creación inicial).

**Lógica transaccional** (bloqueo por tenant):

1. **Tenant check**: Llama `public.can_access_establishment(target_establishment_id)`; si falso → `not authorized for establishment`.
2. **Validación de forma**: Rechaza si `expected_revision is null` o `new_state` no tiene llaves `products,sales,requests,turn` o tipos no son `object/array/object` → `invalid operational state`.
3. **Derivación de rol**: Busca `profiles.role` para `(auth.uid(), establishment_id)`; si no encuentra, intenta como owner de `establishments`; si sigue nulo → `not authorized for operational state`. **Nunca** toma rol del cliente.
4. **Bloqueo fila**: `SELECT os.revision, os.state FROM public.operational_state os WHERE establishment_id = target_id FOR UPDATE`.
5. **Caso fila inexistente**: Si no found: solo permite si `expected_revision == 0 AND caller_role == 'admin'` → `INSERT` con `state=new_state`, `revision=1` (default) o retorna nueva; si no cumple → `operational state changed; reload and retry`. Si insert choca (race) → retry con mismo error.
6. **Caso existe**: Si `current_revision != expected_revision` → `operational state changed; reload and retry`.
7. **Validación específica por rol** (antes de UPDATE):
   - **waiter** (`20261008000000_operational_state.sql:113-133`):
     - No debe modificar `products`, `sales`, `turn`.
     - Debe satisfacer `new_state->'requests' @> current_state->'requests'` (no puede borrar requests existentes; solo añadir).
     - Para cada request **nuevo** (no presente antes): `requesterId == auth.uid()::text` Y `status == 'Pendiente'`. No puede modificar requests existentes.
   - **bar** (`134-291`):
     - `turn` inmutable.
     - `sales` no puede disminuir (debe contener todas las ventas anteriores): `new_state->'sales' @> current_state->'sales'`.
     - Tamaño de `requests` no cambia excepto dos casos válidos: longitud igual (despachos) o longitud 0 (limpiar bandeja). Si pasa a vacío, **todas** las requests anteriores deben tener `status == 'Despachado'` (no puede limpiar pendientes).
     - Para cada request por id: solo puede cambiar `status` de `Pendiente` a `Despachado`; ningún otro campo puede cambiar (`(new_request - 'status') is distinct from (old_request - 'status')` chequeado).
     - Para cada producto existente: no puede borrarse; los campos distintos a `stock` no cambian (`(new_product - 'stock') == (old_product - 'stock')`); `stock` no puede aumentar (`new.stock <= old.stock`, numérico); `stock` no nulo.
     - **Delta de stock obligatorio**: para cada producto, `product_delta = old.stock - new.stock` debe igualar `sum(quantity)` de las requests que pasaron de `Pendiente` a `Despachado` **en ese guardado** y que contienen ese `productId` en `itemsList`.
     - **Despacho → ventas obligatorias**: cuando una request pasa de Pendiente a Despachado, `itemsList` debe existir (array). Por cada ítem, debe existir **exactamente 1 venta nueva** (en `new_state.sales` no contenida antes) con `requestId == request.id`, `product == productName` del producto, `quantity == item.quantity`, `total == unitPrice*quantity` (usa `unitPrice` si existe, sino precio actual del producto). Además, total de ventas nuevas con ese `requestId` == `jsonb_array_length(itemsList)`.
     - **Solo ventas justificadas**: cualquier venta nueva (no en `current_state.sales`) debe corresponder a alguna request que pasó de Pendiente a Despachado y coincidir exactamente con alguno de sus ítems (producto, cantidad, total). No se permiten ventas manuales nuevas por bar.
   - **admin**: pasa sin restricciones adicionales de negocio (sujeto a forma y revisión).
   - Otro rol → `role may not change operational state`.
8. **Escritura**: `UPDATE public.operational_state SET state = new_state, revision = revision + 1, updated_at = now() WHERE establishment_id = target_id RETURNING revision INTO saved_revision; RETURN saved_revision`.
9. **Aislamiento**: `security definer`, `set search_path = ''`. Solo `authenticated` puede ejecutar (`308`). `can_access_establishment` también `security definer` (verifica pertenencia/tenant). RLS select existe (`25`), no hay UPDATE/INSERT directos desde browser.

**Manejo de conflictos**: Cliente serializa por establecimiento (cola + epoch). Al recibir error con mensaje que incluye `operational state changed`, incrementa epoch, recarga última fila (`operational_state` select), parsea estado, actualiza `revision`, `savedOperationalSnapshotRef`, `recordsByEstablishment` y `turns`, y notifica al usuario ("Se cargó la versión más reciente... el cambio en conflicto no se guardó."). Si error no es conflicto de revisión, muestra toast con error. Polling cada 4s detecta revisiones externas y, si hay cambios locales sin guardar (snapshot distinto), avisa en lugar de sobrescribir (`src/App.tsx:366-412`, 413-473).

**Seguridad definer**: Permite ejecutar lógica con privilegios del definidor para validar y bloquear fila, asegurando que las reglas se apliquen aunque el rol `authenticated` no tenga permisos DML directos sobre la tabla.

**Aislamiento por tenant**: Todas las comprobaciones pasan por `can_access_establishment` (dueño o staff asignado). En sandbox, `can_access_establishment` (v4, `20261009000000_root_sandbox.sql:8-48`) permite a `root_users` solo si `e.is_sandbox AND e.owner_id == auth.uid() AND auth.jwt()->>'aal' == 'aal2'`. Esto limita el alcance a su propio sandbox. No hay acceso cruzado entre establecimientos.

---

## 3. RLS: can_access_establishment, políticas, qué tablas protegen, por qué vive en Postgres

### 3.1 Función `can_access_establishment(target_id uuid)`
- `stable`, `security definer`, `set search_path = ''` (`20261006000000_initial_schema.sql:31-52`).
- Retorna `true` si existe establecimiento con `id = target_id` y (`owner_id == auth.uid()` OR existe `profiles` con `id == auth.uid()` y `establishment_id == e.id`).
- Versión 4 (sandbox, `20261009000000_root_sandbox.sql:8-48`): añade rama para root: si `auth.uid()` es `root_users`, entonces requiere `e.is_sandbox`, `e.owner_id == auth.uid()`, `auth.jwt()->>'aal' == 'aal2'`. Si **no** es root, aplica lógica anterior (con pequeñas condiciones en policies). Esto asegura aislamiento estricto del sandbox root.

### 3.2 Tablas protegidas y políticas

- `profiles` (RLS ON, `20261006000000_initial_schema.sql:93-117`, modificado `090000`: `51-72`)
  - SELECT: propio (`id == auth.uid()`) OR (rol waiter/bar y establecimiento al que tiene acceso como owner). En sandbox modificado para excluir root en ciertos casos, pero lectura propia siempre permitida.
- `establishments` (RLS ON, `93-130`, modificado `74-104`)
  - INSERT: owner y **no** root (`090000:77-84`) → evita crear establecimientos para root vía esta política.
  - SELECT: `can_access_establishment(id)`.
  - UPDATE: owner y no root, mismo filtro en USING/WITH CHECK.
- `operational_state` (RLS ON, `20261008000000_operational_state.sql:18-26`)
  - SELECT: `can_access_establishment(establishment_id)`. No hay INSERT/UPDATE/DELETE; escritura solo vía RPC `security definer`.
- `root_users` (RLS ON, `20261007000000_root_operator.sql:17-27`)
  - SELECT: propio (`id == auth.uid()`).
- `root_audit_log` (RLS ON, `29-31`)
  - SELECT: propio como actor (`actor_id == auth.uid()`).

Además: permisos revocados a `anon, authenticated` en todas las tablas y solo concedidos los necesarios; funciones revocadas de público y otorgadas select/execute mínimos.

### 3.3 Por qué seguridad vive en Postgres
- **Frontera inviolable**: UI puede ocultar controles, pero cliente es no confiable. Reglas de negocio críticas (validación de roles, deltas de stock, ventas obligatorias, revisión) se aplican en transacción con bloqueo (`FOR UPDATE`) en servidor.
- **Tenant isolation fuerte**: `can_access_establishment` centraliza autorización. Cambios de esquema/políticas coherentes.
- **Security definer**: permite RPC validar sin dar DML directo; minimiza superficie.
- **AAL2 aplicado en servidor**: root-console exige `aal2` al leer claims (`root-console/index.ts:34`), y `can_access_establishment` también requiere `aal2` para rama root-sandbox.
- **Auditoría forzosa**: mutaciones root van a `root_audit_log` desde Edge Function con verificación servidor.
- Principio: *"la autorización vive en RLS/funciones; ocultar un control de UI no es una frontera de seguridad"* (`docs/ARCHITECTURE.md:25`, `AGENTS.md`).

---

## 4. Root operator: qué puede/hace, sandbox Testing Establecimiento, root_audit_log, requisitos MFA/AAL2, por qué verify_jwt=false

### 4.1 Root operator: qué es
- Rol de soporte/operador del dueño de plataforma. No es rol de cliente. Solo se aprovisiona por base de datos (`README.md:60`): insertar `auth.users` (admin dedicado) y añadir su ID a `public.root_users`. No hay registro público.
- Requiere MFA TOTP (`aal2`) en login y en funciones. Acceso global auditado.

### 4.2 Qué puede hacer
**Consola root (Edge Function `root-console`)** — acciones (`root-console/index.ts:92-323`):
- `ensure_sandbox`: crea (o asegura) **único** `Testing Establecimiento` para ese root (`is_sandbox=true`, índice único parcial `establishments_one_sandbox_per_owner_idx` en `090000:4-6`). Si crea, audita `create_sandbox_establishment`. Si no existe `operational_state`, lo siembra con 8 productos sintéticos (valores aleatorios en stock mínimo/máximo para demo), `sales=[]`, `requests=[]`, `turn = { startedAt: Date.now(), endedAt: null }`. Retorna sandbox.
- `list`: lista **admins** (no root) con detalles de Auth (`email, timestamps, banned_until`) y sus establecimientos. Lista auditoría reciente del propio actor (`root_audit_log` limit 30). Retorna sandbox si existe.
- `update_admin` (target admin no protegido): actualiza `profiles.full_name` y `auth.users.email` (confirma email). Audita before/after.
- `update_establishment` (target admin, establecimiento suyo): actualiza nombre/ciudad/país/tax_id. Audita.
- `set_status`: activa/desactiva cuenta admin vía `ban_duration = 'none' | '876000h'` (suspende/reactiva). Audita.
- Restricciones: solo admins no protegidos (no root). Nunca muestra/modifica contraseñas. Todas las mutaciones auditan en `root_audit_log`.

**En BD/RLS (sandbox)**:
- `can_access_establishment` permite a root acceder **solo** a su sandbox con `aal2`. 
- Políticas: `establishments` INSERT/UPDATE bloqueadas para root (`090000`), evitando crear otros locales. `profiles` lectura ajustada. `operational_state` SELECT permitido solo si pasa `can_access_establishment` (sandbox). Escritura vía RPC: `save_operational_state` valida rol derivado; root **no tiene perfil con rol waiter/bar/admin en ese establecimiento** típico, y además el RPC no permite otro rol distinto a admin/waiter/bar. En sandbox, el root opera como dueño pero el acceso operativo está limitado por RLS/RPC al sandbox; el cliente entra en "Consola root" (`src/App.tsx:194-198`, `555`) y puede "Entrar a probar" (`enterRootSandbox`, `src/App.tsx:513-549`) cargando el estado del sandbox en memoria y activando `rootSandboxActive`.

### 4.3 Sandbox "Testing Establecimiento"
- Creado por `ensure_sandbox`. Único por root (`unique index` parcial). Propietario `owner_id = root.auth.uid()`, `is_sandbox=true`. Nombre fijo "Testing Establecimiento", tax_id basado en ID root. Inventario sintético (8 productos) con stock variable. Estado inicial vacío de ventas/solicitudes y turno abierto.
- Aislamiento: solo root dueño puede verlo (RLS + índice único). No afecta establecimientos de clientes. En UI, banner "Testing Establecimiento · entorno aislado" (`src/App.tsx:879`) y vista previa local distinta de sandbox real.

### 4.4 root_audit_log
Tabla `root_audit_log(id identity, actor_id FK root_users, action text, target_user_id FK auth.users nullable, details jsonb, created_at)`. RLS: solo actor lee sus propios logs (`select` policy). Escritura **solo desde servidor** (Edge Function `root-console`) vía `writeAudit()` (`82-90`): inserta con `actor_id = authData.user.id`. Registra acciones: `create_sandbox_establishment`, `update_admin`, `set_status`, `update_establishment`. Detalles incluyen before/after y `establishmentId` cuando aplica.

### 4.5 Requisitos MFA/AAL2
- Cliente: al hacer signIn, si usuario es `root_users`, obtiene `authenticatorAssuranceLevel()` (`src/App.tsx:571-623`). Si `currentLevel != 'aal2'`, lista factores TOTP; si no hay factor verificado → `enroll({ factorType:'totp', friendlyName:'Kuantika POS Root' })` devuelve QR + secret; siempre hace `challenge` y muestra flujo MFA (`mfaFlow`) para `verify`. Solo tras `verify` exitoso continúa.
- Servidor (Edge Functions): `manage-staff` verifica claims: si actor es root → exige `claims?.claims.aal === 'aal2'` (`manage-staff/index.ts:48-53`). `root-console` exige `claimsData?.claims.aal === 'aal2'` antes de verificar root (`root-console/index.ts:34`). Además BD `can_access_establishment` rama root exige `auth.jwt()->>'aal' == 'aal2'` (`090000:28`).
- Config: Supabase Auth con MFA TOTP habilitado (recomendado). Email/password habilitado.

### 4.6 Por qué verify_jwt=false en root-console
`supabase/config.toml:6-7` establece `[functions.root-console] verify_jwt = false`. Razón explícita: la función valida el bearer token manualmente (`authClient.auth.getUser(accessToken)`), exige `aal2` (`getClaims`) y comprueba `root_users` (`root-console/index.ts:19-44`). Esto evita que la verificación JWT automática bloquee o interfiera con la validación explícita de AAL2 y con el control fino necesario para la consola privilegiada. También asegura que la lógica de autorización (root + MFA) se ejecute explícitamente en código servidor.

---

## 5. Estado autoritario vs localStorage (exactamente cuándo usa localStorage)

- **Fuente autoritaria**: `public.operational_state` (Postgres). Cada establecimiento tiene una fila `{ state jsonb, revision bigint, updated_at }`. Único camino de escritura: RPC `save_operational_state`. Lectura: SELECT con RLS.
- **localStorage NO es fuente de registros de negocio** (`README.md:70`, `AGENTS.md`: "Do not treat `localStorage` as the source of business records — only for legacy first-admin import, establishment prefs, and turn bootstrap").
- **Cuándo SÍ usa localStorage (exacto)**:
  1. **Preferencias/UI no operativas**: `establishmentsStorageKey = 'barflow-establishments'` se escribe al cambiar lista de establecimientos (`src/App.tsx:139`) y se lee en inicialización para seleccionar establecimiento activo (`src/App.tsx:86-91`) — esto es preferencia de navegador (último local seleccionado) pero la lista autorizada viene de BD tras login; tras hidratar desde BD, el estado se sincroniza.
  2. **Legacy first-admin import**: En hidratación de sesión (`src/App.tsx:236-274`), para cada establecimiento, si **no existe fila en `operational_state`** (`row` es undefined) **y el perfil es admin**, entonces construye estado desde `legacyRecords = loadRecords(localStorage.getItem(recordsStorageKey))` y `legacyTurns = readTurnStates(localStorage.getItem(turnsStorageKey))` usando `operationalStateFor(legacyRecords[id] ?? initial, fallbackTurn)`. **Staff no hace este import** (si no existe fila para staff, muestra error pidiendo al admin iniciar sesión). Este import ocurre **solo una vez** (mientras no exista fila en DB). Tras guardar por primera vez vía RPC, DB manda.
  3. **Bootstrap de turnos/legacy normalization**: `initializeTurnStates(establishmentIds)` lee `turnsStorageKey` y completa turnos faltantes escribiendo de vuelta si cambió (`src/domain/operational.ts:114-129`). `loadRecords` normaliza estructura antigua (`188-210`).
- **Nunca usa localStorage para escrituras operativas**: Todos los cambios (ventas, requests, productos, turnos) actualizan `recordsByEstablishment`/`turns` en estado React y el efecto (`src/App.tsx:413-473`) llama a `save_operational_state` RPC. No hay escrituras a `recordsStorageKey`/`turnsStorageKey` en runtime tras login con BD activa (solo se leen para import legacy). `establishmentsStorageKey` es preferencia.

En resumen: localStorage = legado + preferencias de navegador. BD = fuente autoritaria de negocio.

---

## 6. Sincronización cross-device (polling cada ~4s), cola, optimistic locking

### 6.1 Polling (lectura periódica)
- Efecto (`src/App.tsx:366-412`): se activa si `supabase`, sesión activa, no root, hay `activeEstablishmentId` y `loadedOperationalRef.current.has(id)`. Intervalo `4000 ms` (`window.setInterval(..., 4000)`).
- Llama `select('state, revision').eq('establishment_id', id).maybeSingle()`.
- Si error de sync: registra `reportedOperationalFailureRef` para evitar spam de toast.
- Si `data.revision == operationalRevisionRef.current[id]` → no hace nada.
- Si distinta: antes de aplicar, construye `localPayload = operationalStateFor(recordsByEstablishment[id], turns[id])` y compara con `savedOperationalSnapshotRef.current[id]` (snapshot JSON del último guardado exitoso). **Si hay cambios locales sin guardar** (`distintos`) → muestra toast "Otro dispositivo actualizó estos datos. Tus cambios pendientes no se han guardado; vuelve a cargar antes de continuar." y **no sobrescribe** (devuelve). Esto evita pérdida de cambios locales.
- Si no hay cambios locales pendientes → parsea `data.state`, incrementa `operationalSaveEpochRef[id]`, actualiza `revision`, `savedOperationalSnapshotRef`, y setea `recordsByEstablishment`/`turns` (fusionando `users` existentes para no perder staff cargado).

### 6.2 Escritura serializada (cola)
- Efecto de persistencia (`src/App.tsx:413-473`): itera establecimientos con `loadedOperationalRef`. Para cada uno, calcula `payload = operationalStateFor(...)`, `snapshot = JSON.stringify(payload)`. Si igual al snapshot guardado → skip.
- Define `queuedEpoch = operationalSaveEpochRef[id] ?? 0`. Función `save()` asíncrona: si epoch cambió o snapshot ya guardado → return. Llama RPC `save_operational_state` con `{ target_establishment_id, new_state: payload, expected_revision: revision[id] }`.
- Gestiona cola: `const previous = operationalSaveQueueRef.current[id] ?? Promise.resolve(); const queued = previous.catch(()=>undefined).then(save); operationalSaveQueueRef.current[id] = queued; void queued`. Esto garantiza **serialización por establecimiento** (cambios rápidos no se reordenan).

### 6.3 Optimistic locking (revisión)
- `operationalRevisionRef.current[id]` mantiene última revisión conocida (de lectura o de escritura exitosa). En escritura exitosa (`data` = nueva revisión retornada por RPC), se asigna `operationalRevisionRef[id] = data` y `savedOperationalSnapshotRef[id] = snapshot` (`463-466`).
- Si RPC retorna error con `error.message.includes('operational state changed')` (`439`): incrementa epoch, recarga última fila (`select state, revision`), parsea, actualiza refs/estado, muestra toast "Se cargó la versión más reciente..." y **descarta cambio en conflicto**. No reintenta automáticamente con nueva revisión salvo que UI genere nuevo cambio.
- `expected_revision` siempre es la revisión conocida local en ese momento de escritura.

### 6.4 Sin offline
- Solo polling mientras app abierta. No hay cola persistente offline, ni escritura local cuando sin conexión. Sincronización por refresco (pull) + escritura con revisión optimista.

---

## 7. Reglas de negocio estrictas (validaciones, casos de error, stock, turno cerrado)

### 7.1 Turno cerrado
- Mesero no agrega al carrito (`777`), no envía solicitud (`754`).
- Bar no despacha (`711`: muestra toast "Inicia un turno para despachar y registrar pagos").
- UI muestra aviso global cuando turno cerrado para no-admin (`src/App.tsx:934`).

### 7.2 Stock
- `registerSale(product)`: si `product.stock == 0` → toast "No hay existencias..." (`699-704`).
- Carrito mesero: `addToWaiterCart` no permite superar stock (`779-782`); `waiterCartShortages` calcula faltantes antes de enviar (`476-479`, `936`). `createWaiterRequest` valida `stockShortages.length > 0` → rechaza con detalle (`760-765`).
- RPC bar impone: no aumentar stock; delta stock = suma cantidades de requests Pasiente→Despachado; cada despacho debe generar ventas exactas. Esto asegura consistencia servidor.

### 7.3 Solicitudes
- Mesero solo añade propias pendientes (RPC). UI construye `requesterId` con `session.user?.id`.
- `itemsList` requerido para despacho efectivo (`719-722`: si falta → toast "La solicitud no tiene detalle de productos...").
- Refrescar solicitudes (admin): confirma y limpia bandeja (`refreshBarRequests`, `747-751`) — solo borra si todas despachadas según RPC (bar no puede limpiar pendientes).

### 7.4 Usuarios/staff
- Username 3-32, regex `^[a-z0-9._-]{3,32}$`, normalizado a minúsculas y espacios→`.` (`788`, `manage-staff:96`). Contraseña >=8. Único por username (BD `profiles.username unique`, check servidor). No eliminar cuentas admin. Staff asignado a establecimiento.

### 7.5 Establecimientos
- Nombre/ciudad/taxId obligatorios (`834`). País con ejemplos fiscales (`domain:54`). Root no crea establecimientos vía política pública.

### 7.6 Validaciones servidor (RPC) — casos de error
- `not authorized for establishment` (sin acceso tenant)
- `invalid operational state` (forma JSON incorrecta o expected_revision null)
- `not authorized for operational state` (rol no derivado)
- `operational state changed; reload and retry` (revisión desactualizada o fila creada en race)
- `waiters may only add their own requests` / `waiters may only add their own pending requests`
- `bar users may not change shift state`
- `bar users may not edit or remove recorded sales`
- `bar users may only dispatch or clear existing requests`
- `bar users may not clear pending requests`
- `bar users may only update a request status to dispatched`
- `bar users may not edit product details or increase stock`
- `product stock change must match dispatched request quantities`
- `cannot dispatch a request without item details`
- `recorded sale does not match the dispatched request`
- `dispatch must record exactly one sale per request item`
- `bar users may only record sales from a dispatched request`
- `role may not change operational state`

### 7.7 Seguridad
- Nunca secretos en frontend/VITE_. MFA AAL2 obligatorio para root. Toda acción root auditada. Errores reportados (no silenciados). Autorización servidor obligatoria.

---

## 8. Limitaciones actuales, deuda técnica

### 8.1 Limitaciones
- **Sin pruebas automatizadas**: No hay test runner (`AGENTS.md`: "No test runner configured. Do not run npm test/vitest/jest. Verify with npm run lint && npm run build"`).
- **Sin soporte offline**: Solo polling 4s; conflictos resueltos recargando BD. No hay persistencia offline.
- **Import legacy solo admin y solo primera vez**: Staff no importa legacy si falta fila (requiere admin inicie sesión).
- **Métricas decorativas**: En Resumen hay valores fijos ("+12.8% vs. turno anterior", "+6 ingresadas hoy") (`src/App.tsx:939`) — no calculados.
- **Placeholder funcional**: "+ Ingresar mercancía" solo muestra toast (`src/App.tsx:951`).
- **Nombre admin hardcodeado**: Sidebar muestra "Juan Delgado" para admin (`src/App.tsx:873`) — no viene de `profiles.full_name`.
- **Root preview solo DEV**: `?root-preview=1` solo con `import.meta.env.DEV` (`src/App.tsx:43`).
- **No carga multimedia**: Actual versión no permite subir archivos; política informativa futura (`PrivacyNotice`, `POLITICA-DERECHOS-AUTOR.md`).
- **Polling fijo**: 4s hardcodeado, sin backoff/heartbeat adaptativo.

### 8.2 Deuda técnica
- **App.tsx monolítico (~961 líneas)**: Concentra auth, root, navegación, todas las vistas, lógica de persistencia/sync. Difícil de mantener/testear. Arquitectura sugiere mover reglas a módulos (`docs/ARCHITECTURE.md:8`).
- **Estado mezclado**: `users` se mantiene parcialmente en `recordsByEstablishment` (fusionado desde `profiles`) mientras negocio vive en `operational_state` — modelo híbrido pero funcional.
- **Sincronización users fuera de operational_state**: Staff se recarga por establecimiento (`src/App.tsx:330-365`, `277-299`) independientemente del polling de estado; posible desincronización menor.
- **Preferencias con fallback legacy**: `establishmentsStorageKey` leído al inicializar estado (antes de hidratar BD) — puede causar selección temporal incorrecta hasta que BD carga.
- **UI inconsistencias menores**: Algunos textos/íconos inline; métricas no dinámicas.
- **Manejo de errores**: En algunos casos toast genérico; conflictos bien manejados pero otros errores podrían mejorar UX.
- **TypeScript estricto**: Cumple con `tsc -b` y reglas de oxlint; `verbatimModuleSyntax`, `erasableSyntaxOnly` aplicados.

---

## Resumen ejecutivo

Kuantika POS es SPA React+TS+Vite multi-tenant con Supabase (Auth+DB+Edge Functions). **Fuente autoritaria**: `public.operational_state` (JSONB + `revision`) con **único camino de escritura RPC** `save_operational_state` (`security definer`) que aplica reglas por rol (admin/waiter/bar) con bloqueo y validaciones estrictas (stock, despacho→ventas, turnos). **RLS + can_access_establishment** aíslan tenants; root opera **solo sandbox aislado** con **AAL2/MFA obligatorio** y **auditoría completa** (`root_audit_log`). Sincronización **cross-device por polling 4s + optimistic locking**; conflictos recargan BD (sin soporte offline). Staff gestionado por Edge Function `manage-staff` (JWT válido). localStorage usado **solo** para import legacy (primer admin), bootstrap de turno y preferencias. Arquitectura sólida con seguridad servidor-centralizada; deuda principal: `App.tsx` monolítico (~961 líneas).