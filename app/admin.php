<?php
declare(strict_types=1);

function admin_rows(string $sql, array $values = []): array
{
    $s = db()->prepare($sql);
    $s->execute($values);
    return $s->fetchAll();
}

function admin_audit(int $actor, string $action, string $type, int $id, array $details): void
{
    $cid=$details['campaign_id']??($type==='campaign'?$id:null);
    if($cid){$identity=query_one('SELECT public_id FROM campaigns WHERE id=?',[$cid]);if($identity)$details['campaign_public_id']=$identity['public_id'];}
    if($type==='campaign'&&!isset($details['campaign_public_id'])&&isset($details['public_id']))$details['campaign_public_id']=$details['public_id'];
    run_sql('INSERT INTO admin_audit_log (actor_user_id, action, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?)',
        [$actor, $action, $type, $id, json_encode($details, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)]);
}

function admin_routes(string $method, string $path): void
{
    if (!str_starts_with($path, '/admin/')) return;
    $admin = need_admin();
    $page = max(1, min(100000, (int) ($_GET['page'] ?? 1)));
    $offset = ($page - 1) * 25;
    if($method==='GET'&&$path==='/admin/ticket-lookup'){
        $ticket=mb_strtolower(trim((string)($_GET['ticket']??'')));if(!preg_match('/^[a-f0-9]{32}$/',$ticket))fail(422,'invalid_ticket');
        $row=query_one('SELECT t.public_id AS ticket,c.public_id AS campaign_id,c.title AS campaign_title,u.public_id AS user_id,u.name,u.email,u.phone,u.email_verified_at,e.public_id AS entry_id,e.status FROM tickets t JOIN campaigns c ON c.id=t.campaign_id JOIN entries e ON e.id=t.entry_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id WHERE t.public_id=?',[$ticket]);
        if(!$row)fail(404,'ticket_not_found');json_out(200,['data'=>$row]);
    }
    if ($method === 'GET' && $path === '/admin/campaigns') {
        $where=[];$args=[];$q=mb_substr(trim((string)($_GET['q']??'')),0,120);$status=(string)($_GET['status']??'');
        if($q!==''){$where[]="c.title LIKE ? ESCAPE '!'";$args[]='%'.str_replace(['!','%','_'],['!!','!%','!_'],$q).'%';}
        if($status!==''){if(!in_array($status,['draft','scheduled','open','closed'],true))fail(422,'invalid_filters');$where[]='c.status=?';$args[]=$status;}
        $filter=$where?' WHERE '.implode(' AND ',$where):'';
        json_out(200, ['data' => admin_rows("SELECT c.public_id AS id,c.title,c.year,c.quarter,c.status,c.starts_at,c.ends_at,c.rules_version,(SELECT COUNT(*) FROM campaign_participants cp WHERE cp.campaign_id=c.id) AS participants,(SELECT COUNT(*) FROM entries e WHERE e.campaign_id=c.id) AS receipts,(SELECT COUNT(*) FROM tickets t WHERE t.campaign_id=c.id) AS tickets,(SELECT COUNT(*) FROM entries e WHERE e.campaign_id=c.id AND e.status='pending') AS pending FROM campaigns c $filter ORDER BY c.year DESC,c.quarter DESC LIMIT 26 OFFSET $offset",$args), 'page' => $page]);
    }
    if ($method === 'GET' && $path === '/admin/audit') {
        $filter='';$args=[];
        if(isset($_GET['campaign'])){
            $c=query_one('SELECT * FROM campaigns WHERE public_id=?',[(string)$_GET['campaign']]);if(!$c)fail(404,'campaign_unavailable');
            json_out(200,['data'=>workspace_audit($c),'page'=>$page]);
            // The installed MySQL lacks JSON functions; match complete keys/values,
            // not ID substrings (campaign 1 must not include campaign 10).
            $filter=" WHERE (a.entity_type='campaign' AND a.entity_id=?) OR a.details_json REGEXP ?";
            $pattern='"campaign_id"[[:space:]]*:[[:space:]]*"?'.(int)$c['id'].'"?[[:space:]]*[,}]|"campaign"[[:space:]]*:[[:space:]]*"'.$c['public_id'].'"';
            $args=[$c['id'],$pattern];
        }
        json_out(200, ['data' => admin_rows("SELECT a.id,a.action,a.entity_type,a.entity_id,a.details_json,a.created_at,u.name AS actor FROM admin_audit_log a JOIN users u ON u.id=a.actor_user_id $filter ORDER BY a.id DESC LIMIT 26 OFFSET $offset",$args), 'page' => $page]);
    }
    if (!preg_match('~^/admin/campaigns/([a-f0-9]{32})(?:/(prizes|participants|winners|open|close))?(?:/([0-9]+))?$~', $path, $m)) return;
    $part = $m[2] ?? '';
    // Numeric resource IDs belong only to prizes. Never route /winners/0
    // (or another alias) into an obsolete assignment implementation.
    if (isset($m[3]) && $part !== 'prizes') fail(404, 'not_found');
    $item = (int) ($m[3] ?? 0);
    $write = $method !== 'GET';
    if ($write) db()->beginTransaction();
    $campaign = query_one('SELECT * FROM campaigns WHERE public_id=?' . ($write ? ' FOR UPDATE' : ''), [$m[1]]);
    if (!$campaign) fail(404, 'campaign_unavailable');
    $cid = (int) $campaign['id'];
    if ($method === 'GET' && $part === '') {
        $counts = query_one('SELECT (SELECT COUNT(*) FROM campaign_participants WHERE campaign_id=?) AS participants,(SELECT COUNT(*) FROM tickets WHERE campaign_id=?) AS tickets', [$cid, $cid]);
        json_out(200, ['data' => ['campaign' => $campaign, 'counts' => $counts,
            'prizes' => admin_rows('SELECT * FROM prizes WHERE campaign_id=? ORDER BY display_order,id', [$cid]),
            'winners' => admin_rows('SELECT w.id,w.prize_id,w.prize_slot,w.reason,w.assigned_at,p.title,t.public_id AS ticket,u.name FROM winners w JOIN prizes p ON p.id=w.prize_id JOIN tickets t ON t.id=w.ticket_id JOIN entries e ON e.id=t.entry_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id WHERE p.campaign_id=? ORDER BY w.id DESC', [$cid])]]);
    }
    if ($method === 'GET' && $part === 'participants') {
        $q = mb_substr(trim((string) ($_GET['q'] ?? '')), 0, 120);
        // Search is literal: user-supplied SQL wildcard characters are escaped.
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
        $rows = admin_rows("SELECT cp.id,u.name,u.email,u.phone,cp.joined_at FROM campaign_participants cp JOIN users u ON u.id=cp.user_id WHERE cp.campaign_id=? AND (u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!' OR u.phone LIKE ? ESCAPE '!') ORDER BY cp.id DESC LIMIT 26 OFFSET $offset", [$cid, $like, $like, $like]);
        foreach ($rows as &$row) {
            $row['entries'] = admin_rows('SELECT e.public_id AS id,e.status,t.public_id AS ticket,t.eligible FROM entries e LEFT JOIN tickets t ON t.entry_id=e.id WHERE e.participant_id=? ORDER BY e.id DESC LIMIT 100', [$row['id']]);
        }
        unset($row);
        json_out(200, ['data' => $rows, 'page' => $page]);
    }
    if ($method === 'POST' && in_array($part, ['open', 'close'], true) && !$item) {
        db()->rollBack();workspace_routes('POST','/admin/workspace/'.$m[1].($part==='open'?'/activate':'/close'));return;
        $target = $part === 'open' ? 'open' : 'closed';
        if ($campaign['status'] !== $target) {
            if ($campaign['status'] === 'closed' || ($part === 'open' && $campaign['status'] !== 'draft')) fail(409, 'invalid_transition');
            if ($part === 'open' && (!$campaign['rules_version'] || strtotime($campaign['starts_at'] . ' UTC') > time() || strtotime($campaign['ends_at'] . ' UTC') <= time())) fail(422, 'campaign_not_current');
            run_sql('UPDATE campaigns SET status=?,workspace_version=workspace_version+1 WHERE id=?', [$target, $cid]);
            admin_audit((int) $admin['id'], 'campaign.' . $part, 'campaign', $cid, ['from' => $campaign['status'], 'to' => $target]);
        }
        db()->commit();
        json_out(200, ['data' => ['status' => $target]]);
    }
    if ($part === 'prizes' && in_array($method, ['POST', 'PATCH', 'DELETE'], true)) {
        if ($campaign['status'] === 'closed') fail(409, 'campaign_closed');
        $before = $item ? query_one('SELECT * FROM prizes WHERE id=? AND campaign_id=?', [$item, $cid]) : null;
        if ($item && !$before) fail(404, 'not_found');
        if (($method === 'POST' && $item) || ($method !== 'POST' && !$item)) fail(404, 'not_found');
        if ($item && query_one('SELECT id FROM winners WHERE prize_id=? LIMIT 1', [$item])) fail(409, 'prize_awarded');
        if ($method === 'DELETE') {
            run_sql('DELETE FROM prizes WHERE id=?', [$item]);
            $details = ['before' => $before];
        } else {
            $input = body();
            $title = trim((string) ($input['title'] ?? ''));
            $quantity = filter_var($input['quantity'] ?? null, FILTER_VALIDATE_INT);
            if (mb_strlen($title) < 2 || mb_strlen($title) > 180 || !$quantity || $quantity < 1 || $quantity > 1000) fail(422, 'invalid_prize');
            if ($method === 'POST') {
                run_sql('INSERT INTO prizes (campaign_id,title,quantity) VALUES (?,?,?)', [$cid, $title, $quantity]);
                $item = (int) db()->lastInsertId();
            } else run_sql('UPDATE prizes SET title=?,quantity=? WHERE id=?', [$title, $quantity, $item]);
            $details = ['before' => $before, 'after' => ['title' => $title, 'quantity' => $quantity]];
        }
        admin_audit((int) $admin['id'], 'prize.' . ['POST' => 'create', 'PATCH' => 'update', 'DELETE' => 'delete'][$method], 'prize', $item, $details + ['campaign_id' => $cid]);
        db()->commit();
        json_out($method === 'POST' ? 201 : 200, ['data' => ['id' => $item]]);
    }
    if ($method === 'POST' && $part === 'winners' && !$item) {
        $input = body();
        $prize = filter_var($input['prize_id'] ?? null, FILTER_VALIDATE_INT);
        $slot = filter_var($input['prize_slot'] ?? null, FILTER_VALIDATE_INT);
        $ticket = (string) ($input['ticket'] ?? '');
        $reason = trim((string) ($input['reason'] ?? ''));
        $key = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '';
        if (!preg_match('/^[A-Za-z0-9_-]{16,100}$/', $key)) fail(422, 'invalid_idempotency_key');
        if (!$prize || !$slot || !preg_match('/^[a-f0-9]{32}$/', $ticket) || mb_strlen($reason) < 10 || mb_strlen($reason) > 500) fail(422, 'invalid_winner');
        if (($_SESSION['reauth_after'] ?? 0) > time()) fail(429, 'try_later');
        $credentials = query_one('SELECT password_hash FROM users WHERE id=?', [$admin['id']]);
        if (!password_verify((string) ($input['password'] ?? ''), $credentials['password_hash'])) {
            $_SESSION['reauth_after'] = time() + 5;
            fail(401, 'invalid_credentials');
        }
        $hash = hash('sha256', json_encode([$cid, $prize, $slot, $ticket, $reason]));
        $replay = query_one('SELECT body_hash,winner_id FROM admin_requests WHERE actor_user_id=? AND request_key=?', [$admin['id'], $key]);
        if ($replay) {
            if (!hash_equals($replay['body_hash'], $hash)) fail(409, 'idempotency_conflict');
            db()->commit();
            json_out(200, ['data' => ['id' => $replay['winner_id']]]);
        }
        if ($campaign['status'] !== 'closed') fail(409, 'close_campaign_first');
        $p = query_one('SELECT * FROM prizes WHERE id=? AND campaign_id=?', [$prize, $cid]);
        if (!$p || $slot < 1 || $slot > (int) $p['quantity']) fail(422, 'invalid_prize_slot');
        $t = query_one("SELECT t.id FROM tickets t JOIN entries e ON e.id=t.entry_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id WHERE t.public_id=? AND t.campaign_id=? AND t.eligible=1 AND e.status='accepted' AND u.status='active'", [$ticket, $cid]);
        if (!$t) fail(422, 'ineligible_ticket');
        if (query_one('SELECT id FROM winners WHERE prize_id=? AND prize_slot=?', [$prize, $slot])) fail(409, 'prize_slot_taken');
        // One ticket cannot receive multiple prizes; repeat-user policy remains a rules decision.
        if (query_one('SELECT id FROM winners WHERE ticket_id=?', [$t['id']])) fail(409, 'ticket_already_won');
        run_sql("INSERT INTO winners (prize_id,prize_slot,ticket_id,mode,assigned_by,reason) VALUES (?,?,?,'manual',?,?)", [$prize, $slot, $t['id'], $admin['id'], $reason]);
        $id = (int) db()->lastInsertId();
        run_sql('INSERT INTO admin_requests (actor_user_id,request_key,body_hash,winner_id) VALUES (?,?,?,?)', [$admin['id'], $key, $hash, $id]);
        admin_audit((int) $admin['id'], 'winner.manual', 'winner', $id, ['campaign_id' => $cid, 'rules_version' => $campaign['rules_version'], 'prize_id' => $prize, 'prize_slot' => $slot, 'ticket' => $ticket, 'reason' => $reason, 'mode' => 'manual']);
        db()->commit();
        json_out(201, ['data' => ['id' => $id]]);
    }
    if ($write && db()->inTransaction()) db()->rollBack();
    fail(404, 'not_found');
}
