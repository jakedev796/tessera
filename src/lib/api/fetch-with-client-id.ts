import { getClientId } from '@/lib/ws/client-id';

export async function fetchWithClientId(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has('x-tessera-client-id')) {
    headers.set('x-tessera-client-id', getClientId());
  }
  return fetch(input, { ...init, headers });
}
