<?php
declare(strict_types=1);

/** Small OOXML writer. Strings are always inline strings, never formulas. */
function xlsx_text(mixed $value): string
{
    $text = (string) ($value ?? '');
    // Excel escapes literal _xHHHH_ sequences; protect those before XML encoding.
    $text = preg_replace('/_(x[0-9a-fA-F]{4}_)/', '_x005F_$1', $text) ?? '';
    $text = preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u', '', $text) ?? '';
    if (mb_strlen($text, 'UTF-8') > 32767) throw new RuntimeException('xlsx_cell_too_long');
    return $text;
}

function xlsx_column(int $index): string
{
    $name = '';
    do { $name = chr(65 + $index % 26) . $name; $index = intdiv($index, 26) - 1; } while ($index >= 0);
    return $name;
}

function xlsx_moscow_date(?string $utc): ?float
{
    if ($utc === null || $utc === '') return null;
    $date = DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $utc, new DateTimeZone('UTC'));
    if (!$date || $date->format('Y-m-d H:i:s') !== $utc) throw new RuntimeException('invalid_export_date');
    $local = $date->setTimezone(new DateTimeZone('Europe/Moscow'));
    // Excel dates have no timezone: save Moscow's wall-clock time as a date value.
    return ($local->getTimestamp() + $local->getOffset()) / 86400 + 25569;
}

function xlsx_xml_start(string $root, string $namespace): XMLWriter
{
    $xml = new XMLWriter();
    if (!$xml->openMemory()) throw new RuntimeException('xlsx_xml_failed');
    $xml->startDocument('1.0', 'UTF-8', 'yes');
    $xml->startElementNS(null, $root, $namespace);
    return $xml;
}

function xlsx_cell(XMLWriter $xml, string $ref, mixed $cell, int $defaultStyle = 0): void
{
    $data = is_array($cell) ? $cell : ['value' => $cell];
    $value = $data['value'] ?? null;
    $type = $data['type'] ?? (is_int($value) || is_float($value) ? 'number' : 'string');
    $style = isset($data['url']) ? 3 : ($type === 'date' ? 2 : $defaultStyle);
    $xml->startElement('c'); $xml->writeAttribute('r', $ref);
    if ($style) $xml->writeAttribute('s', (string) $style);
    if ($value !== null && $value !== '') {
        if ($type === 'date' || $type === 'number') {
            $number = $type === 'date' ? xlsx_moscow_date((string) $value) : $value;
            if (!is_numeric($number) || !is_finite((float) $number)) throw new RuntimeException('invalid_export_number');
            $xml->writeAttribute('t', 'n');
            $xml->writeElement('v', json_encode($number, JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR));
        } else {
            $xml->writeAttribute('t', 'inlineStr'); $xml->startElement('is'); $xml->startElement('t');
            $xml->writeAttribute('xml:space', 'preserve'); $xml->text(xlsx_text($value));
            $xml->endElement(); $xml->endElement();
        }
    }
    $xml->endElement();
}

function xlsx_sheet(array $sheet): array
{
    $namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    $xml = xlsx_xml_start('worksheet', $namespace);
    $xml->writeAttribute('xmlns:r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
    $columns = count($sheet['headers']);
    $rows = $sheet['rows'];
    if (!$columns || $columns > 16384 || count($rows) > 1048575) throw new RuntimeException('invalid_xlsx_size');
    $xml->startElement('dimension'); $xml->writeAttribute('ref', 'A1:' . xlsx_column($columns - 1) . (count($rows) + 1)); $xml->endElement();
    $xml->startElement('sheetViews'); $xml->startElement('sheetView'); $xml->writeAttribute('workbookViewId', '0');
    $xml->startElement('pane'); $xml->writeAttribute('ySplit', '1'); $xml->writeAttribute('topLeftCell', 'A2');
    $xml->writeAttribute('activePane', 'bottomLeft'); $xml->writeAttribute('state', 'frozen'); $xml->endElement();
    $xml->endElement(); $xml->endElement();
    $xml->startElement('sheetFormatPr'); $xml->writeAttribute('defaultRowHeight', '20'); $xml->endElement();
    $xml->startElement('cols');
    foreach ($sheet['headers'] as $index => $header) {
        $xml->startElement('col'); $xml->writeAttribute('min', (string) ($index + 1)); $xml->writeAttribute('max', (string) ($index + 1));
        $xml->writeAttribute('width', (string) ($sheet['widths'][$index] ?? 24)); $xml->writeAttribute('customWidth', '1'); $xml->endElement();
    }
    $xml->endElement(); $xml->startElement('sheetData');
    $links = [];
    foreach (array_merge([$sheet['headers']], $rows) as $r => $row) {
        $xml->startElement('row'); $xml->writeAttribute('r', (string) ($r + 1));
        if ($r === 0) { $xml->writeAttribute('ht', '34'); $xml->writeAttribute('customHeight', '1'); }
        foreach (array_values($row) as $c => $cell) {
            $ref = xlsx_column($c) . ($r + 1);
            xlsx_cell($xml, $ref, $cell, $r === 0 ? 1 : 0);
            if (is_array($cell) && isset($cell['url'])) {
                $url = (string) $cell['url'];
                if (!preg_match('~^https?://[^\s<>"\x00-\x1f]+$~D', $url)) throw new RuntimeException('invalid_xlsx_link');
                $links[] = ['ref' => $ref, 'url' => $url];
            }
        }
        $xml->endElement();
    }
    $xml->endElement();
    if (!empty($sheet['filter'])) {
        $xml->startElement('autoFilter'); $xml->writeAttribute('ref', 'A1:' . xlsx_column($columns - 1) . (count($rows) + 1)); $xml->endElement();
    }
    if ($links) {
        $xml->startElement('hyperlinks');
        foreach ($links as $i => $link) {
            $xml->startElement('hyperlink'); $xml->writeAttribute('ref', $link['ref']); $xml->writeAttribute('r:id', 'rId' . ($i + 1)); $xml->endElement();
        }
        $xml->endElement();
    }
    $xml->endElement(); $xml->endDocument();
    $content = $xml->outputMemory();
    $rels = xlsx_xml_start('Relationships', 'http://schemas.openxmlformats.org/package/2006/relationships');
    foreach ($links as $i => $link) {
        $rels->startElement('Relationship'); $rels->writeAttribute('Id', 'rId' . ($i + 1));
        $rels->writeAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink');
        $rels->writeAttribute('Target', $link['url']); $rels->writeAttribute('TargetMode', 'External'); $rels->endElement();
    }
    $rels->endElement(); $rels->endDocument();
    return [$content, $links ? $rels->outputMemory() : null];
}

function xlsx_styles(): string
{
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        . '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm:ss"/></numFmts>'
        . '<fonts count="3"><font><sz val="11"/><name val="Calibri"/><color rgb="FF252525"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFD27A"/></font><font><sz val="11"/><name val="Calibri"/><color rgb="FF805A16"/><u/></font></fonts>'
        . '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF151515"/><bgColor indexed="64"/></patternFill></fill></fills>'
        . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        . '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        . '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
        . '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
        . '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
        . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

function xlsx_write(string $path, array $sheets): void
{
    if (!class_exists('ZipArchive') || !class_exists('XMLWriter')) throw new RuntimeException('xlsx_unavailable');
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new RuntimeException('xlsx_create_failed');
    $ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    $types = xlsx_xml_start('Types', 'http://schemas.openxmlformats.org/package/2006/content-types');
    foreach (['rels'=>'application/vnd.openxmlformats-package.relationships+xml', 'xml'=>'application/xml'] as $ext => $mime) {
        $types->startElement('Default'); $types->writeAttribute('Extension', $ext); $types->writeAttribute('ContentType', $mime); $types->endElement();
    }
    foreach (['/xl/workbook.xml'=>'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', '/xl/styles.xml'=>'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'] as $part => $mime) {
        $types->startElement('Override'); $types->writeAttribute('PartName', $part); $types->writeAttribute('ContentType', $mime); $types->endElement();
    }
    $book = xlsx_xml_start('workbook', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'); $book->writeAttribute('xmlns:r', $ns); $book->startElement('sheets');
    $rels = xlsx_xml_start('Relationships', 'http://schemas.openxmlformats.org/package/2006/relationships');
    try {
        foreach (array_values($sheets) as $i => $sheet) {
            $id = $i + 1; $name = (string) ($sheet['name'] ?? '');
            if (!$name || mb_strlen($name) > 31 || preg_match('~[\\\\/\[\]:*?]~', $name)) throw new RuntimeException('invalid_xlsx_sheet_name');
            $book->startElement('sheet'); $book->writeAttribute('name', $name); $book->writeAttribute('sheetId', (string) $id); $book->writeAttribute('r:id', 'rId' . $id); $book->endElement();
            $rels->startElement('Relationship'); $rels->writeAttribute('Id', 'rId' . $id); $rels->writeAttribute('Type', $ns . '/worksheet'); $rels->writeAttribute('Target', 'worksheets/sheet' . $id . '.xml'); $rels->endElement();
            $types->startElement('Override'); $types->writeAttribute('PartName', '/xl/worksheets/sheet' . $id . '.xml'); $types->writeAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'); $types->endElement();
            [$xml, $links] = xlsx_sheet($sheet);
            if (!$zip->addFromString('xl/worksheets/sheet' . $id . '.xml', $xml)) throw new RuntimeException('xlsx_write_failed');
            if ($links !== null && !$zip->addFromString('xl/worksheets/_rels/sheet' . $id . '.xml.rels', $links)) throw new RuntimeException('xlsx_write_failed');
        }
        $rels->startElement('Relationship'); $rels->writeAttribute('Id', 'rIdStyles'); $rels->writeAttribute('Type', $ns . '/styles'); $rels->writeAttribute('Target', 'styles.xml'); $rels->endElement();
        $book->endElement(); $book->endElement(); $book->endDocument(); $rels->endElement(); $rels->endDocument(); $types->endElement(); $types->endDocument();
        $parts = ['xl/workbook.xml'=>$book->outputMemory(), 'xl/_rels/workbook.xml.rels'=>$rels->outputMemory(), '[Content_Types].xml'=>$types->outputMemory(), 'xl/styles.xml'=>xlsx_styles(), '_rels/.rels'=>'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' . $ns . '/officeDocument" Target="xl/workbook.xml"/></Relationships>'];
        foreach ($parts as $part => $content) if (!$zip->addFromString($part, $content)) throw new RuntimeException('xlsx_write_failed');
    } catch (Throwable $e) { $zip->close(); throw $e; }
    if (!$zip->close()) throw new RuntimeException('xlsx_close_failed');
}
