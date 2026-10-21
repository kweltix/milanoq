<?php
declare(strict_types=1);
require_once __DIR__ . '/xlsx.php';

final class CampaignExportException extends RuntimeException
{
    public string $error;
    public array $fields;
    public function __construct(int $status, string $error, array $fields = []) {
        parent::__construct($error, $status); $this->error = $error; $this->fields = $fields;
    }
}

function campaign_export_request(array $input): array
{
    $scope = $input['scope'] ?? 'all'; $lang = $input['lang'] ?? 'ru';
    if (!in_array($scope, ['all','filtered'], true) || !in_array($lang, ['ru','en'], true)) throw new CampaignExportException(422, 'invalid_export');
    if (isset($input['filters']) && !is_array($input['filters'])) throw new CampaignExportException(422, 'invalid_filters');
    $filters = [];
    foreach (['q','status','from','to'] as $key) {
        $value = $input['filters'][$key] ?? '';
        if (!is_string($value)) throw new CampaignExportException(422, 'invalid_filters');
        $filters[$key] = trim($value);
    }
    $filters['q'] = mb_substr($filters['q'], 0, 120);
    if ($filters['status'] !== '' && !in_array($filters['status'], ['pending','accepted','rejected'], true)) throw new CampaignExportException(422, 'invalid_filters');
    foreach (['from','to'] as $key) if ($filters[$key] !== '') {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $filters[$key], new DateTimeZone('Europe/Moscow'));
        if (!$date || $date->format('Y-m-d') !== $filters[$key]) throw new CampaignExportException(422, 'invalid_filters');
    }
    if ($filters['from'] !== '' && $filters['to'] !== '' && $filters['from'] > $filters['to']) throw new CampaignExportException(422, 'invalid_filters');
    return ['scope'=>$scope, 'lang'=>$lang, 'filters'=>$scope === 'all' ? ['q'=>'','status'=>'','from'=>'','to'=>''] : $filters];
}

function campaign_export_rows(PDO $pdo, string $sql, array $args, string $sheet, int $limit): array
{
    $stmt = $pdo->prepare($sql . ' LIMIT ' . ($limit + 1)); $stmt->execute($args); $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (count($rows) > $limit) throw new CampaignExportException(422, 'export_too_large', ['sheet'=>$sheet, 'limit'=>$limit]);
    return $rows;
}

/** Caller supplies a single read transaction for a consistent multi-sheet snapshot. */
function campaign_export_load(PDO $pdo, string $campaignId, array $request, int $limit = 10000): array
{
    $stmt = $pdo->prepare('SELECT id,public_id,title,status,year,quarter,starts_at,ends_at,rules_version FROM campaigns WHERE public_id=?');
    $stmt->execute([$campaignId]); $campaign = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$campaign) throw new CampaignExportException(404, 'not_found');
    [$where, $args] = tools_filters(array_merge($request['filters'], ['campaign'=>$campaignId]));
    $from = ' FROM entries e JOIN receipts r ON r.id=e.receipt_id JOIN campaign_participants cp ON cp.id=e.participant_id AND cp.campaign_id=e.campaign_id JOIN users u ON u.id=cp.user_id AND u.id=r.owner_user_id JOIN campaigns c ON c.id=e.campaign_id';
    $user = 'u.public_id AS user_id,u.name,u.email,u.phone';
    $receipts = campaign_export_rows($pdo, 'SELECT e.public_id AS entry_id,e.status,e.submitted_at,e.accepted_at,r.public_id AS receipt_id,r.original_name,r.mime,r.byte_size,r.verification_status,r.recognition_status,r.recognition_source,r.matched_quantity,' . $user . $from . $where . ' ORDER BY e.id', $args, 'Receipts', $limit);
    $ticketJoin = ' JOIN tickets t ON t.entry_id=e.id AND t.campaign_id=e.campaign_id';
    $tickets = campaign_export_rows($pdo, 'SELECT t.public_id AS ticket_id,t.ordinal,t.issued_at,t.eligible,e.public_id AS entry_id,e.status,' . $user . $from . $ticketJoin . $where . ' ORDER BY t.id', $args, 'Tickets', $limit);
    $winners = campaign_export_rows($pdo, 'SELECT w.id AS winner_id,w.prize_slot,w.mode,w.reason,w.assigned_at,w.status AS winner_status,w.cancelled_at,w.cancellation_reason,w.return_to_pool,p.title AS prize,t.public_id AS ticket_id,e.public_id AS entry_id,' . $user . $from . $ticketJoin . ' JOIN winners w ON w.ticket_id=t.id JOIN prizes p ON p.id=w.prize_id AND p.campaign_id=e.campaign_id' . $where . ' ORDER BY w.id', $args, 'Winners', $limit);
    $participantSql = 'SELECT u.public_id AS user_id,u.name,u.email,u.phone,u.status AS user_status,u.email_verified_at,xp.joined_at FROM campaign_participants xp JOIN users u ON u.id=xp.user_id JOIN campaigns xc ON xc.id=xp.campaign_id WHERE xc.public_id=?';
    $participantArgs = [$campaignId];
    if ($request['scope'] === 'filtered') {
        $participantSql .= ' AND EXISTS (SELECT 1' . $from . $where . ' AND e.participant_id=xp.id)';
        array_push($participantArgs, ...$args);
    }
    $participants = campaign_export_rows($pdo, $participantSql . ' ORDER BY xp.id', $participantArgs, 'Participants', $limit);
    $perUser = [];
    foreach ($receipts as $row) { $key=$row['user_id']; $perUser[$key]['receipts']=($perUser[$key]['receipts'] ?? 0)+1; }
    foreach ($tickets as $row) { $key=$row['user_id']; $perUser[$key]['tickets']=($perUser[$key]['tickets'] ?? 0)+1; }
    $counts = ['participants'=>count($participants),'receipts'=>count($receipts),'tickets'=>count($tickets),'pending'=>0,'accepted'=>0,'rejected'=>0,'active_winners'=>0,'cancelled_winners'=>0];
    foreach ($receipts as $row) $counts[$row['status']]++;
    foreach ($winners as $row) {
        if ($row['winner_status'] === 'cancelled') $counts['cancelled_winners']++;
        else { $counts['active_winners']++; $key=$row['user_id']; $perUser[$key]['active_winners']=($perUser[$key]['active_winners'] ?? 0)+1; }
    }
    foreach ($participants as &$participant) $participant += ($perUser[$participant['user_id']] ?? []) + ['receipts'=>0,'tickets'=>0,'active_winners'=>0];
    unset($participant);
    return compact('campaign','participants','receipts','tickets','winners','counts');
}

function campaign_export_audit(array $snapshot, array $request): array
{
    return ['campaign_id'=>(int)$snapshot['campaign']['id'], 'campaign_public_id'=>$snapshot['campaign']['public_id'], 'format'=>'xlsx', 'scope'=>$request['scope'], 'lang'=>$request['lang'], 'counts'=>$snapshot['counts'], 'status'=>$request['filters']['status'] ?: null, 'from'=>$request['filters']['from'] ?: null, 'to'=>$request['filters']['to'] ?: null, 'search_applied'=>$request['filters']['q'] !== ''];
}

function campaign_export_sheets(array $data, array $request, string $baseUrl, ?DateTimeImmutable $generated = null, ?string $language = null): array
{
    $lang = $language ?? $request['lang']; $ru = $lang === 'ru';
    $tr = static fn(string $en, string $ruText): string => $ru ? $ruText : $en;
    $date = static fn(?string $value): array => ['type'=>'date','value'=>$value];
    $status = static function (?string $value) use ($ru): ?string {
        if (!$ru || $value === null) return $value;
        return ['pending'=>'На проверке','accepted'=>'Принято','rejected'=>'Отклонено','active'=>'Действует','blocked'=>'Заблокирован','cancelled'=>'Отменено','random'=>'Случайный выбор','manual'=>'Вручную','draft'=>'Черновик','open'=>'Открыта','closed'=>'Закрыта','awaiting_service'=>'Ожидает сервиса','confirmed'=>'Подтверждено','failed'=>'Ошибка'][$value] ?? $value;
    };
    $generated ??= new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $c = $data['campaign'];
    $summary = [[$tr('Campaign ID','ID кампании'),$c['public_id']],[$tr('Campaign','Кампания'),$c['title']],[$tr('Status','Статус'),$status($c['status'])],[$tr('Starts (Moscow)','Начало (Москва)'),$date($c['starts_at'])],[$tr('Ends (Moscow)','Окончание (Москва)'),$date($c['ends_at'])],[$tr('Rules version','Версия правил'),$c['rules_version']],[$tr('Generated (Moscow)','Создано (Москва)'),$date($generated->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'))],[$tr('Scope','Область'),$request['scope']==='all'?$tr('Entire campaign','Вся кампания'):$tr('Current filters','Текущие фильтры')],[$tr('Time zone','Часовой пояс'),'Europe/Moscow (UTC+03:00)'],[$tr('Search','Поиск'),$request['filters']['q']],[$tr('Entry status filter','Фильтр статуса заявки'),$status($request['filters']['status'])],[$tr('From (inclusive, Moscow)','С (включительно, Москва)'),$request['filters']['from']],[$tr('To (inclusive, Moscow)','По (включительно, Москва)'),$request['filters']['to']]];
    foreach (['participants'=>['Unique participants','Уникальные участники'],'receipts'=>['Receipts','Чеки'],'tickets'=>['Tickets','Билеты'],'pending'=>['Pending receipts','Чеки на проверке'],'accepted'=>['Accepted receipts','Принятые чеки'],'rejected'=>['Rejected receipts','Отклонённые чеки'],'active_winners'=>['Active winners','Действующие выигрыши'],'cancelled_winners'=>['Cancelled assignments','Отменённые назначения']] as $key=>$label) $summary[] = [$tr(...$label),$data['counts'][$key]];
    $summary[] = [$tr('Receipt files','Файлы чеков'),$tr('Links require an administrator session; files are not attached.','Ссылки требуют входа администратора; файлы не вложены.')];
    $summary[] = [$tr('Product recognition','Распознавание товаров'),$tr('Recognition service is not connected. Confirmed quantity and its source are shown when available.','Сервис распознавания не подключён. Подтверждённое количество и источник указаны при наличии.')];
    $sheets = [['name'=>$tr('Summary','Сводка'),'headers'=>[$tr('Metric','Показатель'),$tr('Value','Значение')],'rows'=>$summary,'widths'=>[38,85]]];
    $participantRows=[];
    foreach ($data['participants'] as $p) $participantRows[] = [$p['user_id'],$p['name'],$p['email'],$p['phone'],$status($p['user_status']),$date($p['email_verified_at']),$date($p['joined_at']),(int)$p['receipts'],(int)$p['tickets'],(int)$p['active_winners']];
    $sheets[] = ['name'=>$tr('Participants','Участники'),'headers'=>[$tr('Participant ID','ID участника'),$tr('Name','Имя'),'Email',$tr('Phone','Телефон'),$tr('Account status','Статус аккаунта'),$tr('Email verified (Moscow)','Email подтверждён (Москва)'),$tr('Joined (Moscow)','Участие с (Москва)'),$tr('Receipts in scope','Чеков в выборке'),$tr('Tickets in scope','Билетов в выборке'),$tr('Active wins in scope','Действующих выигрышей')],'rows'=>$participantRows,'widths'=>[35,26,34,22,20,26,25,20,20,24],'filter'=>true];
    $receiptRows=[];
    foreach ($data['receipts'] as $r) {
        $url = rtrim($baseUrl,'/') . '/api/v1/admin/workspace/' . $c['public_id'] . '/receipts/' . $r['receipt_id'];
        $receiptRows[] = [$r['entry_id'],$r['receipt_id'],$r['user_id'],$r['name'],$r['email'],$r['phone'],$status($r['status']),$status($r['verification_status']),$date($r['submitted_at']),$date($r['accepted_at']),$r['original_name'],$r['mime'],(int)$r['byte_size'],$status($r['recognition_status']),$r['recognition_source'],$r['matched_quantity']===null?null:(int)$r['matched_quantity'],['value'=>$tr('Open file (admin)','Открыть файл (админ)'),'url'=>$url]];
    }
    $sheets[] = ['name'=>$tr('Receipts','Чеки'),'headers'=>[$tr('Entry ID','ID заявки'),$tr('Receipt ID','ID чека'),$tr('Participant ID','ID участника'),$tr('Name','Имя'),'Email',$tr('Phone','Телефон'),$tr('Entry status','Статус заявки'),$tr('Receipt status','Статус чека'),$tr('Submitted (Moscow)','Отправлено (Москва)'),$tr('Accepted (Moscow)','Принято (Москва)'),$tr('File name','Имя файла'),$tr('File type','Тип файла'),$tr('Bytes','Байт'),$tr('Recognition status','Статус распознавания'),$tr('Quantity source','Источник количества'),$tr('Confirmed quantity','Подтверждённое количество'),$tr('Protected file link','Защищённая ссылка на файл')],'rows'=>$receiptRows,'widths'=>[35,35,35,26,34,22,22,22,26,26,34,24,14,28,24,28,30],'filter'=>true];
    $ticketRows=[];
    foreach ($data['tickets'] as $t) $ticketRows[] = [$t['ticket_id'],$t['entry_id'],$t['user_id'],$t['name'],$t['email'],$t['phone'],(int)$t['ordinal'],(int)$t['eligible'],$status($t['status']),$date($t['issued_at'])];
    $sheets[] = ['name'=>$tr('Tickets','Билеты'),'headers'=>[$tr('Ticket ID','ID билета'),$tr('Entry ID','ID заявки'),$tr('Participant ID','ID участника'),$tr('Name','Имя'),'Email',$tr('Phone','Телефон'),$tr('Ordinal','Номер в заявке'),$tr('Eligible (1/0)','Допущен (1/0)'),$tr('Entry status','Статус заявки'),$tr('Issued (Moscow)','Выдан (Москва)')],'rows'=>$ticketRows,'widths'=>[35,35,35,26,34,22,20,20,22,26],'filter'=>true];
    $winnerRows=[];
    foreach ($data['winners'] as $w) $winnerRows[] = [(int)$w['winner_id'],$w['prize'],(int)$w['prize_slot'],$w['ticket_id'],$w['entry_id'],$w['user_id'],$w['name'],$w['email'],$w['phone'],$status($w['mode']),$status($w['winner_status']),$date($w['assigned_at']),$w['reason'],$date($w['cancelled_at']),$w['cancellation_reason'],$w['return_to_pool']===null?null:(int)$w['return_to_pool']];
    $sheets[] = ['name'=>$tr('Winners','Победители'),'headers'=>[$tr('Assignment ID','ID назначения'),$tr('Prize','Приз'),$tr('Prize slot','Место приза'),$tr('Ticket ID','ID билета'),$tr('Entry ID','ID заявки'),$tr('Participant ID','ID участника'),$tr('Name','Имя'),'Email',$tr('Phone','Телефон'),$tr('Mode','Способ'),$tr('Assignment status','Статус назначения'),$tr('Assigned (Moscow)','Назначено (Москва)'),$tr('Assignment reason','Причина назначения'),$tr('Cancelled (Moscow)','Отменено (Москва)'),$tr('Cancellation reason','Причина отмены'),$tr('Returned to pool (1/0)','Возвращён в пул (1/0)')],'rows'=>$winnerRows,'widths'=>[20,30,18,35,35,35,26,34,22,24,25,26,45,26,45,26],'filter'=>true];
    return $sheets;
}

function campaign_export_routes(string $method, string $path): void
{
    if (!preg_match('~^/admin/workspace/([a-f0-9]{32})/export$~D', $path, $match)) return;
    $admin = need_admin();
    if ($method !== 'POST') fail(405, 'method_not_allowed');
    $file = null; $error = null; $pdo = db(); $previousAbort = null;
    try {
        $request = campaign_export_request(body());
        if (!class_exists('ZipArchive') || !class_exists('XMLWriter')) throw new CampaignExportException(503, 'xlsx_unavailable');
        // SET applies to the next transaction. No public file or mutable export job is stored.
        $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $pdo->beginTransaction();
        $snapshot = campaign_export_load($pdo, $match[1], $request);
        $file = tempnam(sys_get_temp_dir(), 'milano-xlsx-');
        if ($file === false) throw new RuntimeException('xlsx_temp_failed');
        $publicRoot = str_replace('\\', '/', (string)realpath(dirname(__DIR__))) . '/';
        $tempPath = str_replace('\\', '/', (string)realpath($file));
        if (str_starts_with(strtolower($tempPath), strtolower($publicRoot))) throw new RuntimeException('xlsx_temp_must_be_private');
        @chmod($file, 0600);
        // Also clean up on client disconnect or a fatal error that bypasses finally.
        register_shutdown_function(static function () use (&$file): void {
            if (is_string($file) && is_file($file)) unlink($file);
        });
        $previousAbort = ignore_user_abort(true);
        xlsx_write($file, campaign_export_sheets($snapshot, $request, (string)config()['app_url']));
        admin_audit((int)$admin['id'], 'data.export', 'campaign', (int)$snapshot['campaign']['id'], campaign_export_audit($snapshot, $request));
        $pdo->commit();
        $filename = 'milano-' . (int)$snapshot['campaign']['year'] . '-q' . (int)$snapshot['campaign']['quarter'] . '-' . $request['scope'] . '-' . gmdate('Ymd-His') . '.xlsx';
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($file));
        header('Cache-Control: private, no-store, max-age=0');
        header('Pragma: no-cache'); header('X-Content-Type-Options: nosniff');
        readfile($file);
    } catch (CampaignExportException $e) { $error = $e; }
    finally {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (is_string($file) && is_file($file)) unlink($file);
        if ($previousAbort !== null) ignore_user_abort((bool)$previousAbort);
    }
    if ($error) fail($error->getCode(), $error->error, $error->fields);
    exit;
}
