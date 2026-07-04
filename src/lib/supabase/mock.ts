import type { SupabaseClient, User } from '@supabase/supabase-js'

const DEMO_EMAIL = 'demo@localhost'

export const DEMO_USER = {
  id: 'local-demo-user',
  email: DEMO_EMAIL,
} as User

export const DEMO_ACCOUNT = {
  id: 'local-demo-account',
  name: 'Local Demo Workspace',
  default_currency: 'USD',
}

export const DEMO_PROFILE = {
  id: 'local-demo-profile',
  user_id: DEMO_USER.id,
  full_name: 'Local Demo',
  email: DEMO_EMAIL,
  avatar_url: null,
  role: 'owner',
  beta_features: [],
  account_id: DEMO_ACCOUNT.id,
  account_role: 'owner',
  created_at: '2026-07-02T00:00:00.000Z',
}

type QueryResult = { data: unknown; error: null; count?: null }

let flowCounter = 1
let apiKeyCounter = 1

const mockDb = {
  flows: [] as Array<Record<string, unknown>>,
  api_keys: [] as Array<Record<string, unknown>>,
}

class MockQueryBuilder implements PromiseLike<QueryResult> {
  private mode: 'many' | 'single' = 'many'
  private eqFilters = new Map<string, unknown>()
  private insertedRows: Array<Record<string, unknown>> | null = null

  constructor(private readonly table: string) {}

  select() {
    return this
  }

  insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.insertedRows = Array.isArray(payload) ? payload : [payload]
    return this
  }

  update() {
    return this
  }

  upsert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.insertedRows = Array.isArray(payload) ? payload : [payload]
    return this
  }

  delete() {
    return this
  }

  eq(column: string, value: unknown) {
    this.eqFilters.set(column, value)
    return this
  }

  neq() {
    return this
  }

  gt() {
    return this
  }

  gte() {
    return this
  }

  lt() {
    return this
  }

  lte() {
    return this
  }

  like() {
    return this
  }

  ilike() {
    return this
  }

  in() {
    return this
  }

  is() {
    return this
  }

  not() {
    return this
  }

  or() {
    return this
  }

  match() {
    return this
  }

  order() {
    return this
  }

  limit() {
    return this
  }

  range() {
    return this
  }

  overlaps() {
    return this
  }

  contains() {
    return this
  }

  abortSignal() {
    return this
  }

  maybeSingle() {
    this.mode = 'single'
    return this
  }

  single() {
    this.mode = 'single'
    return this
  }

  returns() {
    return this
  }

  csv() {
    return this
  }

  private buildRows() {
    if (this.insertedRows) {
      if (this.table === 'flows') {
        const rows = this.insertedRows.map((row) => ({
          id: `flow-${flowCounter++}`,
          name: 'Untitled flow',
          description: null,
          status: 'draft',
          trigger_type: 'keyword',
          trigger_config: {},
          execution_count: 0,
          last_executed_at: null,
          created_at: '2026-07-02T00:00:00.000Z',
          updated_at: '2026-07-02T00:00:00.000Z',
          ...row,
        }))
        mockDb.flows.push(...rows)
        return rows
      }

      if (this.table === 'api_keys') {
        const rows = this.insertedRows.map((row) => ({
          id: `key-${apiKeyCounter++}`,
          key_prefix: 'demo',
          scopes: [],
          last_used_at: null,
          expires_at: null,
          revoked_at: null,
          created_at: '2026-07-02T00:00:00.000Z',
          ...row,
        }))
        mockDb.api_keys.push(...rows)
        return rows
      }

      return this.insertedRows
    }

    if (this.table === 'profiles') {
      if (this.eqFilters.get('user_id') === DEMO_USER.id) return [DEMO_PROFILE]
      if (this.eqFilters.get('account_id') === DEMO_ACCOUNT.id) return [DEMO_PROFILE]
      return [DEMO_PROFILE]
    }

    if (this.table === 'accounts') {
      if (this.eqFilters.get('id') === DEMO_ACCOUNT.id) return [DEMO_ACCOUNT]
      return [DEMO_ACCOUNT]
    }

    if (this.table === 'flows') {
      return [...mockDb.flows]
    }

    if (this.table === 'api_keys') {
      return [...mockDb.api_keys]
    }

    if (this.table === 'flow_nodes') {
      return []
    }

    return []
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const rows = this.buildRows()
    const result: QueryResult =
      this.mode === 'single'
        ? { data: rows[0] ?? null, error: null }
        : { data: rows, error: null, count: null }

    return Promise.resolve(result).then(onfulfilled, onrejected)
  }
}

export function createMockSupabaseClient() {
  const auth = {
    getSession: async () => ({
      data: {
        session: {
          access_token: 'demo-access-token',
          token_type: 'bearer',
          user: DEMO_USER,
        },
      },
      error: null,
    }),
    getUser: async () => ({
      data: { user: DEMO_USER },
      error: null,
    }),
    onAuthStateChange: () => ({
      data: {
        subscription: {
          unsubscribe() {},
        },
      },
    }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ data: { user: DEMO_USER, session: null }, error: null }),
    signUp: async () => ({ data: { user: DEMO_USER, session: null }, error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user: DEMO_USER }, error: null }),
  }

  const storageBucket = {
    upload: async () => ({ data: null, error: null }),
    remove: async () => ({ data: null, error: null }),
    list: async () => ({ data: [], error: null }),
    getPublicUrl: () => ({ data: { publicUrl: '' } }),
    createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
  }

  return {
    auth,
    from: (table: string) => new MockQueryBuilder(table),
    rpc: async () => ({ data: null, error: null }),
    channel: () => ({
      on() {
        return this
      },
      subscribe(callback?: (status: string) => void) {
        callback?.('SUBSCRIBED')
        return this
      },
      unsubscribe() {},
    }),
    removeChannel: async () => ({ error: null }),
    removeAllChannels: async () => [],
    storage: {
      from: () => storageBucket,
    },
  } as unknown as SupabaseClient
}
