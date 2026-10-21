<?php
declare(strict_types=1);

// Operational admin views reuse the existing model; no personal data is public.
function tools_filters(array $input): array
{
    $where = []; $args = [];
    $q = mb_substr(trim((string) ($input['q'] ?? '')), 0, 120);
    if ($q !== '') {
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $q) . '%';
        $where[] = "(u.name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!' OR u.phone LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM tickets st JOIN entries se ON se.id=st.entry_id WHERE se.participant_id=cp.id AND st.campaign_id=c.id AND st.public_id LIKE ? ESCAPE '!') OR EXISTS (SELECT 1 FROM entries se WHERE se.participant_id=cp.id AND se.campaign_id=c.id AND se.public_id LIKE ? ESCAPE '!'))";
        array_push($args, $like, $like, $like, $like, $like);
    }
    if (!empty($input['campaign'])) { $where[] = 'c.public_id=?'; $args[] = (string) $input['campaign']; }
    if (!empty($input['user'])) { $where[] = 'u.public_id=?'; $args[] = (string) $input['user']; }
    if (!empty($input['status'])) {
        if (!in_array($input['status'], ['pending','accepted','rejected'], true)) fail(422, 'invalid_filters');
        $where[] = 'e.status=?'; $args[] = $input['status'];
    }
    foreach (['from','to'] as $field) if (!empty($input[$field])) {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', (string) $input[$field], new DateTimeZone('Europe/Moscow'));
        if (!$date || $date->format('Y-m-d') !== $input[$field]) fail(422, 'invalid_filters');
        $where[] = 'e.submitted_at ' . ($field === 'from' ? '>= ?' : '< ?');
        $args[] = ($field === 'to' ? $date->modify('+1 day') : $date)->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }
    if (!empty($input['from']) && !empty($input['to']) && $input['from'] > $input['to']) fail(422, 'invalid_filters');
    return [$where ? ' WHERE ' . implode(' AND ', $where) : '', $args];
}

function tools_entry_sql(): string
{
    return 'SELECT e.public_id AS entry_id,e.status,e.submitted_at,r.public_id AS receipt_id,r.original_name,r.verification_status AS receipt_status,u.public_id AS user_id,u.name,u.email,u.phone,u.email_verified_at,c.public_id AS campaign_id,c.title AS campaign_title,t.public_id AS ticket,t.eligible,p.title AS prize,w.assigned_at AS won_at FROM entries e JOIN receipts r ON r.id=e.receipt_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id JOIN campaigns c ON c.id=e.campaign_id LEFT JOIN tickets t ON t.entry_id=e.id LEFT JOIN winners w ON w.ticket_id=t.id LEFT JOIN prizes p ON p.id=w.prize_id';
}

function tools_csv(array $rows, array $columns): string
{
    $stream = fopen('php://temp', 'r+');
    fputcsv($stream, array_values($columns), ';');
    foreach ($rows as $row) {
        $cells = [];
        foreach ($columns as $key => $label) {
            $value = (string) ($row[$key] ?? '');
            // Prevent spreadsheet formula execution, including leading controls/spaces.
            if (preg_match('/^[\s\x00-\x1f]*[=+@-]/u', $value) || preg_match('/^[\t\r\n]/', $value)) $value = "'" . $value;
            $cells[] = $value;
        }
        fputcsv($stream, $cells, ';');
    }
    rewind($stream); $csv = "\xEF\xBB\xBF" . stream_get_contents($stream); fclose($stream); return $csv;
}

function admin_tools_routes(string $method, string $path): void
{
    if (!str_starts_with($path, '/admin/tools/')) return;
    $admin = need_admin();
    if ($method === 'DELETE' && preg_match('~^/admin/tools/campaigns/([a-f0-9]{32})$~', $path, $m)) {
        $input=body(); reauth($admin,$input);
        db()->beginTransaction();
        $c=query_one('SELECT * FROM campaigns WHERE public_id=? FOR UPDATE',[$m[1]]);
        if(!$c)fail(404,'not_found');
        if(in_array($c['status'],['open','scheduled'],true))fail(409,'close_campaign_first');
        if(($input['confirmation']??null)!==$c['title'])fail(422,'delete_confirmation_required');
        $id=(int)$c['id'];
        $counts=query_one('SELECT (SELECT COUNT(*) FROM entries WHERE campaign_id=?) AS entries,(SELECT COUNT(*) FROM tickets WHERE campaign_id=?) AS tickets,(SELECT COUNT(*) FROM campaign_participants WHERE campaign_id=?) AS participants',(array)[$id,$id,$id]);
        // Keep audit evidence and consent records, but detach deleted application IDs.
        run_sql('INSERT INTO receipt_cleanup_queue (storage_key,campaign_public_id) SELECT r.storage_key,? FROM receipts r JOIN entries e ON e.receipt_id=r.id WHERE e.campaign_id=?',[$c['public_id'],$id]);
        run_sql('DELETE d FROM draw_requests d JOIN winners w ON w.id=d.winner_id JOIN prizes p ON p.id=w.prize_id WHERE p.campaign_id=?',[$id]);
        run_sql('DELETE FROM active_assignments WHERE campaign_id=?',[$id]);
        run_sql('DELETE FROM draw_pool WHERE campaign_id=?',[$id]);
        run_sql('DELETE FROM draw_exclusions WHERE campaign_id=?',[$id]);
        run_sql('DELETE ar FROM admin_requests ar JOIN winners w ON w.id=ar.winner_id JOIN prizes p ON p.id=w.prize_id WHERE p.campaign_id=?',[$id]);
        run_sql('DELETE w FROM winners w JOIN prizes p ON p.id=w.prize_id WHERE p.campaign_id=?',[$id]);
        run_sql('DELETE FROM tickets WHERE campaign_id=?',[$id]);
        run_sql('UPDATE user_consents uc JOIN entries e ON e.id=uc.entry_id SET uc.entry_id=NULL WHERE e.campaign_id=?',[$id]);
        run_sql('DELETE FROM entries WHERE campaign_id=?',[$id]);
        run_sql('DELETE FROM campaign_participants WHERE campaign_id=?',[$id]);
        run_sql('DELETE FROM prizes WHERE campaign_id=?',[$id]);
        run_sql('DELETE FROM receipts WHERE storage_key IN (SELECT storage_key FROM receipt_cleanup_queue WHERE campaign_public_id=?)',[$c['public_id']]);
        run_sql('DELETE FROM campaigns WHERE id=?',[$id]);
        admin_audit((int)$admin['id'],'campaign.delete','campaign',$id,['public_id'=>$c['public_id'],'title'=>$c['title'],'year'=>$c['year'],'quarter'=>$c['quarter'],'counts'=>$counts,'users_preserved'=>true,'consents_preserved'=>true]);
        db()->commit();
        $pending=cleanup_campaign_receipts($c['public_id']);
        json_out(200,['data'=>['deleted'=>true,'pending_files'=>$pending]]);
    }
    if ($method === 'GET' && $path === '/admin/tools/campaign-options') json_out(200,['data'=>admin_rows('SELECT public_id AS id,title,year,quarter,status FROM campaigns ORDER BY year DESC,quarter DESC LIMIT 400')]);
    if ($method === 'PATCH' && preg_match('~^/admin/tools/campaigns/([a-f0-9]{32})$~', $path, $m)) {
        $input=body(); $title=cms_text($input,'title',180); $rules=cms_text($input,'rules_version',80,false);
        $dates=[];
        foreach(['starts_at','ends_at'] as $key) {
            $d=DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z',(string)($input[$key]??''),new DateTimeZone('UTC'));
            if(!$d || $d->format('Y-m-d\TH:i:s\Z')!==($input[$key]??'')) fail(422,'invalid_campaign');
            $dates[$key]=$d;
        }
        if(mb_strlen($title)<3 || $dates['starts_at'] >= $dates['ends_at']) fail(422,'invalid_campaign');
        db()->beginTransaction(); $c=query_one('SELECT * FROM campaigns WHERE public_id=? FOR UPDATE',[$m[1]]);
        if(!$c) fail(404,'not_found');
        if($c['status']!=='draft') fail(409,'campaign_not_draft');
        if(($input['expected_starts_at']??'')!==$c['starts_at'] || ($input['expected_ends_at']??'')!==$c['ends_at'] || ($input['expected_title']??'')!==$c['title'] || ($input['expected_rules_version']??null)!==$c['rules_version']) fail(409,'campaign_changed');
        $local=$dates['starts_at']->setTimezone(new DateTimeZone('Europe/Moscow'));
        if((int)$local->format('Y')!==(int)$c['year'] || (int)ceil((int)$local->format('n')/3)!==(int)$c['quarter']) fail(422,'invalid_campaign_quarter');
        run_sql('UPDATE campaigns SET title=?,starts_at=?,ends_at=?,rules_version=?,workspace_version=workspace_version+1 WHERE id=?',[$title,$dates['starts_at']->format('Y-m-d H:i:s'),$dates['ends_at']->format('Y-m-d H:i:s'),$rules?:null,$c['id']]);
        admin_audit((int)$admin['id'],'campaign.update','campaign',(int)$c['id'],['fields'=>['title','starts_at','ends_at','rules_version']]);
        db()->commit(); json_out(200,['data'=>['updated'=>true]]);
    }
    if ($method === 'GET' && $path === '/admin/tools/overview') {
        $now = new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
        $c = query_one("SELECT public_id AS id,id AS db_id,title,status,starts_at,ends_at,year,quarter FROM campaigns WHERE year=? AND quarter=?", [(int) $now->format('Y'), (int) ceil((int) $now->format('n')/3)]);
        $id = $c['db_id'] ?? 0; if ($c) unset($c['db_id']);
        $counts = query_one("SELECT (SELECT COUNT(*) FROM campaign_participants WHERE campaign_id=?) AS participants,(SELECT COUNT(*) FROM entries WHERE campaign_id=?) AS receipts,(SELECT COUNT(*) FROM tickets WHERE campaign_id=?) AS tickets,(SELECT COUNT(*) FROM entries WHERE campaign_id=? AND status='pending') AS pending,(SELECT COUNT(*) FROM users WHERE status='active' AND email_verified_at IS NULL) AS unverified", [$id,$id,$id,$id]);
        json_out(200, ['data' => ['campaign' => $c,'counts' => $counts]]);
    }
    if ($method === 'GET' && $path === '/admin/tools/entries') {
        [$where, $args] = tools_filters($_GET);
        $page = max(1,min(100000,(int) ($_GET['page'] ?? 1))); $offset = ($page-1)*25;
        json_out(200, ['data' => admin_rows(tools_entry_sql() . $where . " ORDER BY e.id DESC,t.id LIMIT 26 OFFSET $offset", $args),'page' => $page]);
    }
    if ($method === 'POST' && preg_match('~^/admin/tools/campaigns/([a-f0-9]{32})/copy$~', $path, $m)) {
        db()->beginTransaction();
        $source = query_one('SELECT * FROM campaigns WHERE public_id=? FOR UPDATE', [$m[1]]);
        if (!$source) fail(404,'not_found');
        $year = (int) $source['year']; $quarter = (int) $source['quarter']+1;
        if ($quarter === 5) { $quarter=1; $year++; }
        if ($year > 2100) fail(422,'invalid_campaign');
        $start = new DateTimeImmutable(sprintf('%04d-%02d-01 00:00:00',$year,($quarter-1)*3+1),new DateTimeZone('Europe/Moscow'));
        $end = $start->modify('+3 months'); $id = random_id();
        try { run_sql("INSERT INTO campaigns (public_id,year,quarter,title,status,starts_at,ends_at,rules_version,created_by) VALUES (?,?,?,?,'draft',?,?,?,?)", [$id,$year,$quarter,mb_substr($source['title'],0,150).' · '.$year.' Q'.$quarter,$start->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'),$end->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'),$source['rules_version'],$admin['id']]); }
        catch (PDOException $e) { if ($e->getCode()==='23000') fail(409,'campaign_period_exists'); throw $e; }
        $newId=(int) db()->lastInsertId();
        run_sql('INSERT INTO prizes (campaign_id,title,quantity,display_order) SELECT ?,title,quantity,display_order FROM prizes WHERE campaign_id=?',[$newId,$source['id']]);
        admin_audit((int)$admin['id'],'campaign.copy','campaign',$newId,['source_id'=>$source['id'],'year'=>$year,'quarter'=>$quarter,'status'=>'draft']);
        db()->commit(); json_out(201,['data'=>['id'=>$id]]);
    }
    if ($method === 'POST' && $path === '/admin/tools/export') {
        $input=body(); $type=(string)($input['type']??'');
        if (!in_array($type,['participants','tickets','winners'],true)) fail(422,'invalid_export');
        [$where,$args]=tools_filters($input);
        db()->beginTransaction();
        if ($type==='participants') {
            // Export actual giveaway participants, not every registered account.
            $sql='SELECT DISTINCT u.public_id AS user_id,u.name,u.email,u.phone,u.email_verified_at,c.title AS campaign_title,cp.joined_at FROM campaign_participants cp JOIN users u ON u.id=cp.user_id JOIN campaigns c ON c.id=cp.campaign_id LEFT JOIN entries e ON e.participant_id=cp.id';
            $columns=['user_id'=>'ID участника','name'=>'Имя','email'=>'Email','phone'=>'Телефон','email_verified_at'=>'Email подтверждён (UTC)','campaign_title'=>'Розыгрыш','joined_at'=>'Участие с (UTC)'];
        } else {
            $sql=tools_entry_sql(); $where.=($where?' AND ':' WHERE ').($type==='tickets'?'t.id IS NOT NULL':'w.id IS NOT NULL');
            $columns=['name'=>'Имя','email'=>'Email','phone'=>'Телефон','campaign_title'=>'Розыгрыш','entry_id'=>'Заявка','status'=>'Статус','ticket'=>'Билет','eligible'=>'Допущен','prize'=>'Приз','won_at'=>'Выигрыш (UTC)'];
        }
        $rows=admin_rows($sql.$where.' LIMIT 10001',$args);
        if(count($rows)>10000) fail(422,'export_too_large');
        $csv=tools_csv($rows,$columns);
        admin_audit((int)$admin['id'],'data.export','export',0,['type'=>$type,'rows'=>count($rows),'campaign'=>$input['campaign']??null,'status'=>$input['status']??null,'from'=>$input['from']??null,'to'=>$input['to']??null,'search_applied'=>!empty($input['q'])]);
        db()->commit(); json_out(200,['data'=>['filename'=>'milano-'.$type.'-'.gmdate('Ymd-His').'.csv','csv'=>$csv,'rows'=>count($rows)]]);
    }
    fail(404,'not_found');
}
