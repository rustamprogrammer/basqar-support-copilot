import type { Message } from './message-types.ts';

type CaseSnapshot = Pick<Message, 'id' | 'status' | 'service'>;
export type CaseStatement = { sql: string; params: (string | null)[] };
const terminal = (row: CaseSnapshot) => row.status === 'trash' || row.status === 'violation';

export function latestCaseStatement(row: CaseSnapshot): CaseStatement {
  // Rejected cards are separate queue items, including rejected clarifications.
  if (terminal(row)) return { sql: 'SELECT ? AS id', params: [row.id] };
  const caseId = row.service?.caseId ?? row.id;
  return { sql: "SELECT id FROM messages WHERE (id = ? OR json_extract(service, '$.caseId') = ?) AND status NOT IN ('trash', 'violation') ORDER BY created_at DESC, id DESC LIMIT 1", params: [caseId, caseId] };
}

// Used inside the mutation statement, not just as an earlier read. An admin
// update and a clarification must not both commit from the same old snapshot.
export function caseSnapshotGuard(row: CaseSnapshot): CaseStatement {
  const latest = latestCaseStatement(row);
  return {
    sql: `EXISTS (SELECT 1 FROM messages AS current_case WHERE current_case.id = ? AND current_case.status = ? AND current_case.service IS ?${terminal(row) ? '' : ` AND current_case.id = (${latest.sql})`})`,
    params: [row.id, row.status, row.service ? JSON.stringify(row.service) : null, ...(terminal(row) ? [] : latest.params)],
  };
}
