import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import type { Message } from './message-types';
import { caseSnapshotGuard, latestCaseStatement } from './case-guard';
export async function latestCaseId(row: Message): Promise<string> {
  if (row.status === 'trash' || row.status === 'violation') return row.id;
  const statement = latestCaseStatement(row);
  const latest = await getDb().$client.prepare(statement.sql).bind(...statement.params).first<{ id: string }>();
  return latest?.id ?? row.id;
}

export function caseMutationGuard(row: Message) {
  const statement = caseSnapshotGuard(row);
  // SQL text is fixed by case-guard; every snapshot value remains a parameter.
  return sql.join(statement.sql.split('?').flatMap((part, index) => index < statement.params.length
    ? [sql.raw(part), sql`${statement.params[index]}`] : [sql.raw(part)]), sql.raw(''));
}
