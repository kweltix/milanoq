<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

function accept_verified_entry(int $entryId): void
{
    $pdo = db();
    $entry = query_one('SELECT e.id, e.campaign_id, e.receipt_id, e.status, c.status AS campaign_status FROM entries e JOIN campaigns c ON c.id = e.campaign_id WHERE e.id = ? FOR UPDATE', [$entryId]);
    if (!$entry || $entry['status'] !== 'pending' || $entry['campaign_status'] !== 'open') throw new RuntimeException('Entry cannot be accepted');
    run_sql("UPDATE receipts SET verification_status = 'accepted' WHERE id = ?", [$entry['receipt_id']]);
    run_sql("UPDATE entries SET status = 'accepted', accepted_at = UTC_TIMESTAMP() WHERE id = ?", [$entryId]);
    run_sql('INSERT INTO tickets (public_id, campaign_id, entry_id, ordinal) VALUES (?, ?, ?, 1)', [random_id(), $entry['campaign_id'], $entryId]);
}

function status_rows(int $userId): array
{
    $now = new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
    $rows = account_campaign_entries(db(), $userId, (int)$now->format('Y'), (int)ceil((int)$now->format('n') / 3));
    $rejected = array_filter($rows, fn($row) => $row['status'] === 'rejected');
    if (!$rejected) return $rows;
    // Журнал уже хранит причины. Получаем только события заявок этого пользователя,
    // не раскрывая ему остальные поля журнала и не изменяя схему рабочей БД.
    $conditions = []; $args = [];
    foreach ($rejected as $row) { $conditions[] = 'details_json LIKE ?'; $args[] = '%"entry":"' . $row['id'] . '"%'; }
    $stmt = db()->prepare("SELECT details_json FROM admin_audit_log WHERE action='receipt.reject' AND entity_type='campaign' AND (" . implode(' OR ', $conditions) . ') ORDER BY id DESC LIMIT 100');
    $stmt->execute($args); $reasons = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $event) {
        $details = json_decode($event['details_json'], true);
        if (is_array($details) && is_string($details['entry'] ?? null) && is_string($details['reason'] ?? null)) $reasons[$details['entry']] ??= $details['reason'];
    }
    foreach ($rows as &$row) if ($row['status'] === 'rejected') $row['rejection_reason'] = $reasons[$row['id']] ?? null;
    unset($row); return $rows;
}

function account_ticket_counts(int $userId): array
{
    $now = new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
    return account_campaign_ticket_counts(db(), $userId, (int)$now->format('Y'), (int)ceil((int)$now->format('n') / 3));
}

function account_campaign_ticket_counts(PDO $pdo, int $userId, int $year, int $quarter): array
{
    $stmt = $pdo->prepare("SELECT c.public_id,COUNT(DISTINCT t.id) AS ticket_count FROM tickets t JOIN entries e ON e.id=t.entry_id AND e.campaign_id=t.campaign_id JOIN campaign_participants p ON p.id=e.participant_id AND p.campaign_id=e.campaign_id JOIN campaigns c ON c.id=e.campaign_id WHERE p.user_id=? AND c.year=? AND c.quarter=? AND c.status IN ('open','closed') GROUP BY c.public_id");
    $stmt->execute([$userId,$year,$quarter]);
    $counts = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) $counts[$row['public_id']] = (int)$row['ticket_count'];
    return $counts;
}

function account_campaign_entries(PDO $pdo, int $userId, int $year, int $quarter): array
{
    // Limit receipts before loading their tickets: one receipt can issue many
    // tickets, and historical winner cancellations must not multiply it.
    $stmt = $pdo->prepare("SELECT e.id AS entry_db_id,e.public_id AS id,e.status,e.submitted_at,r.verification_status AS receipt_status,c.public_id AS campaign_id,c.title AS campaign_title,c.status AS campaign_status,CASE WHEN COALESCE((SELECT SUM(quantity) FROM prizes WHERE campaign_id=c.id),0)>0 AND (SELECT COUNT(*) FROM winners wx JOIN prizes px ON px.id=wx.prize_id WHERE px.campaign_id=c.id AND wx.status='active')=(SELECT SUM(quantity) FROM prizes WHERE campaign_id=c.id) THEN 1 ELSE 0 END AS results_ready FROM entries e JOIN campaign_participants p ON p.id=e.participant_id AND p.campaign_id=e.campaign_id JOIN receipts r ON r.id=e.receipt_id JOIN campaigns c ON c.id=e.campaign_id WHERE p.user_id=? AND c.year=? AND c.quarter=? AND c.status IN ('open','closed') ORDER BY e.id DESC LIMIT 100");
    $stmt->execute([$userId,$year,$quarter]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$rows) return [];
    $ids = []; $indexes = [];
    foreach ($rows as $index => &$row) {
        $id = (int)$row['entry_db_id']; $ids[] = $id; $indexes[$id] = $index;
        unset($row['entry_db_id']);
        // Existing upload/status consumers retain their first-ticket fields.
        $row += ['ticket_id'=>null,'winner_prize'=>null,'won_at'=>null,'tickets'=>[]];
    }
    unset($row);
    $placeholders = implode(',',array_fill(0,count($ids),'?'));
    $tickets = $pdo->prepare("SELECT t.id AS ticket_db_id,t.entry_id,t.public_id AS id,t.eligible,t.ordinal,t.issued_at,pr.title AS winner_prize,w.assigned_at AS won_at FROM tickets t JOIN entries e ON e.id=t.entry_id AND e.campaign_id=t.campaign_id LEFT JOIN winners w ON w.ticket_id=t.id AND w.status='active' LEFT JOIN prizes pr ON pr.id=w.prize_id AND pr.campaign_id=t.campaign_id WHERE t.entry_id IN ($placeholders) ORDER BY t.entry_id,t.ordinal,t.id,w.id");
    $tickets->execute($ids);
    $seen = [];
    while ($ticket = $tickets->fetch(PDO::FETCH_ASSOC)) {
        if (isset($seen[$ticket['ticket_db_id']])) continue;
        $seen[$ticket['ticket_db_id']] = true;
        $index = $indexes[(int)$ticket['entry_id']];
        unset($ticket['ticket_db_id'],$ticket['entry_id']);
        $ticket['eligible'] = (int)$ticket['eligible']; $ticket['ordinal'] = (int)$ticket['ordinal'];
        $rows[$index]['tickets'][] = $ticket;
        $rows[$index]['ticket_id'] ??= $ticket['id'];
        if ($rows[$index]['winner_prize'] === null && $ticket['winner_prize'] !== null) {
            $rows[$index]['winner_prize'] = $ticket['winner_prize'];
            $rows[$index]['won_at'] = $ticket['won_at'];
        }
    }
    return $rows;
}
