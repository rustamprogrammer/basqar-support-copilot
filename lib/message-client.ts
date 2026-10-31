// The first POST establishes an HttpOnly visitor cookie without inserting a row.
// Repeat only that explicit handshake; a network failure keeps the same draft UUID for manual retry.
export async function postMessage(body: object): Promise<Response> {
  const send = () => fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const first = await send();
  if (first.status === 409) {
    const data = await first.clone().json().catch(() => null) as { code?: string } | null;
    if (data?.code === 'session_required') return send();
  }
  return first;
}
