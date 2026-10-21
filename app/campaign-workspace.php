<?php
declare(strict_types=1);

function workspace_campaign(string $public, bool $lock=false): array {
    $c=query_one('SELECT * FROM campaigns WHERE public_id=?'.($lock?' FOR UPDATE':''),[$public]);
    if(!$c)fail(404,'campaign_unavailable');return $c;
}

// A request reconciles overdue statuses; upload endpoints still enforce UTC dates.
function workspace_sync_due_throttled(): void {
    $lock=fopen(storage_file('locks','campaign-maintenance.lock'),'c+');
    if(!$lock)throw new RuntimeException('campaign_maintenance_unavailable');
    if(!flock($lock,LOCK_EX|LOCK_NB)){fclose($lock);return;}
    try{
        $stamp=(int)stream_get_contents($lock);
        if($stamp>time()-10)return;
        workspace_sync_due();
        ftruncate($lock,0);rewind($lock);fwrite($lock,(string)time());fflush($lock);
    }finally{flock($lock,LOCK_UN);fclose($lock);}
}

function workspace_sync_due(): void {
    foreach(admin_rows("SELECT id FROM campaigns WHERE (status='scheduled' AND starts_at<=UTC_TIMESTAMP()) OR (status='open' AND ends_at<=UTC_TIMESTAMP()) LIMIT 100") as $row){
        db()->beginTransaction();
        try{
            $c=query_one('SELECT * FROM campaigns WHERE id=? FOR UPDATE',[$row['id']]);$now=time();$target=$c['status'];
            if(in_array($c['status'],['scheduled','open'],true)&&strtotime($c['ends_at'].' UTC')<=$now)$target='closed';
            elseif($c['status']==='scheduled'&&strtotime($c['starts_at'].' UTC')<=$now)$target='open';
            if($target!==$c['status']){
                run_sql('UPDATE campaigns SET status=?,workspace_version=workspace_version+1 WHERE id=?',[$target,$c['id']]);
                run_sql('INSERT INTO admin_audit_log(actor_user_id,action,entity_type,entity_id,details_json) VALUES(NULL,?,?,?,?)',['campaign.auto.'.$target,'campaign',$c['id'],json_encode(['campaign_id'=>(int)$c['id'],'campaign_public_id'=>$c['public_id'],'actor_type'=>'system','from'=>$c['status'],'to'=>$target],JSON_THROW_ON_ERROR)]);
            }
            db()->commit();
        }catch(Throwable $e){if(db()->inTransaction())db()->rollBack();throw $e;}
    }
}

function workspace_filters(string $public, ?string $user=null): array {
    $input=[];foreach(['q','status','from','to'] as $key){if(isset($_GET[$key])&&!is_string($_GET[$key]))fail(422,'invalid_filters');$input[$key]=$_GET[$key]??'';}
    $input['campaign']=$public;if($user)$input['user']=$user;return tools_filters($input);
}

function workspace_entries(string $public, ?string $user=null, bool $page=true): array {
    $campaign=workspace_campaign($public);
    [$where,$args]=workspace_filters($public,$user);$offset=(max(1,min(100000,(int)($_GET['page']??1)))-1)*25;
    $rows=admin_rows('SELECT e.id AS db_id,e.public_id AS id,e.status,e.submitted_at,u.public_id AS user_id,u.name,u.email,u.phone,r.public_id AS receipt_id,r.original_name,r.mime,r.verification_status,r.recognition_status,r.matched_quantity FROM entries e JOIN receipts r ON r.id=e.receipt_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id JOIN campaigns c ON c.id=e.campaign_id'.$where.' ORDER BY e.id DESC'.($page?" LIMIT 26 OFFSET $offset":''),$args);
    foreach($rows as &$e){
        $e['receipt']=['id'=>$e['receipt_id'],'name'=>$e['original_name'],'mime'=>$e['mime'],'verification_status'=>$e['verification_status'],'recognition_status'=>$e['recognition_status'],'matched_quantity'=>$e['matched_quantity'],'url'=>'/api/v1/admin/workspace/'.$public.'/receipts/'.$e['receipt_id']];
        $e['tickets']=workspace_ticket_status(admin_rows('SELECT id AS db_id,public_id AS id,ordinal,eligible,issued_at FROM tickets WHERE entry_id=? ORDER BY ordinal,id',[$e['db_id']]),$campaign);unset($e['db_id'],$e['original_name'],$e['mime'],$e['verification_status'],$e['recognition_status'],$e['matched_quantity'],$e['receipt_id']);
    }unset($e);return $rows;
}

function workspace_audit(array $c): array {
    $offset=(max(1,min(100000,(int)($_GET['page']??1)))-1)*25;
    $pattern='"campaign_id"[[:space:]]*:[[:space:]]*"?'.(int)$c['id'].'"?[[:space:]]*[,}]|"campaign"[[:space:]]*:[[:space:]]*"'.$c['public_id'].'"';
    $identity='"campaign_public_id"[[:space:]]*:[[:space:]]*"'.$c['public_id'].'"|"public_id"[[:space:]]*:[[:space:]]*"'.$c['public_id'].'"';
    // Old rows lack UUIDs. Keep only rows after this incarnation's creation
    // event; never attach an earlier deleted campaign's audit by numeric ID.
    $start=query_one("SELECT MAX(id) AS id FROM admin_audit_log WHERE entity_type='campaign' AND entity_id=? AND action='campaign.create' AND created_at>=?",[$c['id'],$c['created_at']])['id']??null;
    return admin_rows("SELECT a.id,a.action,a.entity_type,a.entity_id,a.details_json,a.created_at,COALESCE(u.name,'SYSTEM') AS actor FROM admin_audit_log a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.details_json REGEXP ? OR (a.id>=? AND a.created_at>=? AND (a.details_json IS NULL OR a.details_json NOT REGEXP '\"campaign_public_id\"') AND ((a.entity_type='campaign' AND a.entity_id=?) OR a.details_json REGEXP ?)) ORDER BY a.id DESC LIMIT 26 OFFSET $offset",[$identity,$start??PHP_INT_MAX,$c['created_at'],$c['id'],$pattern]);
}

function workspace_ticket_status(array $rows,array $campaign): array {
    static $cache=[];$cid=(int)$campaign['id'];
    if(!isset($cache[$cid])){[$sql,$args]=draw_eligibility($campaign);$cache[$cid]=array_fill_keys(array_column(admin_rows('SELECT t.id'.$sql,$args),'id'),true);}
    $ids=$cache[$cid];
    $reason=[];
    if($rows){$keys=array_column($rows,'db_id');$marks=implode(',',array_fill(0,count($keys),'?'));
        foreach(admin_rows("SELECT t.id,CASE WHEN t.eligible=0 THEN 'ticket_revoked' WHEN e.status<>'accepted' OR r.verification_status<>'accepted' THEN 'receipt_unapproved' WHEN u.status<>'active' THEN 'account_blocked' WHEN u.email_verified_at IS NULL THEN 'email_unverified' WHEN aa.user_id IS NOT NULL THEN 'participant_already_won' WHEN dx.user_id IS NOT NULL THEN 'participant_excluded' ELSE 'excluded_by_draw_rules' END AS reason FROM tickets t JOIN entries e ON e.id=t.entry_id JOIN receipts r ON r.id=e.receipt_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id LEFT JOIN active_assignments aa ON aa.campaign_id=t.campaign_id AND aa.user_id=u.id LEFT JOIN draw_exclusions dx ON dx.campaign_id=t.campaign_id AND dx.user_id=u.id WHERE t.id IN ($marks)",$keys) as $info)$reason[$info['id']]=$info['reason'];
    }
    foreach($rows as &$row){$row['draw_eligible']=isset($ids[$row['db_id']]);$row['eligibility_reason']=$row['draw_eligible']?'eligible':($reason[$row['db_id']]??'excluded_by_draw_rules');unset($row['db_id']);}unset($row);return $rows;
}

function workspace_receipt(array $c,string $receipt): never {
    $r=query_one('SELECT r.* FROM receipts r JOIN entries e ON e.receipt_id=r.id WHERE r.public_id=? AND e.campaign_id=?',[$receipt,$c['id']]);if(!$r)fail(404,'receipt_unavailable');
    if(!preg_match('/^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/',$r['storage_key'])||!in_array($r['mime'],['image/jpeg','image/png','image/webp','application/pdf'],true))fail(404,'receipt_unavailable');
    $root=realpath(storage_dir('receipts'));$candidate=storage_file('receipts',$r['storage_key']);$file=realpath($candidate);
    if(!$file||is_link($candidate)||strcasecmp(dirname($file),(string)$root)!==0||!is_file($file))fail(404,'receipt_unavailable');
    if((new finfo(FILEINFO_MIME_TYPE))->file($file)!==$r['mime'])fail(415,'unsupported_receipt');
    if(session_status()===PHP_SESSION_ACTIVE)session_write_close();
    header('Cache-Control: private, no-store');header('X-Content-Type-Options: nosniff');header('Content-Type: '.$r['mime']);header('Content-Length: '.filesize($file));
    if($r['mime']==='application/pdf'){header("Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors 'self'");header('X-Frame-Options: SAMEORIGIN');}
    header("Content-Disposition: ".(!empty($_GET['download'])?'attachment':'inline')."; filename=receipt.".pathinfo($file,PATHINFO_EXTENSION)."; filename*=UTF-8''".rawurlencode($r['original_name']));
    readfile($file);exit;
}

function workspace_routes(string $method,string $path): void {
    if(!str_starts_with($path,'/admin/workspace/'))return;
    $admin=need_admin();if($method!=='GET')check_csrf();
    if(!preg_match('~^/admin/workspace/([a-f0-9]{32})(?:/(participants|entries|tickets|receipts|audit|activate|close|reopen|copy|export)(?:/([a-f0-9]{32})(?:/(reject|approve))?)?)?$~',$path,$m))fail(404,'not_found');
    $public=$m[1];$part=$m[2]??'';$item=$m[3]??'';$action=$m[4]??'';$c=workspace_campaign($public);$cid=(int)$c['id'];
    if($method==='GET'&&$part==='receipts'&&$item)workspace_receipt($c,$item);
    if($method==='GET'&&$part===''){
        $counts=query_one("SELECT (SELECT COUNT(*) FROM campaign_participants WHERE campaign_id=?) AS participants,(SELECT COUNT(*) FROM entries WHERE campaign_id=?) AS receipts,(SELECT COUNT(*) FROM tickets WHERE campaign_id=?) AS tickets,(SELECT COUNT(*) FROM entries WHERE campaign_id=? AND status='pending') AS pending,(SELECT COUNT(*) FROM active_assignments WHERE campaign_id=?) AS winners",[$cid,$cid,$cid,$cid,$cid]);
        $c['id']=$c['public_id'];json_out(200,['data'=>['campaign'=>$c,'counts'=>$counts,'prizes'=>admin_rows('SELECT * FROM prizes WHERE campaign_id=? ORDER BY display_order,id',[$cid]),'recognition'=>['provider'=>'code-qr.ru','configured'=>false]]]);
    }
    if($method==='GET'&&$part==='participants'&&$item){
        $u=query_one('SELECT u.public_id AS id,u.name,u.email,u.phone,u.email_verified_at,u.status FROM users u JOIN campaign_participants cp ON cp.user_id=u.id WHERE u.public_id=? AND cp.campaign_id=?',[$item,$cid]);if(!$u)fail(404,'participant_unavailable');
        $wins=admin_rows('SELECT w.id,w.status,w.mode,w.assigned_at,w.cancelled_at,w.cancellation_reason,p.title AS prize_title,t.public_id AS ticket FROM winners w JOIN prizes p ON p.id=w.prize_id JOIN tickets t ON t.id=w.ticket_id JOIN entries e ON e.id=t.entry_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id WHERE p.campaign_id=? AND u.public_id=? ORDER BY w.id DESC',[$cid,$item]);
        json_out(200,['data'=>['user'=>$u,'entries'=>workspace_entries($public,$item,false),'winners'=>$wins]]);
    }
    if($method==='GET'&&$part==='participants'&&!$item){
        [$where,$args]=workspace_filters($public);$offset=(max(1,min(100000,(int)($_GET['page']??1)))-1)*25;
        $needsEntries=!empty($_GET['status'])||!empty($_GET['from'])||!empty($_GET['to']);$filter=$needsEntries?' WHERE c.public_id=? AND EXISTS (SELECT 1 FROM entries e JOIN receipts r ON r.id=e.receipt_id '.$where.' AND e.participant_id=cp.id)':$where;
        $rows=admin_rows('SELECT u.public_id AS id,u.name,u.email,u.phone,u.email_verified_at,(SELECT COUNT(*) FROM entries x WHERE x.participant_id=cp.id) AS receipts,(SELECT COUNT(*) FROM tickets t JOIN entries x ON x.id=t.entry_id WHERE x.participant_id=cp.id) AS tickets FROM campaign_participants cp JOIN users u ON u.id=cp.user_id JOIN campaigns c ON c.id=cp.campaign_id'.$filter.' ORDER BY cp.id DESC LIMIT 26 OFFSET '.$offset,$needsEntries?array_merge([$public],$args):$args);
        json_out(200,['data'=>$rows,'page'=>(int)($_GET['page']??1)]);
    }
    if($method==='GET'&&$part==='entries'&&!$item)json_out(200,['data'=>workspace_entries($public),'page'=>(int)($_GET['page']??1)]);
    if($method==='GET'&&$part==='tickets'&&!$item){
        [$where,$args]=workspace_filters($public);$offset=(max(1,min(100000,(int)($_GET['page']??1)))-1)*25;
        json_out(200,['data'=>workspace_ticket_status(admin_rows('SELECT t.id AS db_id,t.public_id AS id,t.eligible,t.ordinal,t.issued_at,e.public_id AS entry_id,u.public_id AS user_id,u.name,u.email,u.phone FROM tickets t JOIN entries e ON e.id=t.entry_id JOIN receipts r ON r.id=e.receipt_id JOIN campaign_participants cp ON cp.id=e.participant_id JOIN users u ON u.id=cp.user_id JOIN campaigns c ON c.id=e.campaign_id'.$where.' ORDER BY t.id DESC LIMIT 26 OFFSET '.$offset,$args),$c),'page'=>(int)($_GET['page']??1)]);
    }
    if($method==='GET'&&$part==='audit')json_out(200,['data'=>workspace_audit($c),'page'=>(int)($_GET['page']??1)]);
    if($method==='POST'&&$part==='copy')admin_tools_routes('POST','/admin/tools/campaigns/'.$public.'/copy');
    if($method==='DELETE'&&$part==='')admin_tools_routes('DELETE','/admin/tools/campaigns/'.$public);
    if($method==='PATCH'&&$part===''){
        $input=body();$title=trim((string)($input['title']??''));$rules=trim((string)($input['rules_version']??''));$dates=[];
        foreach(['starts_at','ends_at'] as $key){$raw=(string)($input[$key]??'');$d=DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z',$raw,new DateTimeZone('UTC'));if(!$d||$d->format('Y-m-d\TH:i:s\Z')!==$raw)fail(422,'invalid_campaign');$dates[$key]=$d;}
        if(mb_strlen($title)<3||mb_strlen($title)>180||mb_strlen($rules)>80||$dates['starts_at']>=$dates['ends_at'])fail(422,'invalid_campaign');
        $local=$dates['starts_at']->setTimezone(new DateTimeZone('Europe/Moscow'));if((int)$local->format('Y')!==(int)$c['year']||(int)ceil((int)$local->format('n')/3)!==(int)$c['quarter'])fail(422,'invalid_campaign_quarter');
        db()->beginTransaction();$c=workspace_campaign($public,true);if($c['pool_frozen_at'])fail(409,'pool_frozen');if((int)($input['version']??0)!==(int)$c['workspace_version'])fail(409,'campaign_changed');
        if($c['status']==='open'&&($dates['starts_at']->getTimestamp()>time()||$dates['ends_at']->getTimestamp()<=time()))fail(422,'invalid_campaign');
        $after=['title'=>$title,'starts_at'=>$dates['starts_at']->format('Y-m-d H:i:s'),'ends_at'=>$dates['ends_at']->format('Y-m-d H:i:s'),'rules_version'=>$rules?:null];
        run_sql('UPDATE campaigns SET title=?,starts_at=?,ends_at=?,rules_version=?,workspace_version=workspace_version+1 WHERE id=?',[$title,$after['starts_at'],$after['ends_at'],$rules?:null,$cid]);admin_audit((int)$admin['id'],'campaign.update','campaign',$cid,['campaign_id'=>$cid,'before'=>array_intersect_key($c,$after),'after'=>$after]);db()->commit();json_out(200,['data'=>['updated'=>true]]);
    }
    if($method==='POST'&&$part==='reopen'){
        $input=body();reauth($admin,$input);db()->beginTransaction();$c=workspace_campaign($public,true);
        if($c['status']!=='closed'||$c['pool_frozen_at']||query_one('SELECT w.id FROM winners w JOIN prizes p ON p.id=w.prize_id WHERE p.campaign_id=? LIMIT 1',[$cid]))fail(409,'pool_frozen');
        if(strtotime($c['ends_at'].' UTC')<=time()||!query_one('SELECT id FROM prizes WHERE campaign_id=? LIMIT 1',[$cid]))fail(422,'campaign_not_ready');
        $target=strtotime($c['starts_at'].' UTC')>time()?'scheduled':'open';run_sql('UPDATE campaigns SET status=?,workspace_version=workspace_version+1 WHERE id=?',[$target,$cid]);admin_audit((int)$admin['id'],'campaign.reopen','campaign',$cid,['campaign_id'=>$cid,'from'=>'closed','to'=>$target]);db()->commit();json_out(200,['data'=>['status'=>$target]]);
    }
    if($method==='POST'&&$part==='entries'&&$item&&$action==='approve'){
        $input=body();$quantity=filter_var($input['quantity']??null,FILTER_VALIDATE_INT);$reason=trim((string)($input['reason']??''));
        if(!$quantity||$quantity<1||$quantity>1000||mb_strlen($reason)<10||mb_strlen($reason)>500)fail(422,'invalid_moderation');
        db()->beginTransaction();$c=workspace_campaign($public,true);if($c['pool_frozen_at'])fail(409,'pool_frozen');$e=query_one('SELECT * FROM entries WHERE public_id=? AND campaign_id=? FOR UPDATE',[$item,$cid]);if(!$e)fail(404,'not_found');
        if($e['status']==='accepted'){
            $old=query_one('SELECT matched_quantity FROM receipts WHERE id=?',[$e['receipt_id']]);if((int)$old['matched_quantity']!==$quantity)fail(409,'entry_already_reviewed');db()->commit();json_out(200,['data'=>['approved'=>true,'quantity'=>$quantity]]);
        }
        if($e['status']!=='pending')fail(409,'entry_already_reviewed');
        run_sql("UPDATE receipts SET verification_status='accepted',recognition_status='matched',recognition_source='manual',matched_quantity=?,recognized_at=UTC_TIMESTAMP() WHERE id=?",[$quantity,$e['receipt_id']]);
        run_sql("UPDATE entries SET status='accepted',accepted_at=UTC_TIMESTAMP() WHERE id=?",[$e['id']]);
        for($n=1;$n<=$quantity;$n++)run_sql('INSERT INTO tickets(public_id,campaign_id,entry_id,ordinal) VALUES(?,?,?,?)',[random_id(),$cid,$e['id'],$n]);
        admin_audit((int)$admin['id'],'receipt.approve','campaign',$cid,['campaign_id'=>$cid,'entry'=>$item,'quantity'=>$quantity,'reason'=>$reason]);db()->commit();json_out(200,['data'=>['approved'=>true,'quantity'=>$quantity]]);
    }
    if($method==='POST'&&in_array($part,['activate','close'],true)){
        db()->beginTransaction();$c=workspace_campaign($public,true);$target=$part==='close'?'closed':(strtotime($c['starts_at'].' UTC')>time()?'scheduled':'open');
        if($part==='activate'&&$c['status']!=='draft')fail(409,'invalid_transition');
        if($part==='activate'&&(!$c['rules_version']||strtotime($c['ends_at'].' UTC')<=time()||!query_one('SELECT id FROM prizes WHERE campaign_id=? LIMIT 1',[$cid])))fail(422,'campaign_not_ready');
        if($target!==$c['status']){run_sql('UPDATE campaigns SET status=?,workspace_version=workspace_version+1 WHERE id=?',[$target,$cid]);admin_audit((int)$admin['id'],'campaign.'.$part,'campaign',$cid,['campaign_id'=>$cid,'from'=>$c['status'],'to'=>$target]);}db()->commit();json_out(200,['data'=>['status'=>$target]]);
    }
    if($method==='POST'&&$part==='entries'&&$item&&$action==='reject'){
        $input=body();$reason=trim((string)($input['reason']??''));if(mb_strlen($reason)<10||mb_strlen($reason)>500)fail(422,'reason_required');
        db()->beginTransaction();$c=workspace_campaign($public,true);if($c['pool_frozen_at'])fail(409,'pool_frozen');$e=query_one('SELECT id,receipt_id,status FROM entries WHERE public_id=? AND campaign_id=? FOR UPDATE',[$item,$cid]);if(!$e)fail(404,'not_found');
        if($e['status']!=='rejected'){run_sql("UPDATE entries SET status='rejected' WHERE id=?",[$e['id']]);run_sql("UPDATE receipts SET verification_status='rejected',recognition_status='rejected' WHERE id=?",[$e['receipt_id']]);run_sql('UPDATE tickets SET eligible=0 WHERE entry_id=?',[$e['id']]);admin_audit((int)$admin['id'],'receipt.reject','campaign',$cid,['campaign_id'=>$cid,'entry'=>$item,'reason'=>$reason]);}db()->commit();json_out(200,['data'=>['rejected'=>true]]);
    }
    fail(404,'not_found');
}
