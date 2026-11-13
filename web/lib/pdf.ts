import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtStamp, Report, statusLabel } from './report';

type RGB = [number, number, number];
const BAND_FILL: Record<string, RGB> = {
  GREEN: [220, 252, 231], PURPLE: [243, 232, 255], PINK: [252, 231, 243],
};
const HEAD: RGB = [17, 24, 39];
const MARGIN = 40;

const lastY = (doc: jsPDF) => (doc as any).lastAutoTable?.finalY ?? MARGIN;

export function reportFileName(r: Report): string {
  const slug = r.eventName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
  return `slot-report-${slug}-${r.generatedAt.slice(0, 10)}.pdf`;
}

/** Builds the schedule report as a PDF (A4 portrait). Plain ASCII text only (standard PDF fonts). */
export function buildReportPdf(r: Report): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(17, 24, 39);
  doc.text('Performance slot report', MARGIN, 48);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(75, 85, 99);
  doc.text(`${r.eventName}${r.venue ? ' - ' + r.venue : ''}`, MARGIN, 66);
  doc.text(`Generated ${fmtStamp(r.generatedAt)}  |  ${r.slotMinutes}-minute segments`, MARGIN, 82);

  // summary
  const t = r.totals;
  autoTable(doc, {
    startY: 98, theme: 'grid', styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fillColor: HEAD }, margin: { left: MARGIN, right: MARGIN },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 150 }, 2: { fontStyle: 'bold', cellWidth: 150 } },
    body: [
      ['Segments assigned', `${t.assigned} of ${t.slots} (${t.percent}%)`, 'Groups with active requests', String(t.groups)],
      ['Segments free', String(t.free), 'Active requests', String(t.activeRequests)],
      ['Segments still needed', String(t.segmentsStillNeeded), 'Payment paid / pending', `${t.paid} / ${t.pending}`],
      ['Request status', {
        content: Object.entries(t.byStatus).map(([k, v]) => `${statusLabel(k)}: ${v}`).join(', ') || '-',
        colSpan: 3,
      }],
    ],
  });

  // one section per day
  for (const day of r.days) {
    let y = lastY(doc) + 26;
    if (y > pageH - 130) { doc.addPage(); y = MARGIN + 10; }
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(17, 24, 39);
    doc.text(`${day.label} ${day.date}`.trim(), MARGIN, y);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(75, 85, 99);
    const bandText = day.bands.map((b) => `${b.band} ${b.assigned}/${b.total}`).join('   ');
    doc.text(`${day.assigned} of ${day.total} segments assigned (${day.percent}%)   |   ${bandText}`, MARGIN, y + 15);

    if (day.entries.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.text('No segments assigned yet.', MARGIN, y + 34);
      (doc as any).lastAutoTable = { finalY: y + 34 };
      continue;
    }
    autoTable(doc, {
      startY: y + 24, theme: 'grid', styles: { fontSize: 9.5, cellPadding: 4 },
      headStyles: { fillColor: HEAD }, margin: { left: MARGIN, right: MARGIN },
      head: [['Time', 'Band', 'Group', 'Act', 'Segs', 'Payment']],
      body: day.entries.map((e) => [
        `${e.start} - ${e.end}`, e.bands, e.group, e.act, String(e.segments), e.payment,
      ]),
      columnStyles: { 0: { cellWidth: 82 }, 1: { cellWidth: 96 }, 4: { cellWidth: 36, halign: 'center' }, 5: { cellWidth: 56 } },
      didParseCell: (d) => {
        if (d.section !== 'body') return;
        const entry = day.entries[d.row.index];
        const fill = BAND_FILL[entry.bands.split(' / ')[0]];
        if (fill && d.column.index <= 1) d.cell.styles.fillColor = fill;
        if (d.column.index === 5 && entry.payment !== 'paid') d.cell.styles.textColor = [180, 83, 9];
      },
    });
  }

  // requests still waiting
  let y = lastY(doc) + 26;
  if (y > pageH - 110) { doc.addPage(); y = MARGIN + 10; }
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(17, 24, 39);
  doc.text('Requests still waiting for slots', MARGIN, y);
  if (r.waiting.length === 0) {
    doc.setFont('helvetica', 'italic').setFontSize(10).setTextColor(75, 85, 99);
    doc.text('None - every active request is fully assigned.', MARGIN, y + 16);
  } else {
    autoTable(doc, {
      startY: y + 10, theme: 'grid', styles: { fontSize: 9.5, cellPadding: 4 },
      headStyles: { fillColor: HEAD }, margin: { left: MARGIN, right: MARGIN },
      head: [['Group', 'Email', 'Status', 'Assigned / requested', 'Payment']],
      body: r.waiting.map((w) => [w.group, w.email, statusLabel(w.status), `${w.assigned} / ${w.requested}`, w.payment]),
      columnStyles: { 3: { halign: 'center', cellWidth: 100 }, 4: { cellWidth: 56 } },
    });
  }

  // footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(107, 114, 128);
    doc.text(`${r.eventName} - generated ${fmtStamp(r.generatedAt)}`, MARGIN, pageH - 20);
    doc.text(`Page ${i} of ${pages}`, pageW - MARGIN, pageH - 20, { align: 'right' });
  }
  return doc;
}
