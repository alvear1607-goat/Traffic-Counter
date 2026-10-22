/* Núcleo de AforoVehicular: análisis, CSV y generación de Excel (.xlsx) sin librerías. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APPROACHES = [
    { k: 'NORTE', n: 'Norte' }, { k: 'SUR', n: 'Sur' },
    { k: 'ORIENTE', n: 'Oriente' }, { k: 'OCCIDENTE', n: 'Occidente' }
  ];
  const MOVES = [
    { k: 'IZQUIERDA', n: 'Izquierda', t: 'IZQUIERDA', icon: '⬅', color: '#1E88E5', fg: '#ffffff' },
    { k: 'FRENTE', n: 'Frente', t: 'DE FRENTE', icon: '⬆', color: '#43A047', fg: '#ffffff' },
    { k: 'DERECHA', n: 'Derecha', t: 'DERECHA', icon: '➡', color: '#FB8C00', fg: '#2b1700' }
  ];
  const VEHICLES = [
    { k: 'CARRO', n: 'Autos', h: 'Autos', icon: '🚗' },
    { k: 'BUS', n: 'Buses', h: 'Buses', icon: '🚌' },
    { k: 'MOTO', n: 'Motos', h: 'Motos', icon: '🏍️' },
    { k: 'CAMION', n: 'Camiones', h: 'Camiones', icon: '🚚' },
    { k: 'OTRO', n: 'Otro tipo', h: 'Otro Tipo', icon: '🚐' }
  ];
  const approachName = k => (APPROACHES.find(a => a.k === k) || { n: k }).n;
  const moveName = k => (MOVES.find(m => m.k === k) || { n: k }).n;
  const vehicleName = k => (VEHICLES.find(v => v.k === k) || { n: k }).n;

  const pct = (n, total) => (total === 0 ? 0 : Math.round(n * 100 / total));
  const sum = a => a.reduce((x, y) => x + y, 0);
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = t => { const d = new Date(t); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear(); };
  const fmtDay = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const fmtTime = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtFull = t => fmtDay(t) + ' ' + fmtTime(t) + ':' + pad(new Date(t).getSeconds());
  const stamp = t => { const d = new Date(t); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()); };
  const maxInterval = ev => ev.reduce((m, e) => Math.max(m, e.interval), 0);

  function intervalTotals(events, last, approach) {
    const t = new Array(last + 1).fill(0);
    events.forEach(e => { if ((!approach || e.approach === approach) && e.interval <= last) t[e.interval]++; });
    return t;
  }

  // ---------- Comentarios automáticos ----------
  function buildComments(events, im, current, running) {
    if (!events.length) return ['Aún no hay vehículos registrados. Los comentarios aparecerán al iniciar el conteo.'];
    const out = [];
    const total = events.length;
    const lastData = maxInterval(events);
    const totals = intervalTotals(events, Math.max(lastData, running ? current : 0));
    const partial = running && current === 0;
    const series = (running && current > 0) ? totals.slice(0, current) : totals;
    const seriesSum = sum(series);

    const rate = seriesSum * 60 / (series.length * im);
    out.push(`Se registraron ${total} vehículos. En ${series.length} intervalo(s) de ${im} min el flujo medio equivale a ≈ ${Math.round(rate)} veh/h.`);
    if (partial) out.push('Solo hay un intervalo en curso: los resultados son parciales.');

    let peakIdx = 0;
    series.forEach((v, i) => { if (v > series[peakIdx]) peakIdx = i; });
    out.push(`Mayor flujo: intervalo ${peakIdx + 1} (min ${peakIdx * im}–${(peakIdx + 1) * im}) con ${series[peakIdx]} vehículos (${pct(series[peakIdx], seriesSum)}% del total).`);

    if (im <= 30 && 60 % im === 0) {
      const n = 60 / im;
      if (series.length >= n) {
        let bestStart = 0, best = -1;
        for (let s = 0; s <= series.length - n; s++) {
          const w = sum(series.slice(s, s + n));
          if (w > best) { best = w; bestStart = s; }
        }
        const mx = Math.max(...series.slice(bestStart, bestStart + n));
        if (mx > 0) {
          const phf = best / (n * mx);
          const reading = phf >= 0.90 ? 'flujo muy uniforme dentro de la hora'
            : phf >= 0.80 ? 'flujo bastante uniforme'
            : phf >= 0.70 ? 'flujo variable, con cierta concentración en un intervalo'
            : 'picos marcados: la demanda se concentra en pocos intervalos';
          out.push(`Hora pico: intervalos ${bestStart + 1}–${bestStart + n} (min ${bestStart * im}–${(bestStart + n) * im}) con ${best} veh/h. FHP = ${phf.toFixed(2)} → ${reading}.`);
        }
      } else {
        out.push(`Para estimar hora pico y FHP se necesita al menos 1 hora de datos (${n} intervalos de ${im} min).`);
      }
    } else {
      out.push(`El FHP se calcula con intervalos de 15 min o menos; con ${im} min no es posible.`);
    }

    const byMov = MOVES.map(m => [m, events.filter(e => e.movement === m.k).length]);
    let top = byMov[0];
    byMov.forEach(x => { if (x[1] > top[1]) top = x; });
    out.push(`Movimiento predominante: ${top[0].n} (${pct(top[1], total)}%). Distribución: ` +
      byMov.map(x => `${x[0].n} ${pct(x[1], total)}%`).join(', ') + '.');

    const byApp = APPROACHES.map(a => [a, events.filter(e => e.approach === a.k).length]).filter(x => x[1] > 0);
    if (byApp.length === 1) out.push(`Solo se han registrado datos del acceso ${byApp[0][0].n}.`);
    else {
      let ta = byApp[0];
      byApp.forEach(x => { if (x[1] > ta[1]) ta = x; });
      out.push(`El acceso con más demanda es ${ta[0].n} (${pct(ta[1], total)}% del total).`);
    }

    APPROACHES.forEach(a => {
      const nA = events.filter(e => e.approach === a.k).length;
      const left = events.filter(e => e.approach === a.k && e.movement === 'IZQUIERDA').length;
      if (nA >= 20 && pct(left, nA) >= 25) {
        out.push(`En el acceso ${a.n} los giros a la izquierda son ${pct(left, nA)}%: podría convenir revisar si requieren fase protegida o bahía de giro.`);
      }
    });

    const cnt = {};
    VEHICLES.forEach(v => { cnt[v.k] = events.filter(e => e.vehicle === v.k).length; });
    const heavy = cnt.BUS + cnt.CAMION;
    out.push(`Composición: autos ${pct(cnt.CARRO, total)}%, motos ${pct(cnt.MOTO, total)}%, vehículos pesados ${pct(heavy, total)}%, otros ${pct(cnt.OTRO, total)}%.`);
    if (pct(heavy, total) >= 10) out.push(`La proporción de vehículos pesados (${pct(heavy, total)}%) es relevante y puede reducir la capacidad de la intersección.`);
    if (pct(cnt.MOTO, total) >= 30) out.push(`Alta participación de motocicletas (${pct(cnt.MOTO, total)}%).`);

    if (series.length >= 2) {
      const last = series[series.length - 1], prev = series[series.length - 2];
      if (prev > 0) {
        const ch = (last - prev) * 100 / prev;
        const word = Math.abs(ch) <= 10 ? 'estable' : ch > 0 ? 'creciente' : 'decreciente';
        out.push(`Tendencia ${word}: el último intervalo completo (${series.length}) tuvo ${last} vehículos, ${ch > 0 ? '+' : ''}${Math.round(ch)}% respecto al anterior (${prev}).`);
      }
    }
    return out;
  }

  // ---------- CSV ----------
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const SUMMARY_HEADER = 'sesion,aforista,zona,punto,fecha_estudio,intervalo_min,intervalo,minuto_inicio,minuto_fin,intervalo_completo,acceso,movimiento,vehiculo,cantidad';
  const EVENTS_HEADER = 'sesion,aforista,zona,punto,fecha_estudio,fecha_hora,intervalo,acceso,movimiento,vehiculo';

  function eventRows(s, ev) {
    const day = fmtDay(s.createdAt);
    return ev.map(e => [s.id, q(s.counter || ''), q(s.zone), q(s.site), day, fmtFull(e.time), e.interval + 1,
      approachName(e.approach), e.movement, vehicleName(e.vehicle)].join(','));
  }
  function summaryRows(s, ev, elapsedMs) {
    const day = fmtDay(s.createdAt), im = s.intervalMin;
    const groups = new Map();
    ev.forEach(e => {
      const key = [e.interval, e.approach, e.movement, e.vehicle].join('|');
      groups.set(key, (groups.get(key) || 0) + 1);
    });
    return [...groups.entries()]
      .map(([k, n]) => [k.split('|'), n])
      .sort((a, b) => Number(a[0][0]) - Number(b[0][0]))
      .map(([p, n]) => {
        const i = Number(p[0]);
        const complete = (i + 1) * im * 60000 <= elapsedMs ? 'SI' : 'NO';
        return [s.id, q(s.counter || ''), q(s.zone), q(s.site), day, im, i + 1, i * im, (i + 1) * im, complete,
          approachName(p[1]), p[2], vehicleName(p[3]), n].join(',');
      });
  }
  const csvText = (header, rows) => '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
  const csvSummary = (items) => csvText(SUMMARY_HEADER, items.flatMap(it => summaryRows(it.session, it.events, it.elapsedMs)));
  const csvEvents = (items) => csvText(EVENTS_HEADER, items.flatMap(it => eventRows(it.session, it.events)));

  // ---------- XLSX ----------
  const XS = { DEFAULT: 0, TITLE: 1, HEAD_GRAY: 2, HEAD_BLUE: 3, HEAD_GREEN: 4, HEAD_ORANGE: 5, NUM: 6, LABEL: 7, TOT_LABEL: 8, TOT_NUM: 9, WRAP: 10, HEAD_WHITE: 11 };

  function colName(c) {
    let n = c, s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  class XSheet {
    constructor(name) { this.name = name; this.cells = new Map(); this.merges = []; this.colWidths = new Map(); this.freezeRows = 0; this.freezeCols = 0; }
    put(r, c, cell) { if (!this.cells.has(r)) this.cells.set(r, new Map()); this.cells.get(r).set(c, cell); }
    text(r, c, t, s = 0) { this.put(r, c, { text: t, style: s }); }
    num(r, c, v, s = 0) { this.put(r, c, { num: v, style: s }); }
    blank(r, c, s) { this.put(r, c, { style: s }); }
    formula(r, c, f, v, s) { this.put(r, c, { num: v, formula: f, style: s }); }
    merge(r1, c1, r2, c2) { this.merges.push(colName(c1) + r1 + ':' + colName(c2) + r2); }
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  function sheetXml(s) {
    let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="' + NS + '"><sheetViews><sheetView workbookViewId="0">';
    if (s.freezeRows > 0 || s.freezeCols > 0) {
      const tl = colName(s.freezeCols + 1) + (s.freezeRows + 1);
      const pane = s.freezeRows > 0 && s.freezeCols > 0 ? 'bottomRight' : s.freezeRows > 0 ? 'bottomLeft' : 'topRight';
      x += '<pane' + (s.freezeCols > 0 ? ' xSplit="' + s.freezeCols + '"' : '') + (s.freezeRows > 0 ? ' ySplit="' + s.freezeRows + '"' : '') +
        ' topLeftCell="' + tl + '" activePane="' + pane + '" state="frozen"/>';
    }
    x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
    if (s.colWidths.size) {
      x += '<cols>';
      [...s.colWidths.keys()].sort((a, b) => a - b).forEach(c => { x += '<col min="' + c + '" max="' + c + '" width="' + s.colWidths.get(c) + '" customWidth="1"/>'; });
      x += '</cols>';
    }
    x += '<sheetData>';
    [...s.cells.keys()].sort((a, b) => a - b).forEach(r => {
      x += '<row r="' + r + '">';
      const row = s.cells.get(r);
      [...row.keys()].sort((a, b) => a - b).forEach(c => {
        const cell = row.get(c), ref = colName(c) + r, st = cell.style ? ' s="' + cell.style + '"' : '';
        if (cell.formula) {
          x += '<c r="' + ref + '"' + st + '><f>' + esc(cell.formula) + '</f>' + (cell.num != null ? '<v>' + cell.num + '</v>' : '') + '</c>';
        } else if (cell.text) {
          x += '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + esc(cell.text) + '</t></is></c>';
        } else if (cell.num != null) {
          x += '<c r="' + ref + '"' + st + '><v>' + cell.num + '</v></c>';
        } else {
          x += '<c r="' + ref + '"' + st + '/>';
        }
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (s.merges.length) x += '<mergeCells count="' + s.merges.length + '">' + s.merges.map(m => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>';
    return x + '</worksheet>';
  }

  const xf = (font, fill, border, h, wrap, v) =>
    '<xf numFmtId="0" fontId="' + font + '" fillId="' + fill + '" borderId="' + border + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
    '<alignment horizontal="' + h + '" vertical="' + (v || 'center') + '"' + (wrap ? ' wrapText="1"' : '') + '/></xf>';
  const fillXml = rgb => '<fill><patternFill patternType="solid"><fgColor rgb="FF' + rgb + '"/><bgColor indexed="64"/></patternFill></fill>';

  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + NS + '">' +
      '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts>' +
      '<fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      fillXml('D9D9D9') + fillXml('87CEEB') + fillXml('8EE08E') + fillXml('F8CBAD') + fillXml('F2F2F2') + '</fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      xf(2, 0, 0, 'left') + xf(1, 2, 1, 'center') + xf(1, 3, 1, 'center') + xf(1, 4, 1, 'center') + xf(1, 5, 1, 'center') +
      xf(0, 0, 1, 'center') + xf(0, 0, 1, 'center') + xf(1, 6, 1, 'center') + xf(1, 6, 1, 'center') +
      xf(0, 0, 0, 'left', true, 'top') + xf(1, 0, 1, 'center') + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }

  // ---------- ZIP (sin compresión) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function concat(chunks) {
    const total = chunks.reduce((a, c) => a + c.length, 0), out = new Uint8Array(total);
    let o = 0; chunks.forEach(c => { out.set(c, o); o += c.length; });
    return out;
  }
  function zipStore(entries) {
    const enc = new TextEncoder(), chunks = [], central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    entries.forEach(e => {
      const nameB = enc.encode(e.name), crc = crc32(e.data), size = e.data.length;
      const lh = new Uint8Array(30 + nameB.length), v = new DataView(lh.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
      v.setUint16(10, time, true); v.setUint16(12, date, true); v.setUint32(14, crc, true); v.setUint32(18, size, true);
      v.setUint32(22, size, true); v.setUint16(26, nameB.length, true); v.setUint16(28, 0, true); lh.set(nameB, 30);
      chunks.push(lh, e.data);
      const ch = new Uint8Array(46 + nameB.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true); cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true); cv.setUint32(24, size, true); cv.setUint16(28, nameB.length, true);
      cv.setUint32(42, offset, true); ch.set(nameB, 46);
      central.push(ch);
      offset += lh.length + size;
    });
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return concat([...chunks, ...central, end]);
  }

  function writeXlsx(sheets) {
    const enc = new TextEncoder();
    const files = [];
    const add = (name, content) => files.push({ name, data: enc.encode(content) });
    let ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
    sheets.forEach((_, i) => { ct += '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; });
    ct += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
    add('[Content_Types].xml', ct);
    add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    let wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS + '" xmlns:r="' + NS_R + '"><sheets>';
    sheets.forEach((s, i) => { wb += '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; });
    add('xl/workbook.xml', wb + '</sheets></workbook>');
    let rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    sheets.forEach((_, i) => { rels += '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; });
    rels += '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    add('xl/_rels/workbook.xml.rels', rels);
    add('xl/styles.xml', stylesXml());
    sheets.forEach((s, i) => add('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s)));
    return zipStore(files);
  }

  function sheetName(raw, used) {
    let base = String(raw).replace(/[\[\]:*?\/\\]/g, ' ').trim() || 'Hoja';
    if (base.length > 28) base = base.slice(0, 28).trim();
    let name = base, k = 2;
    while (used.has(name.toLowerCase())) { name = base + ' (' + k + ')'; k++; }
    used.add(name.toLowerCase());
    return name;
  }

  function tableSheet(name, s, ev, approach, elapsedMs) {
    const sh = new XSheet(name), im = s.intervalMin;
    const byTime = Math.ceil(elapsedMs / (im * 60000)) - 1;
    const last = Math.max(maxInterval(ev), byTime, 0);
    const data = ev.filter(e => !approach || e.approach === approach);
    sh.text(1, 1, 'Aforo vehicular · Zona: ' + s.zone + ' · Punto: ' + s.site + ' · Fecha: ' + fmtDate(s.createdAt) +
      (s.counter ? ' · Aforista: ' + s.counter : '') + ' · Acceso: ' + (approach ? approachName(approach) : 'Todos') +
      ' · Intervalos de ' + im + ' min', XS.TITLE);
    sh.merge(1, 1, 1, 17);
    sh.text(2, 1, 'Intervalo', XS.HEAD_WHITE); sh.blank(3, 1, XS.HEAD_WHITE); sh.merge(2, 1, 3, 1);
    sh.text(2, 2, 'Minutos', XS.HEAD_WHITE); sh.blank(3, 2, XS.HEAD_WHITE); sh.merge(2, 2, 3, 2);
    const mStyles = [XS.HEAD_BLUE, XS.HEAD_GREEN, XS.HEAD_ORANGE];
    MOVES.forEach((m, mi) => {
      const c0 = 3 + mi * 5;
      sh.text(2, c0, m.t, mStyles[mi]);
      for (let k = 1; k <= 4; k++) sh.blank(2, c0 + k, mStyles[mi]);
      sh.merge(2, c0, 2, c0 + 4);
      VEHICLES.forEach((v, vi) => sh.text(3, c0 + vi, v.h, XS.HEAD_WHITE));
    });
    const counts = new Map();
    data.forEach(e => { const k = e.interval + '|' + e.movement + '|' + e.vehicle; counts.set(k, (counts.get(k) || 0) + 1); });
    for (let i = 0; i <= last; i++) {
      const r = 4 + i;
      sh.num(r, 1, i + 1, XS.LABEL);
      sh.text(r, 2, (i * im) + '–' + ((i + 1) * im), XS.LABEL);
      MOVES.forEach((m, mi) => VEHICLES.forEach((v, vi) => {
        sh.num(r, 3 + mi * 5 + vi, counts.get(i + '|' + m.k + '|' + v.k) || 0, XS.NUM);
      }));
    }
    const tr = 4 + last + 1;
    sh.text(tr, 1, 'TOTAL', XS.TOT_LABEL); sh.blank(tr, 2, XS.TOT_LABEL); sh.merge(tr, 1, tr, 2);
    for (let c = 3; c <= 17; c++) {
      const m = MOVES[Math.floor((c - 3) / 5)], v = VEHICLES[(c - 3) % 5];
      const total = data.filter(e => e.movement === m.k && e.vehicle === v.k).length;
      const col = colName(c);
      sh.formula(tr, c, 'SUM(' + col + '4:' + col + (tr - 1) + ')', total, XS.TOT_NUM);
    }
    sh.colWidths.set(1, 11); sh.colWidths.set(2, 11);
    for (let c = 3; c <= 17; c++) sh.colWidths.set(c, 10.5);
    sh.freezeRows = 3; sh.freezeCols = 2;
    return sh;
  }

  function notesSheet(s, ev, notes, elapsedMs, running) {
    const sh = new XSheet('Análisis y notas');
    const current = Math.floor(elapsedMs / (s.intervalMin * 60000));
    sh.colWidths.set(1, 120);
    sh.text(1, 1, 'ANÁLISIS AUTOMÁTICO', XS.TITLE);
    const comments = buildComments(ev, s.intervalMin, current, running);
    comments.forEach((c, i) => sh.text(2 + i, 1, '• ' + c, XS.WRAP));
    let r = 2 + comments.length + 1;
    sh.text(r, 1, 'OBSERVACIONES DEL AFORISTA', XS.TITLE); r++;
    if (!notes.length) sh.text(r, 1, '(sin observaciones)', XS.WRAP);
    notes.forEach(n => { sh.text(r, 1, 'Intervalo ' + (n.interval + 1) + ' (' + fmtTime(n.time) + '): ' + n.text, XS.WRAP); r++; });
    return sh;
  }

  function sessionXlsx(s, ev, notes, elapsedMs, running) {
    const used = new Set(), sheets = [];
    sheets.push(tableSheet(sheetName('TODOS', used), s, ev, null, elapsedMs));
    APPROACHES.filter(a => ev.some(e => e.approach === a.k)).forEach(a => sheets.push(tableSheet(sheetName(a.n, used), s, ev, a.k, elapsedMs)));
    const ns = notesSheet(s, ev, notes, elapsedMs, running);
    used.add(ns.name.toLowerCase());
    sheets.push(ns);
    return writeXlsx(sheets);
  }
  function allXlsx(items) {
    const used = new Set();
    return writeXlsx(items.map(it => tableSheet(sheetName(it.session.id + '-' + it.session.zone, used), it.session, it.events, null, it.elapsedMs)));
  }

  const safe = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 24) || 'x';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /** Archivos de un conteo: tabla Excel + resumen CSV + eventos CSV. */
  function sessionFiles(s, ev, notes, elapsedMs, running, nowMs) {
    const base = 'Aforo_' + safe(s.zone) + '_' + safe(s.site) + '_' + s.id + '_' + stamp(nowMs);
    const item = [{ session: s, events: ev, elapsedMs }];
    return [
      { name: base + '_tabla.xlsx', mime: XLSX_MIME, data: sessionXlsx(s, ev, notes, elapsedMs, running) },
      { name: base + '_resumen_por_intervalo.csv', mime: 'text/csv', data: csvSummary(item) },
      { name: base + '_eventos.csv', mime: 'text/csv', data: csvEvents(item) }
    ];
  }
  /** Archivos de todos los conteos: una hoja por conteo + CSV unidos. */
  function allFiles(items, nowMs) {
    const base = 'Aforo_TODOS_' + stamp(nowMs);
    return [
      { name: base + '_tablas.xlsx', mime: XLSX_MIME, data: allXlsx(items) },
      { name: base + '_resumen_por_intervalo.csv', mime: 'text/csv', data: csvSummary(items) },
      { name: base + '_eventos.csv', mime: 'text/csv', data: csvEvents(items) }
    ];
  }

  return {
    APPROACHES, MOVES, VEHICLES, approachName, moveName, vehicleName, pct, sum, pad, fmtDate, fmtTime, fmtDay, fmtFull, stamp,
    intervalTotals, buildComments, csvSummary, csvEvents, sessionFiles, allFiles, sessionXlsx, allXlsx, writeXlsx, safe, maxInterval
  };
});
