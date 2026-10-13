export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Accept', 'application/json')

  let response: Response
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
    })
  } catch (error) {
    console.error(`Unable to reach the Kanban Studio API at ${path}.`, error)
    throw new ApiError('The server could not be reached. Check that the API and database are running.', 0)
  }

  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: string } | null
    throw new ApiError(result?.error || `Request failed (${response.status}).`, response.status)
  }
  if (response.status === 204) return undefined as T
  return await response.json() as T
}
