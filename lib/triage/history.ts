export type HistoryRecord = { id: string; ticketId: string; reporter: string; signature: string; eventAt: number; storedAt: number };

export function historyStatements(record: HistoryRecord) {
  return [
    { sql: 'DELETE FROM triage_history WHERE stored_at < ?', params: [record.storedAt - 86400000] },
    { sql: 'INSERT OR IGNORE INTO triage_history(id, ticket_id, reporter, signature, event_at, stored_at) VALUES (?, ?, ?, ?, ?, ?)',
      params: [record.id, record.ticketId, record.reporter, record.signature, record.eventAt, record.storedAt] },
    // The table has a TEXT primary key and an implicit SQLite rowid. Insertion
    // order is stable even when concurrent requests share a millisecond and IDs
    // sort in reverse. A retry uses its original row and cannot duplicate itself
    // or become a duplicate of a later accepted request.
    { sql: `SELECT prior.ticket_id FROM triage_history current JOIN triage_history prior
        ON prior.reporter = current.reporter AND prior.signature = current.signature
      WHERE current.id = ? AND prior.ticket_id <> current.ticket_id AND prior.rowid < current.rowid
        AND prior.event_at BETWEEN current.event_at - 3600000 AND current.event_at
      ORDER BY prior.event_at, prior.rowid LIMIT 1`, params: [record.id] },
  ];
}

export async function recordTriageHistory(db: Pick<D1Database, 'prepare' | 'batch'>, record: HistoryRecord): Promise<string | undefined> {
  // D1 executes batch statements in one transaction. Concurrent submissions
  // cannot both check an empty history before either insertion commits.
  const results = await db.batch<{ ticket_id: string }>(historyStatements(record).map(statement => db.prepare(statement.sql).bind(...statement.params)));
  return results[2].results[0]?.ticket_id;
}
