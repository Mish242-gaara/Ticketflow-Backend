const PDFDocument = require('pdfkit');

/**
 * Génère un PDF de ticket professionnel
 */
async function generateTicketPDF(ticket, event, category) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [595, 280], margin: 0 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Background
    doc.rect(0, 0, 595, 280).fill('#0D1B2E');

    // Left accent bar
    doc.rect(0, 0, 6, 280).fill('#C0392B');

    // Right stub separator (dashed)
    doc.save();
    doc.dash(5, { space: 4 });
    doc.moveTo(430, 20).lineTo(430, 260).stroke('#FFFFFF40');
    doc.restore();

    // EVENT TITLE
    doc.fillColor('#FFFFFF')
       .font('Helvetica-Bold')
       .fontSize(22)
       .text(event.title, 30, 30, { width: 380 });

    // Organizer
    doc.fillColor('#AAAAAA')
       .font('Helvetica')
       .fontSize(10)
       .text(`Organisé par ${event.organizer || 'BDE ESTAM'}`, 30, 65);

    // Divider
    doc.moveTo(30, 85).lineTo(410, 85).stroke('#FFFFFF20');

    // Event details
    const details = [
      { icon: '📅', label: 'Date', value: new Date(event.date).toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
      { icon: '⏰', label: 'Heure', value: new Date(event.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) },
      { icon: '📍', label: 'Lieu', value: event.location },
    ];

    details.forEach((d, i) => {
      const y = 100 + i * 28;
      doc.fillColor('#AAAAAA').font('Helvetica').fontSize(9).text(d.label.toUpperCase(), 30, y);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11).text(d.value, 90, y - 1, { width: 320 });
    });

    // Holder info
    doc.moveTo(30, 190).lineTo(410, 190).stroke('#FFFFFF20');
    doc.fillColor('#AAAAAA').font('Helvetica').fontSize(9).text('PARTICIPANT', 30, 200);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(13).text(ticket.holder_name || 'Participant', 30, 213);
    if (ticket.holder_phone) {
      doc.fillColor('#AAAAAA').font('Helvetica').fontSize(10).text(ticket.holder_phone, 30, 230);
    }

    // Category badge
    const catColor = category?.color || '#3B82F6';
    doc.roundedRect(30, 248, 120, 22, 4).fill(catColor);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
       .text(category?.name || 'Standard', 35, 254, { width: 110, align: 'center' });

    // RIGHT STUB
    // QR Code
    if (ticket.qr_code) {
      try {
        const qrBuffer = Buffer.from(ticket.qr_code.replace(/^data:image\/png;base64,/, ''), 'base64');
        doc.image(qrBuffer, 445, 20, { width: 120, height: 120 });
      } catch (e) { /* skip qr if error */ }
    }

    // UUID
    doc.fillColor('#AAAAAA').font('Helvetica').fontSize(7)
       .text('N° TICKET', 440, 150, { align: 'center', width: 140 });
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8)
       .text(ticket.ticket_uuid.slice(0, 16).toUpperCase(), 440, 162, { align: 'center', width: 140 });

    // ADMIT ONE
    doc.fillColor('#C0392B').font('Helvetica-Bold').fontSize(11)
       .text('ADMIT ONE', 440, 195, { align: 'center', width: 140 });
    doc.fillColor('#AAAAAA').font('Helvetica').fontSize(8)
       .text('Valide pour 1 personne', 440, 210, { align: 'center', width: 140 });

    // Price
    const price = parseFloat(category?.price) === 0 ? 'GRATUIT' : `${parseInt(category?.price).toLocaleString()} FCFA`;
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(14)
       .text(price, 440, 235, { align: 'center', width: 140 });

    doc.end();
  });
}

module.exports = { generateTicketPDF };
