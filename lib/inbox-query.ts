import type { Message, MessageRoute } from './message-types.ts';

export type InboxCategory = MessageRoute | 'all' | 'undetermined';
export type InboxOptions = {
  category: InboxCategory; workflow: 'all' | 'pending' | 'answered' | 'accepted';
  urgency: 'all' | 'now' | 'high' | 'normal'; q: string; page: number; pageSize: number;
};
export type InboxResponse = {
  items: Message[]; counts: Record<InboxCategory, number>; total: number;
  allCount: number; page: number; pageSize: number; pageCount: number;
};
const choice = <T extends string>(value: string | null, choices: readonly T[], fallback: T): T => choices.includes(value as T) ? value as T : fallback;
const positive = (value: string | null, fallback: number, maximum: number) => {
  const number = Number(value);
  return value !== null && Number.isFinite(number) ? Math.max(1, Math.min(maximum, Math.floor(number))) : fallback;
};
export const searchText = (params: URLSearchParams) => (params.get('q') ?? '').trim().slice(0, 200);
export const selectorLimit = (params: URLSearchParams) => positive(params.get('limit'), 100, 100);
export function parseInboxOptions(params: URLSearchParams): InboxOptions {
  return {
    category: choice(params.get('category'), ['all', 'question', 'help', 'undetermined', 'violation', 'trash'], 'all'),
    workflow: choice(params.get('workflow'), ['all', 'pending', 'answered', 'accepted'], 'pending'),
    urgency: choice(params.get('urgency'), ['all', 'now', 'high', 'normal'], 'all'),
    q: searchText(params), page: positive(params.get('page'), 1, 1_000_000), pageSize: positive(params.get('pageSize'), 20, 50),
  };
}

// Workerd limits LIKE/GLOB pattern complexity. Literal INSTR avoids patterns;
// LOWER handles ASCII and a bounded iterative fold handles queried Unicode
// letters. Its SQL expression depth stays constant even for a long query.
export function searchFoldMap(text: string) {
  const pairs = new Map<string, string>();
  for (const char of text) {
    const upper = char.toUpperCase(), lower = char.toLowerCase();
    if (upper !== lower && upper.length === 1 && upper.charCodeAt(0) > 127) pairs.set(upper, lower);
  }
  return JSON.stringify([...pairs]);
}
const searchFoldCte = `search_fold(id, step, text_fold, original_fold) AS (
  SELECT id, 0, LOWER(text), LOWER(COALESCE(original_text, '')) FROM search_source
  UNION ALL
  SELECT f.id, f.step + 1,
    REPLACE(f.text_fold, json_extract(o.fold_map, '$[' || f.step || '][0]'), json_extract(o.fold_map, '$[' || f.step || '][1]')),
    REPLACE(f.original_fold, json_extract(o.fold_map, '$[' || f.step || '][0]'), json_extract(o.fold_map, '$[' || f.step || '][1]'))
  FROM search_fold f CROSS JOIN options o WHERE f.step < json_array_length(o.fold_map)
)`;
const searchMatch = `f.step = json_array_length(o.fold_map) AND (o.pattern = '' OR INSTR(f.text_fold, o.pattern) > 0 OR INSTR(f.original_fold, o.pattern) > 0 OR INSTR(LOWER(f.id), o.pattern) > 0)`;

// Mirrors messageRoute, including legacy records and manual restoration of a
// rejected message. Explicit route:null must not fall back to classification.
const storedRoute = `CASE WHEN json_type(m.processing, '$.route') IS NOT NULL THEN json_extract(m.processing, '$.route')
  WHEN json_extract(m.processing, '$.classification') = 'report' THEN CASE WHEN json_extract(m.processing, '$.topic') = 'Вопрос по игре' THEN 'question' ELSE 'help' END
  WHEN json_extract(m.processing, '$.classification') IN ('violation', 'trash') THEN json_extract(m.processing, '$.classification') ELSE NULL END`;
export const messageRouteSql = `CASE WHEN m.status IN ('violation', 'trash') THEN m.status
  WHEN (${storedRoute}) IN ('violation', 'trash') THEN NULL ELSE (${storedRoute}) END`;
const workflowMatch = `(o.workflow = 'all' OR (o.workflow = 'pending' AND l.status = 'pending' AND l.state IN ('queued', 'in_progress')) OR (o.workflow = 'answered' AND l.state = 'answered') OR (o.workflow = 'accepted' AND l.state = 'resolved'))`;
const order = (alias = '') => `${alias}sort_rank ASC, ${alias}sort_time ASC, CASE WHEN (SELECT category FROM options) = 'help' THEN ${alias}id END ASC, ${alias}id DESC`;

export function inboxStatement(options: InboxOptions, now = Date.now()) {
  return {
    sql: `WITH RECURSIVE options(category, workflow, urgency, pattern, requested_page, page_size, now, fold_map) AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?)),
    ranked AS (
      SELECT m.id, m.status, m.created_at, ${messageRouteSql} AS route,
        COALESCE(json_extract(m.service, '$.state'), CASE WHEN m.status = 'accepted' THEN 'resolved' ELSE 'queued' END) AS state,
        COALESCE(json_extract(m.service, '$.manualUrgency'), json_extract(m.processing, '$.urgency.level'), 'normal') AS urgency,
        COALESCE(json_extract(m.service, '$.firstReceivedAt'), m.created_at) AS first_received,
        ROW_NUMBER() OVER (PARTITION BY CASE WHEN m.status IN ('trash', 'violation') THEN m.id ELSE COALESCE(json_extract(m.service, '$.caseId'), m.id) END ORDER BY m.created_at DESC, m.id DESC) AS position
      FROM messages m
    ), latest AS (SELECT * FROM ranked WHERE position = 1),
    search_source AS (SELECT m.id, m.text, m.original_text FROM latest l JOIN messages m ON m.id = l.id),
    ${searchFoldCte},
    searched AS (
      SELECT l.* FROM latest l JOIN search_fold f ON f.id = l.id CROSS JOIN options o
      WHERE ${searchMatch}
    ), selected AS (
      SELECT l.*,
        CASE WHEN o.category <> 'help' THEN 0 WHEN l.urgency = 'now' THEN 0 WHEN l.urgency = 'high' THEN 1
          WHEN l.state IN ('queued', 'in_progress') AND o.now - l.first_received > 900000 THEN 1 ELSE 2 END AS sort_rank,
        CASE WHEN o.category = 'help' THEN l.first_received ELSE -l.created_at END AS sort_time
      FROM searched l CROSS JOIN options o
      WHERE ${workflowMatch}
        AND (o.category = 'all' OR (o.category = 'undetermined' AND l.route IS NULL) OR l.route = o.category)
        AND (o.category <> 'help' OR o.urgency = 'all' OR l.urgency = o.urgency)
    ), summary AS (
      SELECT COUNT(*) FILTER (WHERE ${workflowMatch}) AS count_all,
        COUNT(*) FILTER (WHERE ${workflowMatch} AND l.route = 'question') AS count_question,
        COUNT(*) FILTER (WHERE ${workflowMatch} AND l.route = 'help') AS count_help,
        COUNT(*) FILTER (WHERE ${workflowMatch} AND l.route IS NULL) AS count_undetermined,
        COUNT(*) FILTER (WHERE l.route = 'violation') AS count_violation,
        COUNT(*) FILTER (WHERE l.route = 'trash') AS count_trash,
        (SELECT COUNT(*) FROM selected) AS total, (SELECT COUNT(*) FROM messages) AS all_count
      FROM searched l CROSS JOIN options o
    ), paging AS (
      SELECT s.*, o.page_size, MAX(1, CAST((s.total + o.page_size - 1) / o.page_size AS INTEGER)) AS page_count,
        MIN(o.requested_page, MAX(1, CAST((s.total + o.page_size - 1) / o.page_size AS INTEGER))) AS page
      FROM summary s CROSS JOIN options o
    ), page_items AS (
      SELECT * FROM selected ORDER BY ${order()}
      LIMIT (SELECT page_size FROM paging) OFFSET (SELECT (page - 1) * page_size FROM paging)
    )
    SELECT paging.*, (
      SELECT json_group_array(json(payload)) FROM (
        SELECT json_object('id', m.id, 'text', m.text, 'originalText', m.original_text, 'status', m.status,
          'createdAt', m.created_at, 'processing', json(m.processing), 'service', json(m.service),
          'feedback', CASE WHEN f.message_id IS NULL THEN NULL ELSE json_object(
            'messageId', f.message_id, 'label', f.label, 'routingSchema', f.routing_schema,
            'needsClarification', CASE WHEN f.needs_clarification IS NULL THEN NULL ELSE json(CASE WHEN f.needs_clarification THEN 'true' ELSE 'false' END) END,
            'correctedText', f.corrected_text, 'note', f.note, 'updatedAt', f.updated_at) END) AS payload,
          p.id, p.sort_rank, p.sort_time
        FROM page_items p JOIN messages m ON m.id = p.id LEFT JOIN message_feedback f ON f.message_id = m.id
        ORDER BY ${order('p.')}
      )
    ) AS items_json FROM paging`,
    params: [options.category, options.workflow, options.urgency, options.q.toLowerCase(), options.page, options.pageSize, now, searchFoldMap(options.q)],
  };
}

export type InboxSqlRow = {
  items_json: string; count_all: number; count_question: number; count_help: number;
  count_undetermined: number; count_violation: number; count_trash: number;
  total: number; all_count: number; page: number; page_size: number; page_count: number;
};
export function inboxResponse(row: InboxSqlRow): InboxResponse {
  return { items: JSON.parse(row.items_json), counts: { all: row.count_all, question: row.count_question, help: row.count_help,
    undetermined: row.count_undetermined, violation: row.count_violation, trash: row.count_trash }, total: row.total,
    allCount: row.all_count, page: row.page, pageSize: row.page_size, pageCount: row.page_count };
}

export function selectorStatement(params: URLSearchParams, ownerHash: string | null) {
  const q = searchText(params), conditions = ['m.processing IS NOT NULL'];
  const values: (string | number)[] = [q.toLowerCase(), searchFoldMap(q)];
  if (ownerHash !== null) { conditions.push('m.owner_hash = ?'); values.push(ownerHash); }
  return { sql: `WITH RECURSIVE options(pattern, fold_map) AS (VALUES (?, ?)),
    search_source AS (SELECT m.id, m.text, m.original_text FROM messages m WHERE ${conditions.join(' AND ')}),
    ${searchFoldCte}
    SELECT m.id, m.text, m.original_text AS originalText, m.created_at AS createdAt,
    json_object('route', ${messageRouteSql}, 'context', json_extract(m.processing, '$.context')) AS processing
    FROM messages m JOIN search_fold f ON f.id = m.id CROSS JOIN options o WHERE ${searchMatch}
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`, params: [...values, selectorLimit(params)] };
}
