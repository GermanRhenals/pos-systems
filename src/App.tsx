/**
 * App.tsx — Kuantika POS application shell.
 *
 * Responsibilities:
 *  - Own authentication (login, admin registration, root MFA) and session role.
 *  - Render the role-aware workspace and route between operational views.
 *  - Own all Supabase wiring: reads, the revision-checked save RPC, Edge
 *    Function calls, and the ~4s cross-device polling loop.
 *
 * Domain types and pure helpers live in `src/domain/operational.ts`; keep them
 * out of this UI layer. `public.operational_state` is the authoritative source
 * for products, sales, requests and turns. The only write path is the RPC
 * `save_operational_state` (revision-checked; on conflict the client reloads
 * the database copy). `localStorage` is never a source of business records:
 * it is used only for legacy first-admin import, establishment prefs and turn
 * bootstrap.
 */

// ===========================================================================
// Imports
// ===========================================================================
// React runtime, styles, shared components, Supabase client, domain layer.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import "./App.css";
import { PrivacyNotice } from "./components/PrivacyNotice";
import { staffAuthEmail, supabase } from "./supabase";
import {
  emptyRecords,
  establishmentsStorageKey,
  formatDateInputValue,
  formatDuration,
  formatExactDateTime,
  formatExactTime,
  freshTurn,
  getSalesPeriodBounds,
  groupSalesByOrder,
  initialEstablishments,
  initializeTurnStates,
  loadRecords,
  money,
  operationalStateFor,
  parseDateInputValue,
  parseOperationalState,
  readTurnStates,
  recordsStorageKey,
  requestTotal,
  seededRecords,
  sumIncidents,
  taxIdExamples,
  turnsStorageKey,
  type Establishment,
  type Incident,
  type IncidentKind,
  type MfaFlow,
  type OperationalState,
  type Product,
  type Records,
  type RootAccount,
  type RootAuditEntry,
  type RootEstablishment,
  type RootSandbox,
  type SalesPeriod,
  type TurnState,
  type User,
} from "./domain/operational";

// ===========================================================================
// Shared helpers
// ===========================================================================
// supabase.functions.invoke hides non-2xx response bodies behind a generic
// FunctionsHttpError message; read the function's own { error } payload instead.
async function edgeFunctionError(
  error: unknown,
  data: { error?: string } | null | undefined,
  fallback: string,
) {
  if (data && typeof data === "object" && data.error) return String(data.error);
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body && typeof body === "object" && "error" in body && body.error)
        return String((body as { error: unknown }).error);
    } catch {
      try {
        const text = await context.clone().text();
        if (text) return text;
      } catch {
        // Fall through to the generic message below.
      }
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Emoji thumbnail shown for a product, derived from its category. Kept in the
 * UI layer because it is purely presentational.
 */
function productIcon(category: string) {
  if (category === "Cervezas") return "▥";
  if (category === "Cocteleria") return "◒";
  return "◉";
}

/** Initial (empty) values for the "new establishment" form. */
const emptyEstablishmentForm = {
  name: "",
  city: "",
  country: "Colombia",
  taxId: "",
};

/** Staff role simulated in the root sandbox ("Ver como"). */
type PreviewRole = "admin" | "waiter" | "bar";

/** Display names and zones for the synthetic users used in sandbox previews. */
const previewRoleNames: Record<PreviewRole, string> = {
  admin: "Administrador (prueba)",
  waiter: "Mesero (prueba)",
  bar: "Bar (prueba)",
};

/** Shape of a row returned by the `profiles` table select used for staff. */
type StaffRow = {
  id: number | string;
  username: string | null;
  full_name: string;
  zone: string;
  role: User["role"];
};

/** Map a `profiles` row to the domain `User` shape used across the workspace. */
function toStaffUser(row: StaffRow): User {
  return {
    id: row.id,
    username: row.username ?? "",
    name: row.full_name,
    zone: row.zone,
    role: row.role,
    active: true,
  };
}

// ===========================================================================
// Application shell
// ===========================================================================
/**
 * Root component: owns session/auth, the root support console, operational
 * data for every accessible establishment, and the role-aware workspace views.
 *
 * Reading order mirrors the sections below: state groups, derived selectors,
 * side effects (hydration, sync, persistence), action handlers, then render.
 */
function App() {
  // ---------------------------------------------------------------------------
  // Root-preview fixtures (DEV only, ?root-preview=1)
  // ---------------------------------------------------------------------------
  const rootPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("root-preview") === "1";
  const previewAccount: RootAccount = {
    id: "preview-root-account",
    fullName: "María Administradora (demo)",
    email: "maria.admin@example.com",
    createdAt: "2026-10-01T14:30:00.000Z",
    lastSignInAt: "2026-10-05T15:20:00.000Z",
    emailConfirmedAt: "2026-10-01T14:35:00.000Z",
    bannedUntil: null,
    establishments: [
      {
        id: "preview-establishment",
        name: "Café de demostración",
        city: "Cartagena",
        country: "Colombia",
        taxId: "NIT de ejemplo",
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Authentication and access-control state
  // ---------------------------------------------------------------------------
  const [session, setSession] = useState<{
    role: "root" | "admin" | "waiter" | "bar";
    user?: User;
  } | null>(rootPreview ? { role: "root" } : null);
  const [showLogin, setShowLogin] = useState(!rootPreview);
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot-password" | "reset-password">("login");
  const [registration, setRegistration] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [resetEmail, setResetEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(
    !rootPreview && Boolean(supabase),
  );
  const [mfaFlow, setMfaFlow] = useState<MfaFlow | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  // Login-screen privacy acceptance and the full-policy modal.
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  // ---------------------------------------------------------------------------
  // Root support-console state
  // ---------------------------------------------------------------------------
  const [rootAccounts, setRootAccounts] = useState<RootAccount[]>(
    rootPreview ? [previewAccount] : [],
  );
  const [rootSandbox, setRootSandbox] = useState<RootSandbox | null>(null);
  const [rootSandboxActive, setRootSandboxActive] = useState(false);
  // Root sandbox only: simulate a staff role locally to preview waiter/bar views.
  const [previewRole, setPreviewRole] = useState<PreviewRole>("admin");
  const [rootAudit, setRootAudit] = useState<RootAuditEntry[]>(
    rootPreview
      ? [
          {
            id: 1,
            action: "update_establishment",
            target_user_id: previewAccount.id,
            details: {
              establishmentId: "preview-establishment",
              before: { city: "Barranquilla" },
              after: { city: "Cartagena" },
            },
            created_at: "2026-10-05T15:10:00.000Z",
          },
        ]
      : [],
  );
  const [rootSearch, setRootSearch] = useState("");
  const [rootEdits, setRootEdits] = useState<
    Record<string, { fullName: string; email: string }>
  >({});
  const [rootEstablishmentEdits, setRootEstablishmentEdits] = useState<
    Record<string, RootEstablishment>
  >({});
  const [rootError, setRootError] = useState("");
  const [rootLoading, setRootLoading] = useState(false);
  const [login, setLogin] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [activeView, setActiveView] = useState(
    rootPreview ? "Consola root" : "Resumen",
  );

  // ---------------------------------------------------------------------------
  // Operational data state (authoritative in public.operational_state)
  // ---------------------------------------------------------------------------
  // Establishment selection and operational records are hydrated from Supabase after auth.
  const [establishments, setEstablishments] = useState<Establishment[]>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem(establishmentsStorageKey) ?? "null") ??
        initialEstablishments
      );
    } catch {
      return initialEstablishments;
    }
  });
  const [activeEstablishmentId, setActiveEstablishmentId] = useState(() => {
    try {
      return (
        JSON.parse(
          localStorage.getItem(establishmentsStorageKey) ?? "null",
        )?.[0]?.id ?? initialEstablishments[0].id
      );
    } catch {
      return initialEstablishments[0].id;
    }
  });
  const [turns, setTurns] = useState(() =>
    initializeTurnStates(
      establishments.map((establishment) => establishment.id),
    ),
  );
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [recordsByEstablishment, setRecordsByEstablishment] = useState<
    Record<string, Records>
  >(() => loadRecords(localStorage.getItem(recordsStorageKey)));

  // ---------------------------------------------------------------------------
  // Ephemeral UI state (never persisted as business records)
  // ---------------------------------------------------------------------------
  // These values only control the current screen and are never treated as business records.
  const [search, setSearch] = useState("");
  const [newUser, setNewUser] = useState<{
    name: string;
    username: string;
    password: string;
    role: User["role"];
    zone: string;
  }>({
    name: "",
    username: "",
    password: "",
    role: "waiter",
    zone: "Salón principal",
  });
  const [newRequest, setNewRequest] = useState({ table: "", items: "" });
  // Admin-only price edit modal for a single inventory product.
  const [priceEdit, setPriceEdit] = useState<{
    product: Product;
    value: string;
  } | null>(null);
  const [newIncident, setNewIncident] = useState<{
    kind: IncidentKind;
    productId: string;
    quantity: string;
    unitValue: string;
    note: string;
  }>({ kind: "Daño", productId: "", quantity: "1", unitValue: "", note: "" });
  const [waiterProductSearch, setWaiterProductSearch] = useState("");
  const [waiterCart, setWaiterCart] = useState<Record<number, number>>({});
  const [barProductSearch, setBarProductSearch] = useState("");
  const [barCart, setBarCart] = useState<Record<number, number>>({});
  const [salesPeriod, setSalesPeriod] = useState<SalesPeriod>("Día");
  const [salesDate, setSalesDate] = useState(() =>
    formatDateInputValue(Date.now()),
  );
  const [newEstablishment, setNewEstablishment] = useState(
    emptyEstablishmentForm,
  );
  const [toast, setToast] = useState("");

  // ---------------------------------------------------------------------------
  // Persistence refs (per-establishment revision + save queue)
  // ---------------------------------------------------------------------------
  const loadedOperationalRef = useRef(new Set<string>());
  const operationalRevisionRef = useRef<Record<string, number>>({});
  const savedOperationalSnapshotRef = useRef<Record<string, string>>({});
  const operationalSaveQueueRef = useRef<Record<string, Promise<void>>>({});
  const operationalSaveEpochRef = useRef<Record<string, number>>({});
  const reportedOperationalFailureRef = useRef<Record<string, string>>({});

  // ---------------------------------------------------------------------------
  // Derived selectors (memo-free; recomputed from records)
  // ---------------------------------------------------------------------------
  // Derived dashboard and report values; persisted records remain the source of truth.
  const records = recordsByEstablishment[activeEstablishmentId] ?? emptyRecords;
  const activeTurn = turns[activeEstablishmentId] ?? {
    startedAt: clockNow,
    endedAt: null,
  };
  const turnDuration = Math.max(
    0,
    (activeTurn.endedAt ?? clockNow) - activeTurn.startedAt,
  );
  const { products, sales: allSales, requests, incidents, users } = records;
  const sales = allSales.filter(
    (sale) =>
      sale.createdAt !== undefined &&
      sale.createdAt >= activeTurn.startedAt &&
      sale.createdAt <= (activeTurn.endedAt ?? clockNow),
  );
  // Accidental losses recorded during the same turn window as the sales above.
  const turnIncidents = incidents.filter(
    (incident) =>
      incident.createdAt >= activeTurn.startedAt &&
      incident.createdAt <= (activeTurn.endedAt ?? clockNow),
  );
  const activeEstablishment =
    establishments.find(
      (establishment) => establishment.id === activeEstablishmentId,
    ) ?? establishments[0];
  const totalStock = products.reduce(
    (total, product) => total + product.stock,
    0,
  );
  const lowStock = products.filter(
    (product) => product.stock <= product.minimum,
  ).length;
  const totalSales = sales.reduce((total, sale) => total + sale.total, 0);
  const incidentsLoss = sumIncidents(turnIncidents);
  const netResult = totalSales - incidentsLoss;
  const reportTimestamp = salesDate ? parseDateInputValue(salesDate) : clockNow;
  const periodBounds = getSalesPeriodBounds(salesPeriod, reportTimestamp);
  const periodRangeLabel = `${new Date(periodBounds.start).toLocaleDateString("es-CO", { day: "numeric", month: "short" })} - ${new Date(periodBounds.end - 1).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}`;
  const salesInPeriod = allSales.filter(
    (sale) =>
      sale.createdAt !== undefined &&
      sale.createdAt >= periodBounds.start &&
      sale.createdAt < periodBounds.end,
  );
  const periodSalesTotal = salesInPeriod.reduce(
    (total, sale) => total + sale.total,
    0,
  );
  const periodUnits = salesInPeriod.reduce(
    (total, sale) => total + sale.quantity,
    0,
  );
  const salesLedger = groupSalesByOrder(salesInPeriod);
  const pendingRequests = requests.filter(
    (request) => request.status === "Pendiente",
  ).length;
  const serverCount = users.filter((user) => user.role === "waiter").length;
  const isEphemeralTestMode = rootSandboxActive;
  // In the root sandbox a staff role is simulated locally so an owner can preview
  // the waiter/bar experience. Outside the sandbox these flags follow the session.
  const isAdmin =
    session?.role === "admin" || (isEphemeralTestMode && previewRole === "admin");
  const isRoot = session?.role === "root" && !rootSandboxActive;
  const isBar =
    session?.role === "bar" || (isEphemeralTestMode && previewRole === "bar");
  const isWaiter =
    session?.role === "waiter" || (isEphemeralTestMode && previewRole === "waiter");
  // Synthetic user used by sandbox previews so staff-scoped reads/writes resolve.
  const currentUser: User | undefined =
    session?.user ??
    (isEphemeralTestMode
      ? previewRole === "bar"
        ? {
            id: `sandbox-bar`,
            username: "bar",
            name: previewRoleNames.bar,
            zone: "Sandbox",
            role: "bar",
            active: true,
          }
        : previewRole === "waiter"
          ? {
              id: `sandbox-waiter`,
              username: "waiter",
              name: previewRoleNames.waiter,
              zone: "Sandbox",
              role: "waiter",
              active: true,
            }
          : undefined
      : undefined);

  // ---------------------------------------------------------------------------
  // Toast helper
  // ---------------------------------------------------------------------------
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  // ---------------------------------------------------------------------------
  // Side effects: preferences, clock and dashboard bootstrap
  // ---------------------------------------------------------------------------
  // Keep volatile UI preferences on this browser; business records are persisted below.
  useEffect(() => {
    localStorage.setItem(
      establishmentsStorageKey,
      JSON.stringify(establishments),
    );
  }, [establishments]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (activeTurn.endedAt !== null) {
      setWaiterCart({});
      setBarCart({});
    }
  }, [activeTurn.endedAt]);
  useEffect(() => {
    // Restore the authenticated account and hydrate each accessible establishment.
    if (rootPreview) return;
    if (!supabase) return;
    const client = supabase;
    const hash = window.location.hash;
    if (hash && hash.includes("type=recovery")) {
      setAuthMode("reset-password");
      setShowLogin(true);
      setLoginError("");
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
    let active = true;
    const hydrateSession = async (userId: string) => {
      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("id, username, full_name, role, zone, establishment_id")
        .eq("id", userId)
        .single();
      if (!active) return;
      if (profileError) {
        setLoginError(`No se pudo cargar el perfil: ${profileError.message}`);
        setAuthLoading(false);
        return;
      }
      const user: User | undefined =
        profile.role === "admin" ? undefined : toStaffUser(profile);
      const { data: rootAccess, error: rootAccessError } = await client
        .from("root_users")
        .select("id")
        .eq("id", userId)
        .maybeSingle();
      if (!active) return;
      if (rootAccessError) {
        setLoginError(
          `No se pudo verificar el acceso root: ${rootAccessError.message}`,
        );
        setAuthLoading(false);
        return;
      }
      if (rootAccess) {
        const { data: assurance, error: assuranceError } =
          await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceError || assurance.currentLevel !== "aal2") {
          setSession(null);
          setShowLogin(true);
          setLoginError(
            "La cuenta root requiere verificación multifactor para continuar.",
          );
          setAuthLoading(false);
          return;
        }
        setSession({ role: "root" });
        setActiveView("Consola root");
        setShowLogin(false);
        setAuthLoading(false);
        return;
      }
      const nextSession = {
        role: profile.role as "admin" | "waiter" | "bar",
        user,
      };
      setSession(nextSession);
      setActiveView(profile.role === "admin" ? "Resumen" : "Solicitudes");
      const establishmentQuery = client
        .from("establishments")
        .select("id, name, city, country, tax_id, owner_id");
      const { data: establishmentRows, error: establishmentError } =
        profile.role === "admin"
          ? await establishmentQuery.eq("owner_id", userId).order("created_at")
          : await establishmentQuery.eq("id", profile.establishment_id);
      if (!active) return;
      if (establishmentError) {
        setLoginError(
          `No se pudieron cargar los establecimientos: ${establishmentError.message}`,
        );
        setAuthLoading(false);
        return;
      }
      const nextEstablishments = (establishmentRows ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        country: row.country,
        taxId: row.tax_id,
        owner_id: row.owner_id,
      }));
      setEstablishments(nextEstablishments);
      const selectedEstablishmentId =
        profile.role === "admin"
          ? nextEstablishments[0]?.id
          : profile.establishment_id;
      const establishmentIds = nextEstablishments.map(
        (establishment) => establishment.id,
      );
      if (establishmentIds.length > 0) {
        const { data: operationalRows, error: operationalError } = await client
          .from("operational_state")
          .select("establishment_id, state, revision")
          .in("establishment_id", establishmentIds);
        if (!active) return;
        if (operationalError) {
          setLoginError(
            `No se pudieron cargar los datos operativos: ${operationalError.message}`,
          );
          setAuthLoading(false);
          return;
        }
        const legacyRecords = loadRecords(
          localStorage.getItem(recordsStorageKey),
        );
        const legacyTurns = readTurnStates(
          localStorage.getItem(turnsStorageKey),
        );
        const hydratedRecords: Record<string, Records> = {};
        const hydratedTurns: Record<string, TurnState> = {};
        for (const establishment of nextEstablishments) {
          const row = operationalRows.find(
            (item) => item.establishment_id === establishment.id,
          );
          if (!row && profile.role !== "admin") {
            setLoginError(
              `El administrador debe iniciar sesión para preparar los datos operativos de ${establishment.name}.`,
            );
            setAuthLoading(false);
            return;
          }
          const fallbackTurn = legacyTurns[establishment.id] ?? {
            startedAt: Date.now(),
            endedAt: null,
          };
          let state: OperationalState;
          try {
            state = row
              ? parseOperationalState(row.state)
              : operationalStateFor(
                  legacyRecords[establishment.id] ?? seededRecords(),
                  fallbackTurn,
                );
          } catch (error) {
            setLoginError(
              `No se pudieron leer los datos de ${establishment.name}: ${error instanceof Error ? error.message : String(error)}`,
            );
            setAuthLoading(false);
            return;
          }
          hydratedRecords[establishment.id] = { ...state, users: [] };
          hydratedTurns[establishment.id] = state.turn;
          loadedOperationalRef.current.add(establishment.id);
          operationalRevisionRef.current[establishment.id] = row?.revision ?? 0;
          savedOperationalSnapshotRef.current[establishment.id] = row
            ? JSON.stringify(state)
            : profile.role === "admin"
              ? ""
              : JSON.stringify(state);
        }
        setRecordsByEstablishment((current) => ({
          ...current,
          ...hydratedRecords,
        }));
        setTurns((current) => ({ ...current, ...hydratedTurns }));
      }
      if (selectedEstablishmentId) {
        setActiveEstablishmentId(selectedEstablishmentId);
        const { data: staff, error: staffError } = await client
          .from("profiles")
          .select("id, username, full_name, role, zone")
          .eq("establishment_id", selectedEstablishmentId);
        if (!active) return;
        if (staffError)
          setLoginError(`No se pudo cargar el equipo: ${staffError.message}`);
        setRecordsByEstablishment((current) => {
          const prior = current[selectedEstablishmentId] ?? seededRecords();
          return {
            ...current,
            [selectedEstablishmentId]: {
              ...prior,
              users: (staff ?? (user ? [profile] : [])).map(toStaffUser),
            },
          };
        });
      } else {
        setActiveView("Establecimientos");
      }
      setShowLogin(false);
      setAuthLoading(false);
    };
    supabase.auth.getSession().then(({ data, error }) => {
      if (error)
        setLoginError(`No se pudo verificar la sesión: ${error.message}`);
      if (data.session) void hydrateSession(data.session.user.id);
      else {
        setSession(null);
        setShowLogin(true);
        setAuthLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, authSession) => {
        if (authSession) {
          setAuthLoading(true);
          window.setTimeout(() => {
            void hydrateSession(authSession.user.id);
          }, 0);
        } else if (active) {
          setSession(null);
          setShowLogin(true);
          setAuthLoading(false);
        }
      },
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [rootPreview]);
  // ---------------------------------------------------------------------------
  // Session hydration: load profile, establishments and operational state
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Staff identity and role data remain normalized in the profiles table.
    if (
      rootPreview ||
      !supabase ||
      !activeEstablishmentId ||
      !session ||
      isRoot ||
      isEphemeralTestMode
    )
      return;
    const client = supabase;
    let active = true;
    const loadStaff = async () => {
      const { data, error } = await client
        .from("profiles")
        .select("id, username, full_name, role, zone")
        .eq("establishment_id", activeEstablishmentId);
      if (!active) return;
      if (error) {
        setLoginError(`No se pudo cargar el equipo: ${error.message}`);
        return;
      }
      setRecordsByEstablishment((current) => {
        const existing = current[activeEstablishmentId] ?? seededRecords();
        return {
          ...current,
          [activeEstablishmentId]: {
            ...existing,
            users: data.map(toStaffUser),
          },
        };
      });
    };
    void loadStaff();
    return () => {
      active = false;
    };
  }, [
    activeEstablishmentId,
    session,
    rootPreview,
    isRoot,
    isEphemeralTestMode,
  ]);
  // ---------------------------------------------------------------------------
  // Cross-device sync: staff list and ~4s operational polling
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Polling picks up updates from other open devices without enabling offline writes.
    if (
      !supabase ||
      !session ||
      isRoot ||
      isEphemeralTestMode ||
      !activeEstablishmentId ||
      !loadedOperationalRef.current.has(activeEstablishmentId)
    )
      return;
    const client = supabase;
    let active = true;
    const refreshOperationalState = async () => {
      const { data, error } = await client
        .from("operational_state")
        .select("state, revision")
        .eq("establishment_id", activeEstablishmentId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        const errorKey = `sync:${error.message}`;
        if (
          reportedOperationalFailureRef.current[activeEstablishmentId] !==
          errorKey
        ) {
          reportedOperationalFailureRef.current[activeEstablishmentId] =
            errorKey;
          showToast(`No se pudo comprobar la sincronización: ${error.message}`);
        }
        return;
      }
      if (
        !data ||
        data.revision === operationalRevisionRef.current[activeEstablishmentId]
      )
        return;
      delete reportedOperationalFailureRef.current[activeEstablishmentId];
      const localPayload = operationalStateFor(
        recordsByEstablishment[activeEstablishmentId] ?? emptyRecords,
        turns[activeEstablishmentId] ?? { startedAt: 0, endedAt: null },
      );
      if (
        savedOperationalSnapshotRef.current[activeEstablishmentId] !==
        JSON.stringify(localPayload)
      ) {
        if (
          reportedOperationalFailureRef.current[activeEstablishmentId] !==
          String(data.revision)
        ) {
          reportedOperationalFailureRef.current[activeEstablishmentId] = String(
            data.revision,
          );
          showToast(
            "Otro dispositivo actualizó estos datos. Tus cambios pendientes no se han guardado; vuelve a cargar antes de continuar.",
          );
        }
        return;
      }
      try {
        const state = parseOperationalState(data.state);
        operationalSaveEpochRef.current[activeEstablishmentId] =
          (operationalSaveEpochRef.current[activeEstablishmentId] ?? 0) + 1;
        operationalRevisionRef.current[activeEstablishmentId] = data.revision;
        savedOperationalSnapshotRef.current[activeEstablishmentId] =
          JSON.stringify(state);
        setRecordsByEstablishment((current) => ({
          ...current,
          [activeEstablishmentId]: {
            ...state,
            users: current[activeEstablishmentId]?.users ?? [],
          },
        }));
        setTurns((current) => ({
          ...current,
          [activeEstablishmentId]: state.turn,
        }));
      } catch (refreshError) {
        showToast(
          `No se pudieron actualizar los datos: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
        );
      }
    };
    const timer = window.setInterval(() => {
      void refreshOperationalState();
    }, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    activeEstablishmentId,
    session,
    isRoot,
    isEphemeralTestMode,
    recordsByEstablishment,
    turns,
    showToast,
  ]);
  // ---------------------------------------------------------------------------
  // Operational persistence: revision-checked saves via save_operational_state
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Serialize revision-checked writes so rapid UI changes cannot reorder saves.
    if (!supabase || !session || isRoot || isEphemeralTestMode) return;
    const client = supabase;
    for (const establishmentId of Object.keys(recordsByEstablishment)) {
      if (!loadedOperationalRef.current.has(establishmentId)) continue;
      const payload = operationalStateFor(
        recordsByEstablishment[establishmentId],
        turns[establishmentId] ?? { startedAt: 0, endedAt: null },
      );
      const snapshot = JSON.stringify(payload);
      if (savedOperationalSnapshotRef.current[establishmentId] === snapshot)
        continue;
      const queuedEpoch = operationalSaveEpochRef.current[establishmentId] ?? 0;
      const save = async () => {
        if (
          (operationalSaveEpochRef.current[establishmentId] ?? 0) !==
          queuedEpoch
        )
          return;
        if (savedOperationalSnapshotRef.current[establishmentId] === snapshot)
          return;
        const { data, error } = await client.rpc("save_operational_state", {
          target_establishment_id: establishmentId,
          new_state: payload,
          expected_revision:
            operationalRevisionRef.current[establishmentId] ?? 0,
        });
        if (error) {
          if (
            reportedOperationalFailureRef.current[establishmentId] !== snapshot
          ) {
            reportedOperationalFailureRef.current[establishmentId] = snapshot;
            showToast(
              `No se guardaron los cambios en la base de datos: ${error.message}`,
            );
          }
          if (error.message.includes("operational state changed")) {
            operationalSaveEpochRef.current[establishmentId] =
              (operationalSaveEpochRef.current[establishmentId] ??
                queuedEpoch) + 1;
            const { data: latest, error: reloadError } = await client
              .from("operational_state")
              .select("state, revision")
              .eq("establishment_id", establishmentId)
              .maybeSingle();
            if (reloadError || !latest) return;
            try {
              const latestState = parseOperationalState(latest.state);
              operationalRevisionRef.current[establishmentId] = latest.revision;
              savedOperationalSnapshotRef.current[establishmentId] =
                JSON.stringify(latestState);
              setRecordsByEstablishment((current) => ({
                ...current,
                [establishmentId]: {
                  ...latestState,
                  users: current[establishmentId]?.users ?? [],
                },
              }));
              setTurns((current) => ({
                ...current,
                [establishmentId]: latestState.turn,
              }));
              showToast(
                "Se cargó la versión más reciente de la base de datos; el cambio en conflicto no se guardó.",
              );
            } catch (reloadError) {
              showToast(
                `No se pudo recargar la versión más reciente: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`,
              );
            }
          }
          return;
        }
        if (
          (operationalSaveEpochRef.current[establishmentId] ?? 0) !==
          queuedEpoch
        )
          return;
        operationalRevisionRef.current[establishmentId] = data;
        savedOperationalSnapshotRef.current[establishmentId] = snapshot;
        delete reportedOperationalFailureRef.current[establishmentId];
      };
      const previous =
        operationalSaveQueueRef.current[establishmentId] ?? Promise.resolve();
      const queued = previous.catch(() => undefined).then(save);
      operationalSaveQueueRef.current[establishmentId] = queued;
      void queued;
    }
  }, [
    recordsByEstablishment,
    turns,
    session,
    isRoot,
    isEphemeralTestMode,
    showToast,
  ]);
  const visibleProducts = products.filter(
    (product) =>
      product.name.toLowerCase().includes(search.toLowerCase()) ||
      product.category.toLowerCase().includes(search.toLowerCase()),
  );
  const availableWaiterProducts = products.filter(
    (product) =>
      product.name.toLowerCase().includes(waiterProductSearch.toLowerCase()) ||
      product.category
        .toLowerCase()
        .includes(waiterProductSearch.toLowerCase()),
  );
  const waiterCartShortages = Object.entries(waiterCart).flatMap(
    ([productId, quantity]) => {
      const product = products.find((item) => item.id === Number(productId));
      return !product || product.stock < quantity
        ? [
            `${product?.name ?? "Producto eliminado"}: solicitaste ${quantity}, disponibles ${product?.stock ?? 0}`,
          ]
        : [];
    },
  );
  const availableBarProducts = products.filter(
    (product) =>
      product.name
        .toLowerCase()
        .includes(barProductSearch.toLowerCase()) ||
      product.category
        .toLowerCase()
        .includes(barProductSearch.toLowerCase()),
  );
  const barCartShortages = Object.entries(barCart).flatMap(
    ([productId, quantity]) => {
      const product = products.find((item) => item.id === Number(productId));
      return !product || product.stock < quantity
        ? [
            `${product?.name ?? "Producto eliminado"}: pediste ${quantity}, disponibles ${product?.stock ?? 0}`,
          ]
        : [];
    },
  );
  const barCartTotal = Object.entries(barCart).reduce(
    (total, [productId, quantity]) => {
      const product = products.find((item) => item.id === Number(productId));
      return total + (product ? product.price * quantity : 0);
    },
    0,
  );

  // ---------------------------------------------------------------------------
  // Product view selectors
  // ---------------------------------------------------------------------------
  const categories = useMemo(
    () => ["Todos", ...new Set(products.map((product) => product.category))],
    [products],
  );

  // ---------------------------------------------------------------------------
  // Establishment bootstrap
  // ---------------------------------------------------------------------------
  /**
   * Make a newly reachable establishment usable in memory: mark it loaded,
   * seed its first turn and onboarding catalog, and focus it. Persistence is
   * handled by the save effect once the establishment is active.
   */
  const bootstrapEstablishment = (establishment: Establishment) => {
    const establishmentId = establishment.id;
    loadedOperationalRef.current.add(establishmentId);
    operationalRevisionRef.current[establishmentId] = 0;
    savedOperationalSnapshotRef.current[establishmentId] = "";
    setRecordsByEstablishment((current) => ({
      ...current,
      [establishmentId]: seededRecords(),
    }));
    setTurns((current) => ({
      ...current,
      [establishmentId]: freshTurn(),
    }));
    setActiveEstablishmentId(establishmentId);
    setActiveView("Resumen");
  };

  // ---------------------------------------------------------------------------
  // Root console actions (audited Edge Function only)
  // ---------------------------------------------------------------------------
  // Root data is loaded and mutated only through the audited Edge Function.
  const loadRootConsole = useCallback(async () => {
    if (rootPreview) {
      showToast("Vista previa local: no se consultan ni cambian datos reales");
      return;
    }
    if (!supabase) return;
    setRootLoading(true);
    const { data, error } = await supabase.functions.invoke("root-console", {
      body: { action: "list" },
    });
    if (error || data?.error) {
      setRootError(
        await edgeFunctionError(
          error,
          data,
          "No se pudo cargar la consola root",
        ),
      );
      setRootLoading(false);
      return;
    }
    const accounts = data.accounts as RootAccount[];
    setRootAccounts(accounts);
    setRootAudit(data.audit as RootAuditEntry[]);
    setRootSandbox(data.sandbox as RootSandbox | null);
    setRootEdits(
      Object.fromEntries(
        accounts.map((account) => [
          account.id,
          { fullName: account.fullName, email: account.email },
        ]),
      ),
    );
    setRootEstablishmentEdits(
      Object.fromEntries(
        accounts.flatMap((account) =>
          account.establishments.map((establishment) => [
            establishment.id,
            establishment,
          ]),
        ),
      ),
    );
    setRootError("");
    setRootLoading(false);
  }, [rootPreview, showToast]);
  const runRootAction = async (
    payload: Record<string, unknown>,
    successMessage: string,
  ) => {
    if (rootPreview) {
      showToast("Vista previa local: los cambios no se guardan");
      return;
    }
    if (!supabase) return;
    setRootError("");
    const { data, error } = await supabase.functions.invoke("root-console", {
      body: payload,
    });
    if (error || data?.error) {
      setRootError(
        await edgeFunctionError(
          error,
          data,
          "La operación root no se pudo completar",
        ),
      );
      return;
    }
    showToast(successMessage);
    await loadRootConsole();
  };
  const enterRootSandbox = () => {
    const establishment: Establishment = {
      id: "testing-establishment",
      name: "Testing establecimiento",
      city: rootSandbox?.city ?? "Cartagena",
      country: rootSandbox?.country ?? "Colombia",
      taxId: rootSandbox?.taxId ?? "TEST-LOCAL",
    };
    setEstablishments([establishment]);
    bootstrapEstablishment(establishment);
    setRootError("");
    setRootSandboxActive(true);
  };
  const leaveRootSandbox = () => {
    const establishmentId = "testing-establishment";
    loadedOperationalRef.current.delete(establishmentId);
    delete operationalRevisionRef.current[establishmentId];
    delete savedOperationalSnapshotRef.current[establishmentId];
    delete operationalSaveQueueRef.current[establishmentId];
    delete operationalSaveEpochRef.current[establishmentId];
    delete reportedOperationalFailureRef.current[establishmentId];
    setEstablishments((current) =>
      current.filter((item) => item.id !== establishmentId),
    );
    setRecordsByEstablishment((current) => {
      const next = { ...current };
      delete next[establishmentId];
      return next;
    });
    setTurns((current) => {
      const next = { ...current };
      delete next[establishmentId];
      return next;
    });
    setRootSandboxActive(false);
    setActiveView("Consola root");
  };
  useEffect(() => {
    if (isRoot && !rootPreview) void loadRootConsole();
  }, [isRoot, rootPreview, loadRootConsole]);

  // ---------------------------------------------------------------------------
  // Authentication actions: sign-in, registration, MFA verification, sign-out
  // ---------------------------------------------------------------------------
  // Authentication actions: sign-in, registration, MFA verification, and sign-out.
  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRootSandboxActive(false);
    if (!supabase) {
      setLoginError("Falta configurar Supabase para iniciar sesión");
      return;
    }
    const username = login.username.trim().toLowerCase().replace(/\s+/g, ".");
    const email = username.includes("@") ? username : staffAuthEmail(username);
    setAuthLoading(true);
    const { data: authResult, error } = await supabase.auth.signInWithPassword({
      email,
      password: login.password,
    });
    if (error) {
      setLoginError("Usuario o contraseña incorrectos");
      setAuthLoading(false);
      return;
    }
    const { data: rootAccess, error: rootAccessError } = await supabase
      .from("root_users")
      .select("id")
      .eq("id", authResult.user.id)
      .maybeSingle();
    if (rootAccessError) {
      setLoginError(
        `No se pudo verificar el acceso root: ${rootAccessError.message}`,
      );
      setAuthLoading(false);
      return;
    }
    if (rootAccess) {
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) {
        setLoginError(`No se pudo verificar MFA: ${assuranceError.message}`);
        setAuthLoading(false);
        return;
      }
      if (assurance.currentLevel !== "aal2") {
        const { data: factors, error: factorsError } =
          await supabase.auth.mfa.listFactors();
        if (factorsError) {
          setLoginError(`No se pudo preparar MFA: ${factorsError.message}`);
          setAuthLoading(false);
          return;
        }
        const verifiedFactor = factors.totp.find(
          (factor) => factor.status === "verified",
        );
        let factorId: string;
        let qrCode: string | undefined;
        let secret: string | undefined;
        if (verifiedFactor) {
          factorId = verifiedFactor.id;
        } else {
          const { data: enrollment, error: enrollmentError } =
            await supabase.auth.mfa.enroll({
              factorType: "totp",
              friendlyName: "Kuantika POS Root",
            });
          if (enrollmentError) {
            setLoginError(
              `No se pudo iniciar la configuración de MFA: ${enrollmentError.message}`,
            );
            setAuthLoading(false);
            return;
          }
          factorId = enrollment.id;
          qrCode = enrollment.totp.qr_code;
          secret = enrollment.totp.secret;
        }
        const { data: challenge, error: challengeError } =
          await supabase.auth.mfa.challenge({ factorId });
        if (challengeError) {
          setLoginError(
            `No se pudo enviar el desafío MFA: ${challengeError.message}`,
          );
          setAuthLoading(false);
          return;
        }
        setMfaFlow({ factorId, challengeId: challenge.id, qrCode, secret });
        setAuthLoading(false);
        setLoginError("");
        return;
      }
    }
    setLoginError("");
  };
  const verifyRootMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !mfaFlow) return;
    setAuthLoading(true);
    const { error } = await supabase.auth.mfa.verify({
      factorId: mfaFlow.factorId,
      challengeId: mfaFlow.challengeId,
      code: mfaCode.trim(),
    });
    if (error) {
      setLoginError(`Código MFA no válido: ${error.message}`);
      setAuthLoading(false);
      return;
    }
    setMfaFlow(null);
    setMfaCode("");
    setLoginError("");
  };
  const signUpAdministrator = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setLoginError("Falta configurar Supabase para crear una cuenta");
      return;
    }
    setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: registration.email.trim().toLowerCase(),
      password: registration.password,
      options: { data: { full_name: registration.name.trim() } },
    });
    if (error) {
      setLoginError(error.message);
      setAuthLoading(false);
      return;
    }
    if (!data.session) {
      setLoginError(
        "Cuenta creada. Revisa tu correo para confirmar el registro e iniciar sesión.",
      );
      setAuthLoading(false);
      setAuthMode("login");
      return;
    }
    setLoginError("");
  };

  const requestPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setLoginError("Falta configurar Supabase para recuperar la contraseña");
      return;
    }
    const email = resetEmail.trim().toLowerCase();
    if (!email) {
      setLoginError("Ingresa tu correo electrónico");
      return;
    }
    setAuthLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) {
      setLoginError(error.message);
      setAuthLoading(false);
      return;
    }
    setLoginError(
      "Te hemos enviado un enlace para restablecer tu contraseña. Revisa tu correo.",
    );
    setAuthLoading(false);
    setAuthMode("login");
  };

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setLoginError("Falta configurar Supabase para restablecer la contraseña");
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setLoginError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    setAuthLoading(true);
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) {
      setLoginError(error.message);
      setAuthLoading(false);
      return;
    }
    setLoginError("");
    setNewPassword("");
    setAuthMode("login");
    setShowLogin(true);
    setAuthLoading(false);
    showToast("Contraseña actualizada correctamente");
  };
  const signOut = async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) {
        showToast(`No se pudo cerrar sesión: ${error.message}`);
        return;
      }
    }
    setLogin({ username: "", password: "" });
    setRootSandboxActive(false);
    setActiveView("Resumen");
  };

  // ---------------------------------------------------------------------------
  // Operational actions: sales, requests, stock, turns
  // ---------------------------------------------------------------------------
  // Operational commands update React state; the persistence effect saves them to Supabase.
  const updateRecords = (updater: (current: Records) => Records) => {
    setRecordsByEstablishment((current) => ({
      ...current,
      [activeEstablishmentId]: updater(
        current[activeEstablishmentId] ?? emptyRecords,
      ),
    }));
  };
  const updateTurns = (
    updater: (current: Record<string, TurnState>) => Record<string, TurnState>,
  ) => {
    setTurns((current) => updater(current));
  };
  const finishTurn = () => {
    if (!isAdmin || activeTurn.endedAt !== null) return;
    const endedAt = Date.now();
    updateTurns((current) => ({
      ...current,
      [activeEstablishmentId]: { ...activeTurn, endedAt },
    }));
    setClockNow(endedAt);
    showToast("Turno terminado");
  };
  const startTurn = () => {
    if (!isAdmin || activeTurn.endedAt === null) return;
    const startedAt = Date.now();
    updateTurns((current) => ({
      ...current,
      [activeEstablishmentId]: { startedAt, endedAt: null },
    }));
    setClockNow(startedAt);
    showToast("Nuevo turno iniciado desde cero");
  };
  const registerSale = (product: Product) => {
    if (product.stock === 0) {
      showToast("No hay existencias para registrar esta venta");
      return;
    }
    const soldAt = Date.now();
    updateRecords((current) => ({
      ...current,
      products: current.products.map((item) =>
        item.id === product.id ? { ...item, stock: item.stock - 1 } : item,
      ),
      sales: [
        {
          id: soldAt,
          product: product.name,
          quantity: 1,
          total: product.price,
          time: formatExactTime(soldAt),
          server: "Caja",
          createdAt: soldAt,
        },
        ...current.sales,
      ],
    }));
    showToast(`${product.name} agregado a ventas`);
  };
  const deleteProduct = (product: Product) => {
    if (!window.confirm(`¿Eliminar ${product.name} del inventario?`)) return;
    updateRecords((current) => ({
      ...current,
      products: current.products.filter((item) => item.id !== product.id),
    }));
    showToast(`${product.name} eliminado del inventario`);
  };
  const saveProductPrice = () => {
    if (!isAdmin || !priceEdit) return;
    const value = Number(priceEdit.value);
    if (!Number.isFinite(value) || value < 0) {
      showToast("Ingresa un precio válido");
      return;
    }
    const target = priceEdit.product;
    updateRecords((current) => ({
      ...current,
      products: current.products.map((item) =>
        item.id === target.id ? { ...item, price: value } : item,
      ),
    }));
    setPriceEdit(null);
    showToast(`Precio de ${target.name} actualizado a ${money(value)}`);
  };
  // Losses are admin-only; linking a product also removes it from inventory.
  const registerIncident = () => {
    if (!isAdmin) return;
    const quantity = Number(newIncident.quantity);
    const linkedProduct = newIncident.productId
      ? products.find(
          (product) => product.id === Number(newIncident.productId),
        )
      : undefined;
    const unitValue = newIncident.unitValue
      ? Number(newIncident.unitValue)
      : (linkedProduct?.price ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      showToast("Indica una cantidad mayor que cero");
      return;
    }
    if (!Number.isFinite(unitValue) || unitValue < 0) {
      showToast("Indica un valor unitario válido");
      return;
    }
    if (linkedProduct && quantity > linkedProduct.stock) {
      showToast(`La cantidad supera el stock de ${linkedProduct.name}`);
      return;
    }
    const createdAt = Date.now();
    const incident: Incident = {
      id: createdAt,
      createdAt,
      kind: newIncident.kind,
      productId: linkedProduct?.id,
      product: linkedProduct?.name,
      quantity,
      unitValue,
      total: quantity * unitValue,
      note: newIncident.note.trim() || undefined,
      registeredBy: currentUser?.name ?? "Administrador",
      stockAdjusted: Boolean(linkedProduct),
    };
    updateRecords((current) => ({
      ...current,
      products: linkedProduct
        ? current.products.map((item) =>
            item.id === linkedProduct.id
              ? { ...item, stock: item.stock - quantity }
              : item,
          )
        : current.products,
      incidents: [incident, ...current.incidents],
    }));
    setNewIncident({
      kind: "Daño",
      productId: "",
      quantity: "1",
      unitValue: "",
      note: "",
    });
    showToast(`Incidencia registrada: ${money(incident.total)}`);
  };
  const deleteIncident = (incident: Incident) => {
    if (!isAdmin) return;
    if (
      !window.confirm(
        `¿Eliminar la incidencia de ${incident.product ?? "este registro"}?`,
      )
    )
      return;
    updateRecords((current) => ({
      ...current,
      products:
        incident.stockAdjusted && incident.productId !== undefined
          ? current.products.map((item) =>
              item.id === incident.productId
                ? { ...item, stock: item.stock + incident.quantity }
                : item,
            )
          : current.products,
      incidents: current.incidents.filter((item) => item.id !== incident.id),
    }));
    showToast("Registro de incidencia eliminado");
  };
  const dispatchRequest = (requestId: number) => {
    if (activeTurn.endedAt !== null) {
      showToast("Inicia un turno para despachar y registrar pagos");
      return;
    }
    let dispatched = false;
    let insufficientStock = false;
    let missingItems = false;
    let dispatchedTotal = 0;
    updateRecords((current) => {
      const request = current.requests.find((item) => item.id === requestId);
      if (!request || request.status === "Despachado") return current;
      if (!request.itemsList) {
        missingItems = true;
        return current;
      }
      const hasStock = request.itemsList.every(
        (line) =>
          (current.products.find((product) => product.id === line.productId)
            ?.stock ?? 0) >= line.quantity,
      );
      if (!hasStock) {
        insufficientStock = true;
        return current;
      }
      dispatchedTotal = requestTotal(request, current.products);
      const dispatchedAt = Date.now();
      const requestedAt = request.createdAt ?? request.id;
      const salesToAdd = request.itemsList.flatMap((line) => {
        const product = current.products.find(
          (item) => item.id === line.productId,
        );
        return product
          ? [
              {
                id: dispatchedAt + line.productId,
                product: product.name,
                quantity: line.quantity,
                total: (line.unitPrice ?? product.price) * line.quantity,
                time: formatExactTime(dispatchedAt),
                server: request.server,
                createdAt: dispatchedAt,
                requestId: request.id,
                requestedAt,
                table: request.table,
              },
            ]
          : [];
      });
      dispatched = true;
      return {
        ...current,
        products: current.products.map((product) => {
          const line = request.itemsList?.find(
            (item) => item.productId === product.id,
          );
          return line
            ? { ...product, stock: product.stock - line.quantity }
            : product;
        }),
        sales: [...salesToAdd, ...current.sales],
        requests: current.requests.map((item) =>
          item.id === requestId ? { ...item, status: "Despachado" } : item,
        ),
      };
    });
    if (insufficientStock)
      showToast("No hay stock suficiente para despachar este pedido");
    else if (missingItems)
      showToast(
        "La solicitud no tiene detalle de productos; no se puede registrar el pago",
      );
    else if (dispatched)
      showToast(
        `Pago de ${money(dispatchedTotal)} registrado; pedido despachado`,
      );
  };
  const refreshBarRequests = () => {
    if (
      !window.confirm(
        `¿Refrescar las solicitudes de ${activeEstablishment?.name}? Esta acción limpiará la bandeja del día.`,
      )
    )
      return;
    updateRecords((current) => ({ ...current, requests: [] }));
    showToast("Solicitudes al bar reiniciadas en cero");
  };
  const createWaiterRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeTurn.endedAt !== null) {
      showToast(
        "El turno está cerrado; solicita al administrador que lo inicie",
      );
      return;
    }
    const latestRecords =
      recordsByEstablishment[activeEstablishmentId] ?? records;
    const requestedProducts = Object.entries(waiterCart).flatMap(
      ([productId, quantity]) => {
        const product = latestRecords.products.find(
          (item) => item.id === Number(productId),
        );
        return product ? [{ product, quantity }] : [];
      },
    );
    const stockShortages = Object.entries(waiterCart).flatMap(
      ([productId, quantity]) => {
        const product = latestRecords.products.find(
          (item) => item.id === Number(productId),
        );
        return !product || product.stock < quantity
          ? [
              `${product?.name ?? "Producto eliminado"}: solicitaste ${quantity}, disponibles ${product?.stock ?? 0}`,
            ]
          : [];
      },
    );
    if (stockShortages.length > 0) {
      showToast(`Stock insuficiente: ${stockShortages.join("; ")}`);
      return;
    }
    const requestedItems = requestedProducts
      .map(({ product, quantity }) => `${quantity}x ${product.name}`)
      .join(", ");
    if (!newRequest.table.trim() || !requestedItems || !currentUser) {
      showToast("Indica la mesa y agrega al menos un producto");
      return;
    }
    const itemsList = requestedProducts.map(({ product, quantity }) => ({
      productId: product.id,
      quantity,
      unitPrice: product.price,
    }));
    const orderTotal = itemsList.reduce(
      (total, line) => total + line.unitPrice * line.quantity,
      0,
    );
    const requestedAt = Date.now();
    updateRecords((current) => ({
      ...current,
      requests: [
        {
          id: requestedAt,
          requesterId: currentUser.id,
          server: currentUser.name ?? "Mesero",
          table: newRequest.table.trim(),
          items: `${requestedItems} · Total a entregar: ${money(orderTotal)}`,
          itemsList,
          time: formatExactTime(requestedAt),
          createdAt: requestedAt,
          status: "Pendiente",
        },
        ...current.requests,
      ],
    }));
    setNewRequest({ table: "", items: "" });
    setWaiterCart({});
    setWaiterProductSearch("");
    showToast(
      `Solicitud enviada. Entrega ${money(orderTotal)} al bar al despachar`,
    );
  };
  const addToWaiterCart = (product: Product) => {
    if (activeTurn.endedAt !== null) {
      showToast("El turno está cerrado; no puedes agregar productos al pedido");
      return;
    }
    setWaiterCart((current) => {
      if (product.stock <= (current[product.id] ?? 0)) {
        showToast(
          product.stock > 0
            ? `Solo hay ${product.stock} disponibles de ${product.name}`
            : `${product.name} no tiene existencias`,
        );
        return current;
      }
      return { ...current, [product.id]: (current[product.id] ?? 0) + 1 };
    });
  };
  const removeFromWaiterCart = (product: Product) =>
    setWaiterCart((current) => {
      const next = { ...current };
      if (!next[product.id] || next[product.id] === 1) delete next[product.id];
      else next[product.id] -= 1;
      return next;
    });
  const addToBarCart = (product: Product) => {
    if (activeTurn.endedAt !== null) {
      showToast(
        "El turno está cerrado; no se pueden registrar ventas en la barra",
      );
      return;
    }
    setBarCart((current) => {
      if (product.stock <= (current[product.id] ?? 0)) {
        showToast(
          product.stock > 0
            ? `Solo hay ${product.stock} disponibles de ${product.name}`
            : `${product.name} no tiene existencias`,
        );
        return current;
      }
      return { ...current, [product.id]: (current[product.id] ?? 0) + 1 };
    });
  };
  const removeFromBarCart = (product: Product) =>
    setBarCart((current) => {
      const next = { ...current };
      if (!next[product.id] || next[product.id] === 1) delete next[product.id];
      else next[product.id] -= 1;
      return next;
    });
  /**
   * Walk-in sale at the bar: no table, no waiter request. The stock discount
   * and the sale lines are written in a single revision-checked save; the
   * `channel: 'barra'` marker is what the database validates for the bar role.
   */
  const registerDirectBarSale = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeTurn.endedAt !== null) {
      showToast("El turno está cerrado; no se pueden registrar ventas");
      return;
    }
    if (!currentUser) {
      showToast("No se identificó al vendedor; cierra sesión y vuelve a entrar");
      return;
    }
    const saleLines = Object.entries(barCart).flatMap(
      ([productId, quantity]) => {
        const product = products.find((item) => item.id === Number(productId));
        return product ? [{ product, quantity }] : [];
      },
    );
    if (barCartShortages.length > 0) {
      showToast(`Stock insuficiente: ${barCartShortages.join("; ")}`);
      return;
    }
    if (saleLines.length === 0) {
      showToast("Agrega al menos un producto para registrar la venta");
      return;
    }
    const soldAt = Date.now();
    const orderId = soldAt;
    const saleTotal = saleLines.reduce(
      (total, line) => total + line.product.price * line.quantity,
      0,
    );
    updateRecords((current) => ({
      ...current,
      products: current.products.map((product) => {
        const line = saleLines.find((item) => item.product.id === product.id);
        return line
          ? { ...product, stock: product.stock - line.quantity }
          : product;
      }),
      sales: [
        ...saleLines.map(({ product, quantity }, index) => ({
          id: soldAt + index,
          orderId,
          channel: "barra" as const,
          productId: product.id,
          product: product.name,
          quantity,
          total: product.price * quantity,
          time: formatExactTime(soldAt),
          server: currentUser.name,
          createdAt: soldAt,
          table: "Barra",
        })),
        ...current.sales,
      ],
    }));
    setBarCart({});
    setBarProductSearch("");
    showToast(`Venta de ${money(saleTotal)} registrada en la barra`);
  };

  // ---------------------------------------------------------------------------
  // Administrator & staff management (secured Edge Function)
  // ---------------------------------------------------------------------------
  // Administrator account management remains routed through the secured Edge Function.
  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !activeEstablishmentId) {
      showToast("Inicia sesión y selecciona un establecimiento");
      return;
    }
    const username = newUser.username.trim().toLowerCase().replace(/\s+/g, ".");
    if (!newUser.name.trim() || !username || !newUser.password.trim()) {
      showToast("Completa nombre, usuario y contraseña");
      return;
    }
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || newUser.password.length < 8) {
      showToast(
        "El usuario debe tener 3–32 caracteres y la contraseña al menos 8",
      );
      return;
    }
    if (users.some((user) => user.username === username)) {
      showToast("Ese nombre de usuario ya existe en este establecimiento");
      return;
    }
    if (isEphemeralTestMode) {
      updateRecords((current) => ({
        ...current,
        users: [
          ...current.users,
          {
            id: `test-${Date.now()}`,
            username,
            name: newUser.name.trim(),
            zone: newUser.zone,
            role: newUser.role,
            active: true,
          },
        ],
      }));
      setNewUser({
        name: "",
        username: "",
        password: "",
        role: "waiter",
        zone: "Salón principal",
      });
      showToast(
        "Usuario creado en modo prueba: no se guarda en la base de datos",
      );
      return;
    }
    const { data, error } = await supabase.functions.invoke("manage-staff", {
      body: {
        action: "create",
        establishmentId: activeEstablishmentId,
        name: newUser.name.trim(),
        username,
        password: newUser.password,
        role: newUser.role,
        zone: newUser.zone,
      },
    });
    if (error || data?.error) {
      showToast(
        await edgeFunctionError(error, data, "No se pudo crear el usuario"),
      );
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, full_name, role, zone")
      .eq("id", data.id)
      .single();
    if (profileError) {
      showToast(
        `Cuenta creada, pero no se pudo cargar: ${profileError.message}`,
      );
      return;
    }
    updateRecords((current) => ({
      ...current,
      users: [...current.users, toStaffUser(profile)],
    }));
    setNewUser({
      name: "",
      username: "",
      password: "",
      role: "waiter",
      zone: "Salón principal",
    });
    showToast(
      `${newUser.role === "bar" ? "Usuario de bar" : "Mesero"} creado correctamente`,
    );
  };
  const deleteUser = async (user: User) => {
    if (!window.confirm(`¿Eliminar el usuario ${user.name}?`)) return;
    if (isEphemeralTestMode) {
      updateRecords((current) => ({
        ...current,
        users: current.users.filter((item) => item.id !== user.id),
      }));
      showToast(
        `${user.name} eliminado en modo prueba: no se guarda en la base de datos`,
      );
      return;
    }
    if (!supabase) {
      showToast("Supabase no está configurado");
      return;
    }
    const { data, error } = await supabase.functions.invoke("manage-staff", {
      body: {
        action: "delete",
        establishmentId: activeEstablishmentId,
        id: user.id,
      },
    });
    if (error || data?.error) {
      showToast(
        await edgeFunctionError(error, data, "No se pudo eliminar el usuario"),
      );
      return;
    }
    updateRecords((current) => ({
      ...current,
      users: current.users.filter((item) => item.id !== user.id),
    }));
    showToast(`${user.name} eliminado`);
  };
  const createEstablishment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase || !session || !isAdmin) {
      showToast("Inicia sesión como administrador para crear establecimientos");
      return;
    }
    if (
      !newEstablishment.name.trim() ||
      !newEstablishment.city.trim() ||
      !newEstablishment.taxId.trim()
    ) {
      showToast(
        "Completa el nombre, ubicación e identificación fiscal del establecimiento",
      );
      return;
    }
    if (isEphemeralTestMode) {
      const establishment: Establishment = {
        id: `test-${Date.now()}`,
        name: newEstablishment.name.trim(),
        city: newEstablishment.city.trim(),
        country: newEstablishment.country,
        taxId: newEstablishment.taxId.trim(),
      };
      setEstablishments((current) => [...current, establishment]);
      bootstrapEstablishment(establishment);
      setNewEstablishment(emptyEstablishmentForm);
      showToast(
        "Establecimiento creado en modo prueba: no se guarda en la base de datos",
      );
      return;
    }
    void (async () => {
      const { data, error } = await supabase
        .from("establishments")
        .insert({
          owner_id: (await supabase.auth.getUser()).data.user?.id,
          name: newEstablishment.name.trim(),
          city: newEstablishment.city.trim(),
          country: newEstablishment.country,
          tax_id: newEstablishment.taxId.trim(),
        })
        .select("id, name, city, country, tax_id, owner_id")
        .single();
      if (error) {
        showToast(`No se pudo crear el establecimiento: ${error.message}`);
        return;
      }
      const establishment: Establishment = {
        id: data.id,
        name: data.name,
        city: data.city,
        country: data.country,
        taxId: data.tax_id,
        owner_id: data.owner_id,
      };
      setEstablishments((current) => [...current, establishment]);
      bootstrapEstablishment(establishment);
      setNewEstablishment(emptyEstablishmentForm);
      showToast(
        "Establecimiento creado. Preparando el catálogo inicial en Supabase.",
      );
    })();
  };

  // ---------------------------------------------------------------------------
  // Render: authentication screens (loading, login, MFA, registration)
  // ---------------------------------------------------------------------------
  // Render authentication screens before mounting the authenticated POS workspace.
  if (authLoading)
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="brand login-brand">
            <div className="brand-mark">K</div>
            <div>
              <strong>Kuantika POS</strong>
              <span>portal de operación</span>
            </div>
          </div>
          <p className="login-copy">Conectando con Kuantika POS…</p>
        </div>
      </div>
    );

  if (showLogin || !session) {
    const loginBody = (
      <>
        <div className="login-screen">
          {showPrivacyModal && (
            <div
              className="privacy-modal-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Política de uso y tratamiento de datos"
            >
              <div className="privacy-modal">
                <div className="privacy-modal-header">
                  <strong>Política de uso y tratamiento de datos</strong>
                  <button
                    type="button"
                    aria-label="Cerrar"
                    onClick={() => setShowPrivacyModal(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="privacy-modal-body">
                  <PrivacyNotice />
                </div>
              </div>
            </div>
          )}
          <div className="login-card">
            <div className="brand login-brand">
              <div className="brand-mark">K</div>
              <div>
                <strong>Kuantika POS</strong>
                <span>portal de operación</span>
              </div>
            </div>
            <div className="ai-disclosure-login">
              <strong>Aviso de inteligencia artificial y arbitraje:</strong>{" "}
              Esta plataforma utiliza inteligencia artificial para apoyar
              análisis, recomendaciones y automatización operativa. Las
              decisiones finales y la revisión humana siguen siendo
              responsabilidad del usuario o administrador. Cualquier
              controversia derivada del uso de la plataforma se resolverá
              mediante arbitraje vinculante, a menos que la ley aplicable exija
              otra vía, y la parte que pretenda reclamar deberá seguir este
              mecanismo antes de acudir a otras acciones legales.
            </div>
            {!supabase ? (
              <>
                <h1>Falta configurar Supabase</h1>
                <p className="login-copy">
                  Configura la URL y la clave pública del proyecto en el archivo
                  local `.env.local`, aplica la migración SQL y vuelve a iniciar
                  la aplicación.
                </p>
              </>
            ) : mfaFlow ? (
              <>
                <span className="section-kicker">SEGURIDAD DE CUENTA ROOT</span>
                <h1>Verificación multifactor</h1>
                <p className="login-copy">
                  {mfaFlow.qrCode
                    ? "Escanea el código con una aplicación autenticadora y escribe el código generado. Guarda la clave de configuración en un lugar seguro."
                    : "Escribe el código de tu aplicación autenticadora."}
                </p>
                {mfaFlow.qrCode && (
                  <div className="mfa-setup">
                    <img
                      src={mfaFlow.qrCode}
                      alt="Código QR para configurar MFA"
                    />
                    <code>{mfaFlow.secret}</code>
                  </div>
                )}
                <form onSubmit={verifyRootMfa} className="login-form">
                  <label>
                    Código de verificación
                    <input
                      required
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value)}
                      placeholder="Código de 6 dígitos"
                    />
                  </label>
                  {loginError && (
                    <span className="login-error">{loginError}</span>
                  )}
                  <button className="primary-button" type="submit">
                    Verificar y continuar
                  </button>
                </form>
              </>
            ) : authMode === "register" ? (
              <>
                <span className="section-kicker">
                  NUEVA CUENTA ADMINISTRADORA
                </span>
                <h1>Crea tu cuenta</h1>
                <p className="login-copy">
                  Regístrate para administrar tus establecimientos y equipo.
                </p>
                <form onSubmit={signUpAdministrator} className="login-form">
                  <label>
                    Nombre completo
                    <input
                      required
                      autoFocus
                      value={registration.name}
                      onChange={(event) =>
                        setRegistration({
                          ...registration,
                          name: event.target.value,
                        })
                      }
                      placeholder="Tu nombre"
                    />
                  </label>
                  <label>
                    Correo electrónico
                    <input
                      required
                      type="email"
                      value={registration.email}
                      onChange={(event) =>
                        setRegistration({
                          ...registration,
                          email: event.target.value,
                        })
                      }
                      placeholder="tu@correo.com"
                    />
                  </label>
                  <label>
                    Contraseña
                    <input
                      required
                      type="password"
                      minLength={8}
                      value={registration.password}
                      onChange={(event) =>
                        setRegistration({
                          ...registration,
                          password: event.target.value,
                        })
                      }
                      placeholder="Mínimo 8 caracteres"
                    />
                  </label>
                  {loginError && (
                    <span className="login-error">{loginError}</span>
                  )}
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={!acceptedPrivacy}
                  >
                    Crear cuenta <span>→</span>
                  </button>
                </form>
                <button
                  className="back-login"
                  onClick={() => {
                    setAuthMode("login");
                    setLoginError("");
                  }}
                >
                  Ya tengo una cuenta · Iniciar sesión
                </button>
              </>
            ) : authMode === "forgot-password" ? (
              <>
                <span className="section-kicker">RECUPERACIÓN DE CUENTA</span>
                <h1>¿Olvidaste tu contraseña?</h1>
                <p className="login-copy">
                  Ingresa tu correo electrónico y te enviaremos un enlace para restablecerla.
                </p>
                <form onSubmit={requestPasswordReset} className="login-form">
                  <label>
                    Correo electrónico
                    <input
                      required
                      type="email"
                      autoFocus
                      value={resetEmail}
                      onChange={(event) => setResetEmail(event.target.value)}
                      placeholder="tu@correo.com"
                    />
                  </label>
                  {loginError && (
                    <span className="login-error">{loginError}</span>
                  )}
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={authLoading}
                  >
                    Enviar enlace de recuperación <span>→</span>
                  </button>
                </form>
                <button
                  className="back-login"
                  onClick={() => {
                    setAuthMode("login");
                    setLoginError("");
                  }}
                >
                  Volver al inicio de sesión
                </button>
              </>
            ) : authMode === "reset-password" ? (
              <>
                <span className="section-kicker">RESTABLECER CONTRASEÑA</span>
                <h1>Nueva contraseña</h1>
                <p className="login-copy">
                  Ingresa tu nueva contraseña para acceder a tu cuenta.
                </p>
                <form onSubmit={updatePassword} className="login-form">
                  <label>
                    Nueva contraseña
                    <input
                      required
                      type="password"
                      autoFocus
                      minLength={8}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      placeholder="Mínimo 8 caracteres"
                    />
                  </label>
                  {loginError && (
                    <span className="login-error">{loginError}</span>
                  )}
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={authLoading}
                  >
                    Actualizar contraseña <span>→</span>
                  </button>
                </form>
              </>
            ) : (
              <>
                <h1>Ingresa a tu portal</h1>
                <p className="login-copy">
                  Accede como administrador, mesero o usuario de bar.
                </p>
                <form onSubmit={signIn} className="login-form">
                  <label>
                    Correo (administrador) o usuario
                    <input
                      required
                      autoFocus
                      value={login.username}
                      onChange={(event) =>
                        setLogin({ ...login, username: event.target.value })
                      }
                      placeholder="Tu correo o usuario"
                    />
                  </label>
                  <label>
                    Contraseña
                    <input
                      required
                      type="password"
                      value={login.password}
                      onChange={(event) =>
                        setLogin({ ...login, password: event.target.value })
                      }
                      placeholder="Tu contraseña"
                    />
                  </label>
                  {loginError && (
                    <span className="login-error">{loginError}</span>
                  )}
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={!acceptedPrivacy || authLoading}
                  >
                    Ingresar al portal <span>→</span>
                  </button>
                </form>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    className="back-login"
                    onClick={() => {
                      setAuthMode("forgot-password");
                      setLoginError("");
                      setResetEmail(login.username.includes("@") ? login.username : "");
                    }}
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                  <button
                    className="back-login"
                    onClick={() => {
                      setAuthMode("register");
                      setLoginError("");
                    }}
                  >
                    Crear cuenta de administrador
                  </button>
                </div>
              </>
            )}
            <div className="login-privacy">
              <label>
                <input
                  type="checkbox"
                  checked={acceptedPrivacy}
                  onChange={(event) => setAcceptedPrivacy(event.target.checked)}
                />
                <span>
                  He leído y acepto la{" "}
                  <button
                    type="button"
                    className="privacy-link"
                    onClick={() => setShowPrivacyModal(true)}
                  >
                    Política de uso y tratamiento de datos
                  </button>
                  .
                </span>
              </label>
            </div>
            {session && (
              <button
                className="back-login"
                onClick={() => setShowLogin(false)}
              >
                Volver al panel
              </button>
            )}
          </div>
        </div>
      </>
    );
    return <>{loginBody}</>;
  }

  // ---------------------------------------------------------------------------
  // Render: authenticated workspace shell and operational views
  // ---------------------------------------------------------------------------
  // The workspace shell owns navigation; feature views consume the state and commands above.
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>Kuantika POS</strong>
            <span>operaciones</span>
          </div>
        </div>
        {!isRoot && (
          <div className="location">
            <span className="live-dot" />
            <select
              value={activeEstablishmentId}
              disabled={!isAdmin}
              onChange={(event) => {
                setActiveEstablishmentId(event.target.value);
                setActiveView("Resumen");
                setSearch("");
              }}
            >
              {establishments.map((establishment) => (
                <option value={establishment.id} key={establishment.id}>
                  {establishment.name}
                </option>
              ))}
            </select>
            <span className="chevron">⌄</span>
          </div>
        )}
        <nav className="main-nav">
          {(isRoot
            ? ["Consola root"]
            : isAdmin
              ? [
                  "Resumen",
                  "Inventario",
                  "Solicitudes",
                  "Ventas",
                  "Incidentes",
                  "Usuarios",
                  "Establecimientos",
                  "Cierre de turno",
                ]
              : isBar
                ? ["Solicitudes", "Venta en barra"]
                : ["Solicitudes"]
          ).map((view) => (
            <button
              className={activeView === view ? "nav-item active" : "nav-item"}
              onClick={() => setActiveView(view)}
              key={view}
            >
              <span className="nav-icon">
                {view === "Resumen"
                  ? "⌂"
                  : view === "Inventario"
                    ? "▦"
                    : view === "Solicitudes"
                      ? "↗"
                      : view === "Ventas"
                        ? "$"
                        : view === "Incidentes"
                          ? "⚠"
                          : view === "Usuarios"
                            ? "♙"
                            : view === "Establecimientos"
                              ? "⌂"
                              : view === "Consola root"
                                ? "◆"
                                : view === "Venta en barra"
                                  ? "◈"
                                  : "◷"}
              </span>
              {view === "Solicitudes" && isBar ? "Bandeja del bar" : view}
              {view === "Solicitudes" && pendingRequests > 0 && (
                <span className="nav-badge">{pendingRequests}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {rootSandboxActive && (
            <div className="role-preview">
              <span className="role-preview-label">Ver como</span>
              <div className="role-preview-options">
                {(["admin", "waiter", "bar"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={
                      previewRole === role
                        ? "role-preview-option active"
                        : "role-preview-option"
                    }
                    onClick={() => {
                      setPreviewRole(role);
                      setActiveView(role === "admin" ? "Resumen" : "Solicitudes");
                    }}
                  >
                    {role === "admin" ? "Admin" : role === "waiter" ? "Mesero" : "Bar"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {rootSandboxActive && (
            <button className="root-return-button" onClick={leaveRootSandbox}>
              ← Volver a consola root
            </button>
          )}
          <div className="shift-card">
            <span>Sesión activa</span>
            <strong>
              {isRoot
                ? "Root de soporte"
                : isAdmin
                  ? "Administrador"
                  : currentUser?.name}
            </strong>
            <small>
              {isRoot
                ? "Acceso global auditado"
                : isBar
                  ? `Bar · ${activeEstablishment?.name ?? ""}`
                  : activeEstablishment?.name}
            </small>
          </div>
          <button
            className="user-button"
            onClick={() => (isAdmin ? setShowLogin(true) : void signOut())}
          >
            <span className="avatar">
              {isRoot ? "R" : isAdmin ? "JD" : currentUser?.name.slice(0, 1)}
            </span>
            <span>
              <strong>
                {isRoot
                  ? "Root de soporte"
                  : isAdmin
                    ? "Juan Delgado"
                    : currentUser?.name}
              </strong>
              <small>{isAdmin ? "Cambiar de usuario" : "Cerrar sesión"}</small>
            </span>
            <span className="chevron">⌄</span>
          </button>
        </div>
      </aside>
      <main className="content">
        {rootPreview && (
          <div className="root-preview-banner" role="status">
            <strong>Vista previa local · datos ficticios</strong>
            <span>
              Solo puedes revisar la interfaz. No se consultan ni se guardan
              datos reales.
            </span>
          </div>
        )}
        <div className="ai-disclosure-banner">
          <strong>Aviso de inteligencia artificial y arbitraje:</strong> Este
          sitio utiliza inteligencia artificial para apoyar análisis,
          recomendaciones y automatización operativa. No sustituye la revisión
          humana ni la responsabilidad final del operador. Cualquier
          controversia relacionada con el uso de la plataforma se resolverá
          mediante arbitraje vinculante, conforme a la ley aplicable y con
          previo cumplimiento de este mecanismo de solución.
        </div>
        <PrivacyNotice />
        {rootSandboxActive && (
          <div className="root-preview-banner" role="status">
            <strong>Testing establecimiento · modo de prueba</strong>
            <span>
              Estás viendo la experiencia de los usuarios no root. Los cambios
              que hagas no se guardan en la base de datos.
            </span>
            <button className="request-action" onClick={leaveRootSandbox}>
              Volver a consola root
            </button>
          </div>
        )}
        <header className="topbar">
          <div>
            <span className="eyebrow">
              {isRoot
                ? "KUANTIKA POS · ACCESO ROOT"
                : `${activeEstablishment?.name.toUpperCase() ?? "ESTABLECIMIENTO"}`}
            </span>
            <h1>
              {activeView === "Resumen"
                ? "Resumen operativo"
                : activeView === "Solicitudes"
                  ? isBar
                    ? "Bandeja del bar"
                    : "Operación de sala"
                  : activeView}
            </h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" title="Notificaciones">
              ♢<span className="notification-dot" />
            </button>
            <div className="header-avatar">
              {isRoot ? "R" : isAdmin ? "JD" : currentUser?.name.slice(0, 1)}
            </div>
          </div>
        </header>
        {/* Privileged support console and audited administrator actions. */}
        {isRoot && activeView === "Consola root" && (
          <section className="view-section root-console">
            <div className="view-toolbar">
              <div>
                <span className="section-kicker">
                  SOPORTE Y CONTROL DE ACCESO
                </span>
                <h2>Administradores y establecimientos</h2>
              </div>
              <button
                className="primary-button"
                onClick={() => void loadRootConsole()}
                disabled={rootLoading}
              >
                {rootLoading ? "Actualizando…" : "Actualizar datos"}
              </button>
            </div>
            <p className="root-warning">
              Acceso privilegiado. Las modificaciones y suspensiones quedan
              registradas en la auditoría. Nunca se muestran ni se modifican
              contraseñas.
            </p>
            <article className="panel root-sandbox-panel">
              <div>
                <span className="section-kicker">ENTORNO AISLADO</span>
                <h3>Testing Establecimiento</h3>
                <p className="muted">
                  Espacio de prueba local con inventario y usuarios ficticios.
                  Puedes operar como lo hará un usuario externo; nada se guarda
                  en la base de datos.
                </p>
              </div>
              <div className="root-sandbox-actions">
                <span className="muted">
                  {rootSandbox
                    ? `${rootSandbox.city}, ${rootSandbox.country}`
                    : "Entorno local sin conexión"}
                </span>
                <button className="primary-button" onClick={enterRootSandbox}>
                  Entrar a probar
                </button>
              </div>
            </article>
            <label className="root-search-label">
              Buscar administrador
              <input
                value={rootSearch}
                onChange={(event) => setRootSearch(event.target.value)}
                placeholder="Nombre o correo"
              />
            </label>
            {rootError && (
              <div className="login-error" role="alert">
                {rootError}
              </div>
            )}
            {rootLoading && rootAccounts.length === 0 ? (
              <div className="panel root-empty">Cargando cuentas…</div>
            ) : (
              rootAccounts
                .filter((account) =>
                  `${account.fullName} ${account.email}`
                    .toLowerCase()
                    .includes(rootSearch.toLowerCase()),
                )
                .map((account) => {
                  const accountActive =
                    !account.bannedUntil ||
                    Date.parse(account.bannedUntil) <= clockNow;
                  const edits = rootEdits[account.id] ?? {
                    fullName: account.fullName,
                    email: account.email,
                  };
                  return (
                    <article className="panel root-account" key={account.id}>
                      <div className="root-account-heading">
                        <div>
                          <span className="section-kicker">
                            ADMINISTRADOR ·{" "}
                            {accountActive ? "ACTIVO" : "SUSPENDIDO"}
                          </span>
                          <h3>{account.fullName}</h3>
                          <span className="muted">{account.email}</span>
                        </div>
                        <button
                          className={
                            accountActive ? "remove-user" : "request-action"
                          }
                          onClick={() =>
                            void runRootAction(
                              {
                                action: "set_status",
                                targetUserId: account.id,
                                active: !accountActive,
                              },
                              accountActive
                                ? "Cuenta suspendida"
                                : "Cuenta reactivada",
                            )
                          }
                        >
                          {accountActive
                            ? "Suspender cuenta"
                            : "Reactivar cuenta"}
                        </button>
                      </div>
                      <div className="root-metadata">
                        <span>
                          Registro:{" "}
                          {new Date(account.createdAt).toLocaleString("es-CO")}
                        </span>
                        <span>
                          Último acceso:{" "}
                          {account.lastSignInAt
                            ? new Date(account.lastSignInAt).toLocaleString(
                                "es-CO",
                              )
                            : "Nunca"}
                        </span>
                        <span>
                          Correo:{" "}
                          {account.emailConfirmedAt
                            ? "Confirmado"
                            : "Pendiente de confirmar"}
                        </span>
                      </div>
                      <form
                        className="root-edit-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void runRootAction(
                            {
                              action: "update_admin",
                              targetUserId: account.id,
                              ...edits,
                            },
                            "Perfil de administrador actualizado",
                          );
                        }}
                      >
                        <label>
                          Nombre
                          <input
                            required
                            value={edits.fullName}
                            onChange={(event) =>
                              setRootEdits((current) => ({
                                ...current,
                                [account.id]: {
                                  ...edits,
                                  fullName: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <label>
                          Correo electrónico
                          <input
                            required
                            type="email"
                            value={edits.email}
                            onChange={(event) =>
                              setRootEdits((current) => ({
                                ...current,
                                [account.id]: {
                                  ...edits,
                                  email: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <button className="primary-button" type="submit">
                          Guardar perfil
                        </button>
                      </form>
                      <div className="root-establishments">
                        <h4>
                          Establecimientos ({account.establishments.length})
                        </h4>
                        {account.establishments.length === 0 && (
                          <span className="muted">
                            Sin establecimientos registrados
                          </span>
                        )}
                        {account.establishments.map((establishment) => {
                          const edit =
                            rootEstablishmentEdits[establishment.id] ??
                            establishment;
                          return (
                            <form
                              className="root-establishment-form"
                              key={establishment.id}
                              onSubmit={(event) => {
                                event.preventDefault();
                                void runRootAction(
                                  {
                                    action: "update_establishment",
                                    targetUserId: account.id,
                                    ...edit,
                                  },
                                  "Establecimiento corregido",
                                );
                              }}
                            >
                              <div className="root-establishment-title">
                                <strong>{establishment.name}</strong>
                                <small>ID fiscal: {establishment.taxId}</small>
                              </div>
                              <label>
                                Nombre
                                <input
                                  required
                                  value={edit.name}
                                  onChange={(event) =>
                                    setRootEstablishmentEdits((current) => ({
                                      ...current,
                                      [establishment.id]: {
                                        ...edit,
                                        name: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                              <label>
                                Ciudad
                                <input
                                  required
                                  value={edit.city}
                                  onChange={(event) =>
                                    setRootEstablishmentEdits((current) => ({
                                      ...current,
                                      [establishment.id]: {
                                        ...edit,
                                        city: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                              <label>
                                País
                                <input
                                  required
                                  value={edit.country}
                                  onChange={(event) =>
                                    setRootEstablishmentEdits((current) => ({
                                      ...current,
                                      [establishment.id]: {
                                        ...edit,
                                        country: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                              <label>
                                Identificación fiscal
                                <input
                                  required
                                  value={edit.taxId}
                                  onChange={(event) =>
                                    setRootEstablishmentEdits((current) => ({
                                      ...current,
                                      [establishment.id]: {
                                        ...edit,
                                        taxId: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </label>
                              <button className="request-action" type="submit">
                                Guardar establecimiento
                              </button>
                            </form>
                          );
                        })}
                      </div>
                    </article>
                  );
                })
            )}
            {!rootLoading && rootAccounts.length === 0 && (
              <div className="panel root-empty">
                No hay cuentas de administrador para mostrar.
              </div>
            )}
            <div className="panel root-audit">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">TRAZABILIDAD</span>
                  <h2>Actividad root reciente</h2>
                </div>
                <span>{rootAudit.length} eventos</span>
              </div>
              {rootAudit.length === 0 ? (
                <p className="muted">
                  Las acciones privilegiadas aparecerán aquí.
                </p>
              ) : (
                rootAudit.map((entry) => (
                  <div className="root-audit-row" key={entry.id}>
                    <span>
                      {new Date(entry.created_at).toLocaleString("es-CO")}
                    </span>
                    <strong>{entry.action}</strong>
                    <span>{JSON.stringify(entry.details)}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
        {!isAdmin && activeTurn.endedAt !== null && (
          <div className="shift-closed-notice" role="status">
            {isBar
              ? "El turno está cerrado; no se pueden despachar pedidos ni registrar ventas en la barra."
              : "El turno está cerrado. Solo un administrador puede iniciarlo; podrás solicitar al bar cuando esté abierto."}
          </div>
        )}
        {/* Inline validation shared by the waiter order form and product catalog. */}
        {isWaiter &&
          activeView === "Solicitudes" &&
          waiterCartShortages.length > 0 && (
            <div className="stock-shortage-notice" role="alert">
              <strong>Stock insuficiente para esta solicitud</strong>
              <span>{waiterCartShortages.join(" · ")}</span>
            </div>
          )}
        {/* Dashboard: shift totals, current stock, pending requests, and recent activity. */}
        {activeView === "Resumen" && (
          <>
            <section className="metrics-grid">
              <div className="metric-card coral">
                <span>
                  Ventas del turno <i>↗</i>
                </span>
                <strong>{money(totalSales)}</strong>
                <small>
                  <b>+12.8%</b> vs. turno anterior
                </small>
                <div className="sparkline">╱╲╱╱╲╱╱╲╱</div>
              </div>
              <div className="metric-card mint">
                <span>
                  Unidades en stock <i>↗</i>
                </span>
                <strong>{totalStock}</strong>
                <small>
                  <b>+6</b> ingresadas hoy
                </small>
                <div className="sparkline">╱╲╱╲╱╱╲╱</div>
              </div>
              <div className="metric-card yellow">
                <span>
                  Por reponer <i>↗</i>
                </span>
                <strong>
                  {lowStock}
                  <em> productos</em>
                </strong>
                <small>
                  <b>Atención</b> requieren compra
                </small>
                <div className="sparkline">╲╱╲╱╲╱╲</div>
              </div>
              <div className="metric-card orange">
                <span>
                  Incidencias registradas del turno <i>⚠</i>
                </span>
                <strong>{money(incidentsLoss)}</strong>
                <small>
                  <b>{turnIncidents.length}</b> incidentes registrados
                </small>
                <div className="sparkline">╱╲╲╱╱╲╲</div>
              </div>
            </section>
            <section className="main-grid">
              <div className="panel inventory-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">CONTROL DE MERCANCÍA</span>
                    <h2>Inventario en tiempo real</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setActiveView("Inventario")}
                  >
                    Ver inventario completo <span>→</span>
                  </button>
                </div>
                <div className="stock-table">
                  <div className="table-row table-head">
                    <span>Producto</span>
                    <span>Categoría</span>
                    <span>Existencia</span>
                    <span>Estado</span>
                  </div>
                  {products.slice(0, 5).map((product) => (
                    <div className="table-row" key={product.id}>
                      <span className="product-cell">
                        <span className="product-thumb">
                          {productIcon(product.category)}
                        </span>
                        <strong>{product.name}</strong>
                      </span>
                      <span className="muted">{product.category}</span>
                      <span>
                        <strong>{product.stock}</strong>{" "}
                        <small>{product.unit}s</small>
                      </span>
                      <span
                        className={
                          product.stock <= product.minimum
                            ? "status warning"
                            : "status good"
                        }
                      >
                        <span />
                        {product.stock <= product.minimum
                          ? "Reponer pronto"
                          : "En stock"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="panel requests-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">COMUNICACIÓN DE SALA</span>
                    <h2>
                      Pedidos al bar{" "}
                      <span className="count-pill">{pendingRequests}</span>
                    </h2>
                  </div>
                  <span className="inbox-live">
                    <span /> En vivo
                  </span>
                </div>
                <div className="request-list">
                  {requests.map((request) => (
                    <div className="request" key={request.id}>
                      <span className="request-avatar">
                        {request.server.slice(0, 1)}
                      </span>
                      <div className="request-info">
                        <strong>
                          {request.server} <small>{request.table}</small>
                        </strong>
                        <span>{request.items}</span>
                        <time>{request.time}</time>
                      </div>
                      {request.status === "Pendiente" ? (
                        <button
                          className="dispatch-button"
                          onClick={() => dispatchRequest(request.id)}
                        >
                          Despachar
                        </button>
                      ) : (
                        <span className="dispatched">✓ Listo</span>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  className="full-button"
                  onClick={() => setActiveView("Solicitudes")}
                >
                  Ver todas las solicitudes <span>→</span>
                </button>
              </div>
            </section>
            <section className="panel activity-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">MOVIMIENTOS DEL TURNO</span>
                  <h2>Últimas ventas</h2>
                </div>
                <button className="filter-button">
                  Este turno <span>⌄</span>
                </button>
              </div>
              <div className="sales-table">
                <div className="table-row table-head">
                  <span>Producto</span>
                  <span>Mesero</span>
                  <span>Hora</span>
                  <span className="align-right">Total</span>
                </div>
                {sales.slice(0, 4).map((sale) => (
                  <div className="table-row" key={sale.id}>
                    <span>
                      <strong>
                        {sale.quantity}x {sale.product}
                      </strong>
                    </span>
                    <span className="muted">{sale.server}</span>
                    <span className="muted">{sale.time}</span>
                    <span className="align-right">
                      <strong>{money(sale.total)}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        {/* Owner-only establishment creation and selection. */}
        {activeView === "Establecimientos" && (
          <section className="view-section establishments-view">
            <div className="view-toolbar">
              <div>
                <span className="section-kicker">
                  ADMINISTRACIÓN DE LOCALES
                </span>
                <h2>Mis establecimientos</h2>
              </div>
              <span className="active-users">
                <span />
                {establishments.length} establecimientos
              </span>
            </div>
            <div className="users-layout">
              <form className="panel user-form" onSubmit={createEstablishment}>
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">NUEVO LOCAL</span>
                    <h2>Agregar establecimiento</h2>
                  </div>
                  <span className="form-lock">⌂</span>
                </div>
                <div className="form-fields">
                  <label>
                    Nombre del establecimiento
                    <input
                      required
                      value={newEstablishment.name}
                      onChange={(event) =>
                        setNewEstablishment({
                          ...newEstablishment,
                          name: event.target.value,
                        })
                      }
                      placeholder="Ej. Terraza Caribe"
                    />
                  </label>
                  <label>
                    País
                    <select
                      value={newEstablishment.country}
                      onChange={(event) =>
                        setNewEstablishment({
                          ...newEstablishment,
                          country: event.target.value,
                        })
                      }
                    >
                      {Object.keys(taxIdExamples).map((country) => (
                        <option key={country}>{country}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ciudad o ubicación
                    <input
                      required
                      value={newEstablishment.city}
                      onChange={(event) =>
                        setNewEstablishment({
                          ...newEstablishment,
                          city: event.target.value,
                        })
                      }
                      placeholder="Ej. Cartagena"
                    />
                  </label>
                  <label>
                    {taxIdExamples[newEstablishment.country].label} del
                    establecimiento
                    <input
                      required
                      value={newEstablishment.taxId}
                      onChange={(event) =>
                        setNewEstablishment({
                          ...newEstablishment,
                          taxId: event.target.value,
                        })
                      }
                      placeholder={
                        taxIdExamples[newEstablishment.country].placeholder
                      }
                    />
                  </label>
                  <small className="tax-id-help">
                    El identificador fiscal cambia según el país. Ejemplos:
                    Colombia NIT 900.123.456-7 · México RFC XAXX010101000 ·
                    España NIF B12345678 · EE. UU. EIN 12-3456789 · Argentina
                    CUIT 30-12345678-9 · Chile RUT 76.123.456-7 · Perú RUC
                    20123456789.
                  </small>
                  <button className="primary-button" type="submit">
                    Crear establecimiento <span>→</span>
                  </button>
                </div>
              </form>
              <div className="panel users-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">LOCALES REGISTRADOS</span>
                    <h2>Operación independiente</h2>
                  </div>
                </div>
                <div className="establishment-list">
                  {establishments.map((establishment) => (
                    <button
                      className={
                        establishment.id === activeEstablishmentId
                          ? "establishment-row selected"
                          : "establishment-row"
                      }
                      onClick={() => {
                        setActiveEstablishmentId(establishment.id);
                        setActiveView("Resumen");
                      }}
                      key={establishment.id}
                    >
                      <span className="establishment-mark">⌂</span>
                      <span>
                        <strong>{establishment.name}</strong>
                        <small>
                          {establishment.city}
                          {establishment.country
                            ? `, ${establishment.country}`
                            : ""}{" "}
                          ·{" "}
                          {recordsByEstablishment[establishment.id]?.products
                            .length ?? 0}{" "}
                          productos registrados
                        </small>
                      </span>
                      <span className="establishment-arrow">→</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
        {/* Staff accounts are provisioned through the authenticated Edge Function. */}
        {activeView === "Usuarios" && (
          <section className="view-section users-view">
            <div className="view-toolbar">
              <div>
                <span className="section-kicker">
                  ADMINISTRACIÓN DE ACCESOS
                </span>
                <h2>Usuarios del establecimiento</h2>
              </div>
              <span className="active-users">
                <span />
                {users.length} usuarios activos
              </span>
            </div>
            <div className="users-layout">
              <form className="panel user-form" onSubmit={createUser}>
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">NUEVO ACCESO</span>
                    <h2>Crear usuario</h2>
                  </div>
                  <span className="form-lock">♙</span>
                </div>
                <div className="form-fields">
                  <label>
                    Nombre completo
                    <input
                      required
                      value={newUser.name}
                      onChange={(event) =>
                        setNewUser({ ...newUser, name: event.target.value })
                      }
                      placeholder="Ej. Laura Gómez"
                    />
                  </label>
                  <label>
                    Usuario
                    <input
                      required
                      minLength={3}
                      value={newUser.username}
                      onChange={(event) =>
                        setNewUser({ ...newUser, username: event.target.value })
                      }
                      placeholder="Ej. laura.gomez"
                    />
                  </label>{" "}
                  <label>
                    Contraseña
                    <input
                      required
                      type="password"
                      minLength={8}
                      value={newUser.password}
                      onChange={(event) =>
                        setNewUser({ ...newUser, password: event.target.value })
                      }
                      placeholder="Mínimo 8 caracteres"
                    />
                  </label>
                  <label>
                    Tipo de usuario
                    <select
                      value={newUser.role}
                      onChange={(event) =>
                        setNewUser({
                          ...newUser,
                          role: event.target.value === "bar" ? "bar" : "waiter",
                          zone:
                            event.target.value === "bar"
                              ? "Bar"
                              : "Salón principal",
                        })
                      }
                    >
                      <option value="waiter">Mesero</option>
                      <option value="bar">Bar</option>
                    </select>
                  </label>
                  {newUser.role === "waiter" && (
                    <label>
                      Zona asignada
                      <select
                        value={newUser.zone}
                        onChange={(event) =>
                          setNewUser({ ...newUser, zone: event.target.value })
                        }
                      >
                        <option>Salón principal</option>
                        <option>Terraza</option>
                        <option>Barra</option>
                        <option>Zona VIP</option>
                      </select>
                    </label>
                  )}
                  <button className="primary-button" type="submit">
                    Crear usuario <span>→</span>
                  </button>
                </div>
              </form>
              <div className="panel users-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">
                      EQUIPO DEL ESTABLECIMIENTO
                    </span>
                    <h2>Meseros y bar</h2>
                  </div>
                </div>
                <div className="users-table">
                  <div className="user-row user-head">
                    <span>Nombre</span>
                    <span>Usuario</span>
                    <span>Rol / zona</span>
                    <span />
                  </div>
                  {users.map((user) => (
                    <div className="user-row" key={user.id}>
                      <span className="user-name">
                        <span className="request-avatar">
                          {user.name.slice(0, 1)}
                        </span>
                        <strong>{user.name}</strong>
                      </span>
                      <span className="muted">@{user.username}</span>
                      <span className="user-zone">
                        {user.role === "bar" ? "Bar" : `Mesero · ${user.zone}`}
                      </span>
                      <button
                        className="remove-user"
                        onClick={() => deleteUser(user)}
                        title={`Eliminar ${user.name}`}
                      >
                        Eliminar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
        {/* Losses register: the admin records accidents and stock shortages. */}
        {activeView === "Incidentes" && isAdmin && (
          <section className="view-section incidents-view">
            <div className="view-toolbar">
              <div>
                <span className="section-kicker">CONTROL DE INCIDENCIAS</span>
                <h2>Incidentes y faltantes</h2>
              </div>
              <span className="active-users">
                <span />
                {incidents.length} registrados · {money(incidentsLoss)} este
                turno
              </span>
            </div>
            <div className="users-layout">
              <form
                className="panel user-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  registerIncident();
                }}
              >
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">NUEVO REGISTRO</span>
                    <h2>Reportar incidencia</h2>
                  </div>
                  <span className="form-lock">⚠</span>
                </div>
                <div className="form-fields">
                  <label>
                    Tipo de incidente
                    <select
                      value={newIncident.kind}
                      onChange={(event) =>
                        setNewIncident({
                          ...newIncident,
                          kind: event.target.value as IncidentKind,
                        })
                      }
                    >
                      <option value="Daño">Daño (se cayó / se rompió)</option>
                      <option value="Faltante">Faltante (unidades faltantes)</option>
                      <option value="Defectuoso">Defectuoso (producto de fábrica)</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </label>
                  <label>
                    Producto afectado
                    <select
                      value={newIncident.productId}
                      onChange={(event) =>
                        setNewIncident({
                          ...newIncident,
                          productId: event.target.value,
                        })
                      }
                    >
                      <option value="">Sin producto (solo valor)</option>
                      {products.map((product) => (
                        <option value={product.id} key={product.id}>
                          {product.name} · {money(product.price)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cantidad
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={newIncident.quantity}
                      onChange={(event) =>
                        setNewIncident({
                          ...newIncident,
                          quantity: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Valor unitario
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={newIncident.unitValue}
                      onChange={(event) =>
                        setNewIncident({
                          ...newIncident,
                          unitValue: event.target.value,
                        })
                      }
                      placeholder="Automático según el producto"
                    />
                  </label>
                  <label>
                    Nota
                    <input
                      value={newIncident.note}
                      onChange={(event) =>
                        setNewIncident({
                          ...newIncident,
                          note: event.target.value,
                        })
                      }
                      placeholder="Ej. caja de cerveza con 2 unidades faltantes"
                    />
                  </label>
                  <button className="primary-button" type="submit">
                    Registrar incidencia <span>→</span>
                  </button>
                </div>
              </form>
              <div className="panel users-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">
                      HISTORIAL DE INCIDENTES
                    </span>
                    <h2>Incidencias registradas</h2>
                  </div>
                </div>
                <div className="incidents-table">
                  <div className="incident-row incident-head">
                    <span>Producto</span>
                    <span>Tipo</span>
                    <span>Cant.</span>
                    <span>Valor</span>
                    <span>Hora</span>
                    <span />
                  </div>
                  {incidents.map((incident) => (
                    <div className="incident-row" key={incident.id}>
                      <span className="incident-product">
                        <strong>{incident.product ?? "Sin producto"}</strong>
                        {incident.note && <small>{incident.note}</small>}
                      </span>
                      <span className="incident-kind">{incident.kind}</span>
                      <span>{incident.quantity}</span>
                      <span>{money(incident.total)}</span>
                      <span className="muted">
                        {formatExactTime(incident.createdAt)}
                      </span>
                      <button
                        className="remove-user"
                        onClick={() => deleteIncident(incident)}
                        title="Eliminar registro"
                      >
                        Eliminar
                      </button>
                    </div>
                  ))}
                  {incidents.length === 0 && (
                    <div className="incident-row">
                      <span className="muted">
                        Aún no hay incidencias registradas en este establecimiento.
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
        {/* Sales ledger filtered by the selected reporting interval. */}
        {activeView === "Ventas" && (
          <section className="view-section sales-view">
            <div className="view-toolbar">
              <div>
                <span className="section-kicker">ANÁLISIS DE INGRESOS</span>
                <h2>Historial de pedidos y ventas</h2>
              </div>
              <div className="sales-report-controls">
                <label className="sales-date-picker">
                  Consultar fecha
                  <input
                    aria-label="Fecha de consulta"
                    type="date"
                    value={salesDate}
                    onChange={(event) => {
                      setSalesDate(event.target.value);
                      setSalesPeriod("Día");
                    }}
                  />
                </label>
                <div className="sales-periods">
                  {(["Día", "Semana", "Mes", "Trimestre", "Año"] as const).map(
                    (period) => (
                      <button
                        className={salesPeriod === period ? "selected" : ""}
                        onClick={() => setSalesPeriod(period)}
                        key={period}
                      >
                        {period}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
            <div className="sales-summary-grid">
              <div className="sales-summary-card coral">
                <span>Total vendido</span>
                <strong>{money(periodSalesTotal)}</strong>
                <small>
                  {salesPeriod.toLowerCase()} · {periodRangeLabel}
                </small>
              </div>
              <div className="sales-summary-card mint">
                <span>Unidades vendidas</span>
                <strong>{periodUnits}</strong>
                <small>productos despachados</small>
              </div>
              <div className="sales-summary-card yellow">
                <span>Pedidos despachados</span>
                <strong>{salesLedger.length}</strong>
                <small>órdenes registradas</small>
              </div>
            </div>
            <div className="panel report-sales-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">AUDITORÍA DEL PERÍODO</span>
                  <h2>Detalle por pedido</h2>
                </div>
                <span className="active-users">
                  <span />
                  {activeEstablishment?.name}
                </span>
              </div>
              <div className="sales-ledger-scroll">
                <div className="sales-ledger-row sales-ledger-head">
                  <span>Pedido realizado</span>
                  <span>Despachado</span>
                  <span>Mesero</span>
                  <span>Mesa</span>
                  <span>Productos solicitados</span>
                  <span className="sales-ledger-total">Total</span>
                </div>
                {salesLedger.length > 0 ? (
                  salesLedger.map((entry) => (
                    <div className="sales-ledger-row" key={entry.id}>
                      <span>{formatExactDateTime(entry.orderedAt)}</span>
                      <span>{formatExactDateTime(entry.dispatchedAt)}</span>
                      <span>{entry.server}</span>
                      <span>{entry.table}</span>
                      <span className="sales-ledger-products">
                        {entry.products.join(", ")}
                      </span>
                      <strong className="sales-ledger-total">
                        {money(entry.total)}
                      </strong>
                    </div>
                  ))
                ) : (
                  <div className="empty-sales">
                    No hay pedidos despachados en este período.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
        {/* Product catalog, stock adjustments, and register-at-counter sales. */}
        {activeView === "Inventario" && (
          <section className="view-section">
            <div className="view-toolbar">
              <div>
                <span className="section-kicker">CATÁLOGO Y EXISTENCIAS</span>
                <h2>Todos los productos</h2>
              </div>
              <button
                className="primary-button"
                onClick={() =>
                  showToast("Formulario de ingreso listo para conectar")
                }
              >
                + Ingresar mercancía
              </button>
            </div>
            <div className="inventory-controls">
              <label>
                Buscar producto
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Ej. cerveza o coctelería"
                />
              </label>
              <div className="category-tabs">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() =>
                      setSearch(category === "Todos" ? "" : category)
                    }
                    className={
                      search === category ||
                      (category === "Todos" && search === "")
                        ? "selected"
                        : ""
                    }
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
            <div className="product-grid">
              {visibleProducts.map((product) => (
                <div className="product-card" key={product.id}>
                  <div className="product-art">
                    {productIcon(product.category)}
                  </div>
                  <div className="product-card-info">
                    <span>{product.category}</span>
                    <h3>{product.name}</h3>
                    <strong>{money(product.price)}</strong>
                    <small>
                      {product.stock} {product.unit}s disponibles
                    </small>
                  </div>
                  <div className="product-actions">
                    <button onClick={() => registerSale(product)}>
                      Registrar venta
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() =>
                          setPriceEdit({
                            product,
                            value: String(product.price),
                          })
                        }
                      >
                        Editar precio
                      </button>
                    )}
                    <button
                      className="delete-button"
                      onClick={() => deleteProduct(product)}
                      title={`Eliminar ${product.name}`}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {priceEdit && (
              <div
                className="privacy-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-label={`Editar precio de ${priceEdit.product.name}`}
              >
                <div className="privacy-modal product-price-modal">
                  <div className="privacy-modal-header">
                    <strong>Editar precio</strong>
                    <button
                      type="button"
                      aria-label="Cerrar"
                      onClick={() => setPriceEdit(null)}
                    >
                      ×
                    </button>
                  </div>
                  <form
                    className="privacy-modal-body product-price-body"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveProductPrice();
                    }}
                  >
                    <p className="product-price-current">
                      {priceEdit.product.category} · {priceEdit.product.name}
                    </p>
                    <p className="product-price-current">
                      Precio actual: {money(priceEdit.product.price)}
                    </p>
                    <label className="product-price-field">
                      Nuevo precio
                      <input
                        type="number"
                        min="0"
                        step="100"
                        autoFocus
                        required
                        value={priceEdit.value}
                        onChange={(event) =>
                          setPriceEdit({
                            ...priceEdit,
                            value: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="product-price-actions">
                      <button type="button" onClick={() => setPriceEdit(null)}>
                        Cancelar
                      </button>
                      <button className="primary-button" type="submit">
                        Guardar precio
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </section>
        )}
        {/* Waiter order entry and bar dispatch queue share the same persisted requests. */}
        {activeView === "Solicitudes" && (
          <section className="view-section">
            <div className="view-toolbar requests-toolbar">
              <div>
                <span className="section-kicker">
                  {isBar ? "PREPARACIÓN DE PEDIDOS" : "OPERACIÓN DE SALA"}
                </span>
                <h2>
                  {isAdmin
                    ? "Solicitudes de meseros"
                    : isBar
                      ? "Bandeja del bar"
                      : "Pedir al bar"}
                </h2>
              </div>
              <div className="request-controls">
                {!isBar && (
                  <div className="server-counter">
                    <strong>{serverCount}</strong>
                    <span>meseros activos</span>
                  </div>
                )}
                {isAdmin && (
                  <>
                    <button
                      className="request-action"
                      onClick={() => setActiveView("Usuarios")}
                    >
                      Administrar usuarios <span>→</span>
                    </button>
                    <button
                      className="request-action refresh-requests"
                      onClick={refreshBarRequests}
                    >
                      ↻ Refrescar solicitudes
                    </button>
                  </>
                )}
              </div>
            </div>
            {isWaiter && (
              <form
                className="panel waiter-request-form"
                onSubmit={createWaiterRequest}
              >
                <div className="form-fields">
                  <label>
                    Mesa o zona
                    <input
                      value={newRequest.table}
                      onChange={(event) =>
                        setNewRequest({
                          ...newRequest,
                          table: event.target.value,
                        })
                      }
                      placeholder="Ej. Mesa 12"
                    />
                  </label>
                  <label>
                    Buscar bebida
                    <input
                      value={waiterProductSearch}
                      onChange={(event) =>
                        setWaiterProductSearch(event.target.value)
                      }
                      placeholder="Filtra por nombre o categoría"
                    />
                  </label>
                </div>
                <div className="waiter-products">
                  {availableWaiterProducts.map((product) => (
                    <button
                      type="button"
                      className="waiter-product"
                      onClick={() => addToWaiterCart(product)}
                      key={product.id}
                    >
                      <span className="product-thumb">
                        {productIcon(product.category)}
                      </span>
                      <span>
                        <strong>{product.name}</strong>
                        <small>
                          {product.stock} disponibles · {product.category}
                        </small>
                      </span>
                      <b>+ {waiterCart[product.id] ?? 0}</b>
                    </button>
                  ))}
                  {availableWaiterProducts.length === 0 && (
                    <span className="empty-products">
                      No hay productos disponibles para ese filtro.
                    </span>
                  )}
                </div>
                <div className="waiter-cart">
                  {Object.keys(waiterCart).length > 0 ? (
                    Object.entries(waiterCart).map(([productId, quantity]) => {
                      const product = products.find(
                        (item) => item.id === Number(productId),
                      );
                      return product ? (
                        <div className="cart-line" key={product.id}>
                          <span>
                            {quantity}x {product.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFromWaiterCart(product)}
                          >
                            −
                          </button>
                        </div>
                      ) : null;
                    })
                  ) : (
                    <span>Selecciona productos para armar tu solicitud.</span>
                  )}
                </div>
                <button className="primary-button" type="submit">
                  Enviar solicitud al bar <span>→</span>
                </button>
              </form>
            )}
            <div className="request-board">
              {requests
                .filter(
                  (request) =>
                    isAdmin ||
                    isBar ||
                    request.requesterId === currentUser?.id ||
                    request.server === currentUser?.name,
                )
                .map((request) => (
                  <div
                    className={`board-request ${request.status === "Despachado" ? "done" : ""}`}
                    key={request.id}
                  >
                    <div className="board-top">
                      <span className="request-avatar">
                        {request.server.slice(0, 1)}
                      </span>
                      <div>
                        <strong>{request.server}</strong>
                        <small>
                          {request.table} · {request.time}
                        </small>
                      </div>
                      <span
                        className={
                          request.status === "Pendiente"
                            ? "status warning"
                            : "status good"
                        }
                      >
                        <span />
                        {request.status}
                      </span>
                    </div>
                    <p>{request.items}</p>
                    {(isAdmin || isBar) && request.status === "Pendiente" ? (
                      <button
                        className="primary-button"
                        onClick={() => dispatchRequest(request.id)}
                      >
                        Despachar pedido
                      </button>
                    ) : request.status === "Despachado" ? (
                      <span className="done-label">✓ Pedido entregado</span>
                    ) : (
                      <span className="done-label">
                        Esperando despacho del bar
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </section>
        )}
        {/* Walk-in sales at the bar: no table, no waiter request behind them. */}
        {activeView === "Venta en barra" && isBar && (
          <section className="view-section bar-sale-view">
            <div className="view-toolbar">
              <div>
                <span className="section-kicker">ATENCIÓN EN LA BARRA</span>
                <h2>Venta directa al cliente</h2>
              </div>
            </div>
            <div className="close-grid">
              <div className="close-summary">
                <span>Total vendido</span>
                <strong>{money(totalSales)}</strong>
                <small>
                  {activeTurn.endedAt === null
                    ? "turno en curso"
                    : "turno cerrado"}
                </small>
              </div>
              <div className="close-summary">
                <span>Unidades vendidas</span>
                <strong>
                  {sales.reduce((total, sale) => total + sale.quantity, 0)}
                </strong>
                <small>productos entregados en este turno</small>
              </div>
              <div className="close-summary">
                <span>Tickets registrados</span>
                <strong>{groupSalesByOrder(sales).length}</strong>
                <small>órdenes de este turno</small>
              </div>
            </div>
            {barCartShortages.length > 0 && (
              <div className="stock-shortage-notice" role="alert">
                <strong>Stock insuficiente para esta venta</strong>
                <span>{barCartShortages.join(" · ")}</span>
              </div>
            )}
            <form
              className="panel waiter-request-form bar-sale-form"
              onSubmit={registerDirectBarSale}
            >
              <div className="form-fields">
                <label>
                  Buscar producto
                  <input
                    value={barProductSearch}
                    onChange={(event) =>
                      setBarProductSearch(event.target.value)
                    }
                    placeholder="Filtra por nombre o categoría"
                  />
                </label>
              </div>
              <div className="waiter-products">
                {availableBarProducts.map((product) => (
                  <button
                    type="button"
                    className="waiter-product"
                    onClick={() => addToBarCart(product)}
                    key={product.id}
                  >
                    <span className="product-thumb">
                      {productIcon(product.category)}
                    </span>
                    <span>
                      <strong>{product.name}</strong>
                      <small>
                        {product.stock} disponibles · {product.category}
                      </small>
                    </span>
                    <b>+ {barCart[product.id] ?? 0}</b>
                  </button>
                ))}
                {availableBarProducts.length === 0 && (
                  <span className="empty-products">
                    No hay productos disponibles para ese filtro.
                  </span>
                )}
              </div>
              <div className="waiter-cart">
                {Object.keys(barCart).length > 0 ? (
                  Object.entries(barCart).map(([productId, quantity]) => {
                    const product = products.find(
                      (item) => item.id === Number(productId),
                    );
                    return product ? (
                      <div className="cart-line" key={product.id}>
                        <span>
                          {quantity}x {product.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFromBarCart(product)}
                        >
                          −
                        </button>
                      </div>
                    ) : null;
                  })
                ) : (
                  <span>
                    Selecciona productos para atender a tu cliente en la barra.
                  </span>
                )}
              </div>
              <div className="bar-sale-footer">
                <span>Total a cobrar</span>
                <strong>{money(barCartTotal)}</strong>
              </div>
              <button
                className="primary-button"
                type="submit"
                disabled={Object.keys(barCart).length === 0}
              >
                Registrar venta <span>→</span>
              </button>
            </form>
          </section>
        )}
        {/* Shift summary and print-ready closeout report. */}
        {activeView === "Cierre de turno" && (
          <section className="view-section close-view">
            <div className="close-hero">
              <div>
                <span className="section-kicker">CIERRE DE OPERACIÓN</span>
                <h2>
                  {activeTurn.endedAt === null
                    ? "Turno en curso"
                    : "Turno finalizado"}
                </h2>
                <p>
                  El contador sigue activo aunque los usuarios salgan de la
                  aplicación.
                </p>
              </div>
              <div className="turn-clock">
                <span>
                  {activeTurn.endedAt === null
                    ? "Tiempo transcurrido"
                    : "Duración del turno"}
                </span>
                <strong>{formatDuration(turnDuration)}</strong>
                {activeTurn.endedAt === null ? (
                  <button className="primary-button" onClick={finishTurn}>
                    Terminar turno
                  </button>
                ) : (
                  <button className="primary-button" onClick={startTurn}>
                    Iniciar turno
                  </button>
                )}
              </div>
            </div>
            <div className="close-grid">
              <div className="close-summary">
                <span>Ventas registradas</span>
                <strong>{sales.length}</strong>
                <small>movimientos de este turno</small>
              </div>
              <div className="close-summary">
                <span>Total vendido</span>
                <strong>{money(totalSales)}</strong>
                <small>ingresos brutos</small>
              </div>
              <div className="close-summary">
                <span>Unidades despachadas</span>
                <strong>
                  {sales.reduce((total, sale) => total + sale.quantity, 0)}
                </strong>
                <small>productos vendidos</small>
              </div>
              <div className="close-summary">
                <span>Incidencias registradas del turno</span>
                <strong>{money(incidentsLoss)}</strong>
                <small>{turnIncidents.length} incidentes registrados</small>
              </div>
              <div className="close-summary">
                <span>Resultado neto</span>
                <strong>{money(netResult)}</strong>
                <small>ventas menos incidencias</small>
              </div>
            </div>
            <div className="pdf-box">
              <div>
                <span className="pdf-icon">PDF</span>
                <div>
                  <strong>Reporte de inventario y ventas</strong>
                  <small>
                    Incluye existencias actuales, productos vendidos,
                    solicitudes despachadas e incidentes con su valor.
                  </small>
                </div>
              </div>
              <button className="primary-button" onClick={() => window.print()}>
                Cerrar y generar PDF <span>↗</span>
              </button>
            </div>
          </section>
        )}
        {toast && <div className="toast">✓ {toast}</div>}
      </main>
    </div>
  );
}

export default App;
