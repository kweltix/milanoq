<?php
declare(strict_types=1);

final class DrawError extends RuntimeException
{
    public int $httpStatus;
    public function __construct(int $status, string $code) { parent::__construct($code); $this->httpStatus = $status; }
}

function draw_reject(int $status, string $code): never { throw new DrawError($status, $code); }

// Run before any 008 DDL: historical conflicts require a human decision.
function draw_migration_preflight(): void
{
    $conflict = query_one('SELECT p.campaign_id,cp.user_id,COUNT(*) AS assignments FROM winners w JOIN prizes p ON p.id=w.prize_id JOIN tickets t ON t.id=w.ticket_id JOIN entries e ON e.id=t.entry_id JOIN campaign_participants cp ON cp.id=e.participant_id GROUP BY p.campaign_id,cp.user_id HAVING COUNT(*)>1 LIMIT 1');
    if ($conflict) throw new RuntimeException('008 blocked: historical duplicate winner for campaign ' . $conflict['campaign_id'] . ', user ' . $conflict['user_id'] . '. Preserve history and resolve explicitly.');
    $mismatch = query_one('SELECT w.id FROM winners w JOIN prizes p ON p.id=w.prize_id JOIN tickets t ON t.id=w.ticket_id JOIN entries e ON e.id=t.entry_id JOIN campaign_participants cp ON cp.id=e.participant_id WHERE p.campaign_id<>t.campaign_id OR p.campaign_id<>e.campaign_id OR p.campaign_id<>cp.campaign_id LIMIT 1');
    if ($mismatch) throw new RuntimeException('008 blocked: historical winner campaign mismatch, winner ' . $mismatch['id']);
}

function draw_rows(string $sql, array $args = []): array
{
    $statement = db()->prepare($sql); $statement->execute($args); return $statement->fetchAll();
}

function draw_campaign(string $publicId, bool $lock = false): array
{
    $campaign = query_one('SELECT * FROM campaigns WHERE public_id=?' . ($lock ? ' FOR UPDATE' : ''), [$publicId]);
    if (!$campaign) draw_reject(404, 'campaign_unavailable');
    return $campaign;
}

function draw_closed(array $campaign): void
{
    if ($campaign['status'] !== 'closed') draw_reject(409, 'close_campaign_first');
}

function draw_prize(array $campaign, array $input, bool $available): array
{
    $id = filter_var($input['prize_id'] ?? null, FILTER_VALIDATE_INT);
    $slot = filter_var($input['prize_slot'] ?? null, FILTER_VALIDATE_INT);
    if (!$id || !$slot) draw_reject(422, 'invalid_prize_slot');
    $prize = query_one('SELECT * FROM prizes WHERE id=? AND campaign_id=?', [$id, $campaign['id']]);
    if (!$prize || $slot < 1 || $slot > (int)$prize['quantity']) draw_reject(422, 'invalid_prize_slot');
    if ($available && query_one('SELECT winner_id FROM active_assignments WHERE prize_id=? AND prize_slot=?', [$id,$slot])) draw_reject(409, 'prize_slot_taken');
    $prize['slot'] = (int)$slot; return $prize;
}

function draw_reason(array $input): string
{
    $reason = trim((string)($input['reason'] ?? ''));
    if (mb_strlen($reason) < 10 || mb_strlen($reason) > 500) draw_reject(422, 'invalid_reason');
    return $reason;
}

function draw_reauthenticate(array $admin, array $input): void
{
    if (($_SESSION['reauth_after'] ?? 0) > time()) draw_reject(429, 'try_later');
    $credentials = query_one("SELECT password_hash FROM users WHERE id=? AND role='admin' AND status='active'", [$admin['id']]);
    if (!$credentials || !password_verify((string)($input['password'] ?? ''), $credentials['password_hash'])) {
        $_SESSION['reauth_after'] = time() + 5; draw_reject(401, 'invalid_credentials');
    }
}

// The same predicate is used for snapshot creation and every later selection.
// Current eligibility may remove frozen tickets; it can never add a new one.
function draw_eligibility(array $campaign, bool $available = true, bool $snapshot = false): array
{
    $joins = ' FROM tickets t JOIN entries e ON e.id=t.entry_id JOIN receipts r ON r.id=e.receipt_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id';
    $where = " WHERE t.campaign_id=? AND e.campaign_id=t.campaign_id AND cp.campaign_id=t.campaign_id AND r.owner_user_id=cp.user_id AND t.eligible=1 AND e.status='accepted' AND r.verification_status='accepted' AND u.status='active' AND u.email_verified_at IS NOT NULL";
    if (!$snapshot && !empty($campaign['pool_frozen_at'])) {
        $joins .= ' JOIN draw_pool dp ON dp.campaign_id=t.campaign_id AND dp.ticket_id=t.id AND dp.user_id=cp.user_id';
        $where .= ' AND dp.excluded_at IS NULL';
    }
    $where .= ' AND NOT EXISTS (SELECT 1 FROM draw_exclusions dx WHERE dx.campaign_id=t.campaign_id AND dx.user_id=cp.user_id)';
    if ($available) $where .= ' AND NOT EXISTS (SELECT 1 FROM active_assignments aa WHERE aa.campaign_id=t.campaign_id AND aa.user_id=cp.user_id)';
    return [$joins.$where, [(int)$campaign['id']]];
}

function draw_mask_name(string $name): string
{
    $parts = preg_split('/\s+/u', trim($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    return implode(' ', array_map(static fn(string $part): string => mb_substr($part,0,1).'***', array_slice($parts,0,3))) ?: '***';
}

function draw_result(array $row): array
{
    $result = ['id'=>(int)$row['id'], 'name_masked'=>draw_mask_name((string)$row['name']), 'ticket'=>$row['ticket'], 'prize_title'=>$row['prize_title'], 'prize_id'=>(int)$row['prize_id'], 'prize_slot'=>(int)$row['prize_slot'], 'mode'=>$row['mode'], 'status'=>$row['status'], 'assigned_at'=>$row['assigned_at']];
    $result += ['name'=>$row['name'],'user_id'=>$row['user_public_id']??null,'email'=>$row['email']??null,'phone'=>$row['phone']??null,'reason'=>$row['reason']??null];
    if ($row['status'] === 'cancelled') $result += ['cancelled_at'=>$row['cancelled_at'], 'cancellation_reason'=>$row['cancellation_reason'], 'return_to_pool'=>(bool)$row['return_to_pool']];
    return $result;
}

function draw_winner(int $winnerId, int $campaignId): ?array
{
    return query_one('SELECT w.*,p.title AS prize_title,t.public_id AS ticket,cp.user_id,u.public_id AS user_public_id,u.name,u.email,u.phone FROM winners w JOIN prizes p ON p.id=w.prize_id JOIN tickets t ON t.id=w.ticket_id JOIN entries e ON e.id=t.entry_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id WHERE w.id=? AND p.campaign_id=?', [$winnerId,$campaignId]);
}

function draw_state(string $publicId): array
{
    // A short read transaction keeps counts and history from mixing two draws.
    db()->beginTransaction();
    try {
        $campaign = draw_campaign($publicId); $cid=(int)$campaign['id'];
        [$eligible,$args] = draw_eligibility($campaign);
        $count=(int)query_one('SELECT COUNT(*) AS n'.$eligible,$args)['n'];
        $pool = empty($campaign['pool_frozen_at']) ? $count : (int)query_one('SELECT COUNT(*) AS n FROM draw_pool WHERE campaign_id=?',[$cid])['n'];
        $rows=draw_rows('SELECT w.*,p.title AS prize_title,t.public_id AS ticket,u.name,u.public_id AS user_public_id,u.email,u.phone FROM winners w JOIN prizes p ON p.id=w.prize_id JOIN tickets t ON t.id=w.ticket_id JOIN entries e ON e.id=t.entry_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id WHERE p.campaign_id=? ORDER BY w.id DESC',[$cid]);
        $winners=array_map('draw_result',$rows); $last=null;
        foreach($winners as $winner) if($winner['status']==='active') { $last=$winner;break; }
        $pending=(int)query_one("SELECT COUNT(*) AS n FROM entries e JOIN receipts r ON r.id=e.receipt_id WHERE e.campaign_id=? AND (e.status='pending' OR (e.status='accepted' AND r.verification_status='pending'))",[$cid])['n'];
        db()->commit();
        $sample=draw_rows('SELECT t.public_id AS ticket,u.name'.$eligible.' ORDER BY t.id LIMIT 20',$args);
        return ['frozen_at'=>$campaign['pool_frozen_at'], 'pool_count'=>$pool, 'eligible_count'=>$count, 'pending_count'=>$pending, 'winners'=>$winners, 'last_result'=>$last,'candidates'=>$sample];
    } catch(Throwable $e) { if(db()->inTransaction()) db()->rollBack();throw $e; }
}

function draw_preview(string $publicId, array $input): array
{
    if(($input['demo']??false)===true){
        $campaign=draw_campaign($publicId);$prize=draw_prize($campaign,$input,false);$sample=[];
        for($n=1;$n<=12;$n++)$sample[]=['name'=>'DEMO '.$n,'ticket'=>'DEMO-'.str_pad((string)$n,4,'0',STR_PAD_LEFT)];
        return ['test'=>true,'demo'=>true,'candidates'=>$sample,'result'=>$sample[random_int(0,11)]+['name_masked'=>'DEMO','prize_title'=>$prize['title'],'prize_slot'=>$prize['slot'],'prize_id'=>(int)$prize['id']]];
    }
    $campaign=draw_campaign($publicId);draw_closed($campaign);$prize=draw_prize($campaign,$input,false);
    [$eligible,$args]=draw_eligibility($campaign);
    $count=(int)query_one('SELECT COUNT(*) AS n'.$eligible,$args)['n'];
    if(!$count) draw_reject(409,'empty_draw_pool');
    $offset=random_int(0,$count-1);
    $ticket=query_one('SELECT t.public_id AS ticket,u.name'.$eligible.' ORDER BY t.id LIMIT '.$offset.',1',$args);
    if(!$ticket) draw_reject(409,'draw_pool_changed');
    return ['test'=>true,'result'=>['name_masked'=>draw_mask_name($ticket['name']),'ticket'=>$ticket['ticket'],'prize_title'=>$prize['title'],'prize_id'=>(int)$prize['id'],'prize_slot'=>$prize['slot']]];
}

function draw_audit(int $actor, string $action, int $winnerId, array $details): void
{
    if(isset($details['campaign_id']))$details['campaign_public_id']=query_one('SELECT public_id FROM campaigns WHERE id=?',[$details['campaign_id']])['public_id']??null;
    run_sql("INSERT INTO admin_audit_log (actor_user_id,action,entity_type,entity_id,details_json) VALUES (?,?,'winner',?,?)",[$actor,$action,$winnerId,json_encode($details,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
}

function draw_run(array $admin, string $publicId, array $input, string $key): array
{
    if(!preg_match('/^[A-Za-z0-9_-]{16,100}$/',$key)) draw_reject(422,'invalid_idempotency_key');
    $mode=(string)($input['mode']??'');
    if(!in_array($mode,['random','manual'],true)) draw_reject(422,'invalid_draw_mode');
    $reason=null;$ticketPublic=null;
    if($mode==='manual') {
        $reason=draw_reason($input);$ticketPublic=(string)($input['ticket']??'');
        if(!preg_match('/^[a-f0-9]{32}$/',$ticketPublic)) draw_reject(422,'invalid_ticket');
        draw_reauthenticate($admin,$input);
    }
    $hash=hash('sha256',json_encode([$publicId,$mode,(int)($input['prize_id']??0),(int)($input['prize_slot']??0),$ticketPublic,$reason],JSON_THROW_ON_ERROR));
    db()->beginTransaction();
    try {
        $campaign=draw_campaign($publicId,true);$cid=(int)$campaign['id'];
        $replay=query_one('SELECT body_hash,response_json FROM draw_requests WHERE actor_user_id=? AND request_key=?',[$admin['id'],$key]);
        if($replay) {
            if(!hash_equals($replay['body_hash'],$hash)) draw_reject(409,'idempotency_conflict');
            $result=json_decode($replay['response_json'],true,512,JSON_THROW_ON_ERROR);db()->commit();return $result;
        }
        // Old keys remain reserved; silently issuing a second prize would be unsafe.
        if(query_one('SELECT id FROM admin_requests WHERE actor_user_id=? AND request_key=?',[$admin['id'],$key])) draw_reject(409,'idempotency_conflict');
        draw_closed($campaign);$prize=draw_prize($campaign,$input,true);
        if(empty($campaign['pool_frozen_at'])) {
            if(query_one("SELECT e.id FROM entries e JOIN receipts r ON r.id=e.receipt_id WHERE e.campaign_id=? AND (e.status='pending' OR (e.status='accepted' AND r.verification_status='pending')) LIMIT 1",[$cid])) draw_reject(409,'pending_reviews');
            [$source,$sourceArgs]=draw_eligibility($campaign,false,true);
            run_sql('INSERT INTO draw_pool (campaign_id,ticket_id,user_id) SELECT t.campaign_id,t.id,cp.user_id'.$source,$sourceArgs);
            run_sql('UPDATE campaigns SET pool_frozen_at=UTC_TIMESTAMP() WHERE id=?',[$cid]);
            $campaign['pool_frozen_at']='frozen';
        }
        [$eligible,$args]=draw_eligibility($campaign);
        if($mode==='manual') {
            $selected=query_one('SELECT t.id,t.public_id AS ticket,cp.user_id'.$eligible.' AND t.public_id=? FOR UPDATE',[...$args,$ticketPublic]);
            if(!$selected) draw_reject(422,'ineligible_ticket');
        } else {
            $count=(int)query_one('SELECT COUNT(*) AS n'.$eligible,$args)['n'];
            if(!$count) draw_reject(409,'empty_draw_pool');
            // One row per ticket, including all tickets belonging to one person.
            $offset=random_int(0,$count-1);
            $selected=query_one('SELECT t.id,t.public_id AS ticket,cp.user_id'.$eligible.' ORDER BY t.id LIMIT '.$offset.',1 FOR UPDATE',$args);
            if(!$selected) draw_reject(409,'draw_pool_changed');
        }
        run_sql('INSERT INTO winners (prize_id,prize_slot,ticket_id,mode,assigned_by,reason) VALUES (?,?,?,?,?,?)',[$prize['id'],$prize['slot'],$selected['id'],$mode,$admin['id'],$reason]);
        $winner=(int)db()->lastInsertId();
        run_sql('INSERT INTO active_assignments (campaign_id,user_id,prize_id,prize_slot,winner_id) VALUES (?,?,?,?,?)',[$cid,$selected['user_id'],$prize['id'],$prize['slot'],$winner]);
        $result=['test'=>false,'result'=>draw_result(draw_winner($winner,$cid))];
        run_sql('INSERT INTO draw_requests (actor_user_id,request_key,body_hash,winner_id,response_json,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP())',[$admin['id'],$key,$hash,$winner,json_encode($result,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
        draw_audit((int)$admin['id'],'winner.'.$mode,$winner,['campaign_id'=>$cid,'rules_version'=>$campaign['rules_version'],'mode'=>$mode,'prize_id'=>(int)$prize['id'],'prize_slot'=>$prize['slot'],'ticket'=>$selected['ticket'],'reason'=>$reason]);
        db()->commit();return $result;
    } catch(Throwable $e) {
        if(db()->inTransaction()) db()->rollBack();
        if($e instanceof PDOException && $e->getCode()==='23000') draw_reject(409,'draw_conflict');
        throw $e;
    }
}

function draw_cancel(array $admin, string $publicId, int $winnerId, array $input): array
{
    $reason=draw_reason($input);draw_reauthenticate($admin,$input);
    if(!array_key_exists('return_to_pool',$input)||!is_bool($input['return_to_pool'])) draw_reject(422,'invalid_return_to_pool');
    $return=$input['return_to_pool'];
    db()->beginTransaction();
    try {
        $campaign=draw_campaign($publicId,true);draw_closed($campaign);$cid=(int)$campaign['id'];
        $winner=draw_winner($winnerId,$cid);
        if(!$winner) draw_reject(404,'winner_unavailable');
        if($winner['status']==='cancelled') {
            if($winner['cancellation_reason']!==$reason||(bool)$winner['return_to_pool']!==$return) draw_reject(409,'winner_already_cancelled');
            db()->commit();return ['cancelled'=>true,'result'=>draw_result($winner)];
        }
        run_sql("UPDATE winners SET status='cancelled',cancelled_at=UTC_TIMESTAMP(),cancelled_by=?,cancellation_reason=?,return_to_pool=? WHERE id=?",[$admin['id'],$reason,(int)$return,$winnerId]);
        run_sql('DELETE FROM active_assignments WHERE winner_id=? AND campaign_id=?',[$winnerId,$cid]);
        // Returning releases only the active-win exclusion. Never reset an
        // unrelated exclusion, ticket flag, user block or approval decision.
        if(!$return) {
            run_sql("INSERT IGNORE INTO draw_exclusions (campaign_id,user_id,excluded_at,reason) VALUES (?,?,UTC_TIMESTAMP(),'cancelled_no_return')",[$cid,$winner['user_id']]);
            run_sql("UPDATE draw_pool SET excluded_at=UTC_TIMESTAMP(),exclusion_reason='cancelled_no_return' WHERE campaign_id=? AND user_id=? AND excluded_at IS NULL",[$cid,$winner['user_id']]);
        }
        draw_audit((int)$admin['id'],'winner.cancel',$winnerId,['campaign_id'=>$cid,'reason'=>$reason,'return_to_pool'=>$return,'prize_id'=>(int)$winner['prize_id'],'prize_slot'=>(int)$winner['prize_slot']]);
        $result=['cancelled'=>true,'result'=>draw_result(draw_winner($winnerId,$cid))];
        db()->commit();return $result;
    } catch(Throwable $e) { if(db()->inTransaction()) db()->rollBack();throw $e; }
}

function draw_routes(string $method, string $path): void
{
    $legacy=$method==='POST'&&preg_match('~^/admin/campaigns/([a-f0-9]{32})/winners$~',$path,$old);
    if(!$legacy&&!str_starts_with($path,'/admin/draw/')) return;
    $admin=need_admin();
    if($method!=='GET') check_csrf();
    try {
        if($legacy) {
            $input=body();$input['mode']='manual';
            json_out(200,['data'=>draw_run($admin,$old[1],$input,(string)($_SERVER['HTTP_IDEMPOTENCY_KEY']??''))]);
        }
        if(!preg_match('~^/admin/draw/([a-f0-9]{32})/(state|preview|run|cancel)(?:/([0-9]+))?$~',$path,$match)) draw_reject(404,'not_found');
        $public=$match[1];$action=$match[2];$item=(int)($match[3]??0);
        if($method==='GET'&&$action==='state'&&!$item) json_out(200,['data'=>draw_state($public)]);
        if($method==='POST'&&$action==='preview'&&!$item) json_out(200,['data'=>draw_preview($public,body())]);
        if($method==='POST'&&$action==='run'&&!$item) json_out(200,['data'=>draw_run($admin,$public,body(),(string)($_SERVER['HTTP_IDEMPOTENCY_KEY']??''))]);
        if($method==='POST'&&$action==='cancel'&&$item) json_out(200,['data'=>draw_cancel($admin,$public,$item,body())]);
        draw_reject(404,'not_found');
    } catch(DrawError $e) { fail($e->httpStatus,$e->getMessage()); }
}
