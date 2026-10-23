/* ============================================================================
   partage.js — téléchargement et partage : Excel, PDF, CSV, WhatsApp, Gmail, Outlook,
   partage natif (mobile), copie du résumé, impression.
   Principe : le fichier (Blob) est généré AVANT l'ouverture du lien de partage ; si le partage
   natif de fichiers n'existe pas, on télécharge le fichier puis on ouvre le lien.
   ========================================================================== */
(function () {
  'use strict';
  const CT = window.CT;
  const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };

  function contexte() {
    const e = CT.etat, vue = e.vue;
    if (vue === 'rgz') return { vue, mod: CT.rgz, titre: 'Tableau de bord ' + e.prioritaire, el: document.getElementById('view-rgz'), sujet: 'Tableau de bord ' + e.prioritaire + ' ' + CT.date.court(e.jourRef), nom: 'Tableau_de_bord_' + e.prioritaire + '_' + e.jourRef };
    if (vue === 'pointjour') return { vue, mod: CT.pointJour, titre: 'Point du jour', el: document.getElementById('view-pointjour'), sujet: 'Point du jour ' + (e.jourDu ? CT.periode.texte() : CT.date.court(e.jourRef)), nom: 'Point_du_jour_' + CT.periode.fichier() };
    if (vue === 'perf') return { vue, mod: CT.perf, titre: 'Performance partenaires', el: document.getElementById('view-perf'), sujet: 'Performance partenaires ' + CT.date.libelleMois(e.cle) + (CT.periode.perfPartielle() ? ' (' + CT.periode.perf() + ')' : ''), nom: 'Performance_partenaire_' + CT.periode.fichierPerf() };
    return { vue: 'dashboard', mod: CT.dashboard, titre: 'Tableau de bord', el: document.getElementById('view-dashboard'), sujet: 'Rapport souscriptions ' + CT.date.court(e.jourRef), nom: 'Rapport_souscriptions_' + e.jourRef };
  }
  const formatPJ = () => (document.getElementById('pj-format') || {}).value || 'xlsx';
  const garde = () => { if (!CT.etat.lignes.length) { CT.toast('Importez d\'abord un fichier de souscriptions.', 'warn'); return false; } return true; };

  /* ---------- PDF : capture de la vue (html2canvas) puis découpe en pages A4 paysage (jsPDF) ---------- */
  async function pdfBlob(ctx) {
    if (!window.html2canvas || !window.jspdf) throw new Error('Bibliothèques PDF non chargées (connexion requise).');
    const html = document.documentElement; html.classList.add('capture-light');
    try {
      CT.dashboard.refreshTheme && CT.dashboard.refreshTheme(); CT.perf.refreshTheme && CT.perf.refreshTheme();
      await new Promise((r) => setTimeout(r, 450)); // laisse Chart.js finir ses animations
      const canvas = await html2canvas(ctx.el, { scale: 1.4, backgroundColor: '#ffffff', useCORS: true, windowWidth: 1400, logging: false, onclone: (doc, el) => CT.couleursCompatibles(el) });
      const { jsPDF } = window.jspdf, pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const W = 297, H = 210, m = 8, topH = 14, imgW = W - 2 * m, k = imgW / canvas.width, pageH = Math.floor((H - m - topH) / k);
      let y = 0, page = 0;
      while (y < canvas.height) {
        if (page++) pdf.addPage();
        const h = Math.min(pageH, canvas.height - y), part = document.createElement('canvas');
        part.width = canvas.width; part.height = h; part.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        pdf.setFontSize(11); pdf.setTextColor(15, 44, 92); pdf.text('POWERGZ — ' + ctx.titre, m, 9);
        pdf.setFontSize(8); pdf.setTextColor(100, 116, 139); pdf.text(new Date().toLocaleString('fr-FR') + ' — page ' + page, W - m, 9, { align: 'right' });
        pdf.addImage(part.toDataURL('image/jpeg', 0.88), 'JPEG', m, topH, imgW, h * k);
        y += h;
      }
      return pdf.output('blob');
    } finally { html.classList.remove('capture-light'); CT.dashboard.refreshTheme && CT.dashboard.refreshTheme(); CT.perf.refreshTheme && CT.perf.refreshTheme(); }
  }
  async function fichier(format, ctx) {
    const blob = format === 'pdf' ? await pdfBlob(ctx) : CT.export.blobXlsx(ctx.mod.feuilles());
    return { blob, nom: ctx.nom + '.' + format, format };
  }
  /* Texte du message : titre + résumé des chiffres clés (tronqué pour respecter les limites des liens) */
  const message = (ctx, max = 1400) => { const t = ctx.titre + ' — ' + ctx.sujet + '\n\n' + ctx.mod.resume(); return t.length > max ? t.slice(0, max - 1) + '…' : t; };
  const ouvrir = (url) => { const w = window.open(url, '_blank'); if (w) { try { w.opener = null; } catch (e) {} } else CT.toast('Le navigateur a bloqué l\'ouverture : autorisez les pop-ups pour ce site.', 'warn', 7000); };

  /* Partage natif (Web Share API) du fichier : aucun téléchargement, la feuille de partage du système s'ouvre directement */
  async function natif(ctx, f) {
    const file = new File([f.blob], f.nom, { type: MIME[f.format] });
    if (!(navigator.canShare && navigator.canShare({ files: [file] }))) return false;
    try { await navigator.share({ files: [file], title: ctx.sujet, text: message(ctx) }); return true; }
    catch (err) { return !!(err && err.name === 'AbortError'); } // annulation par l'utilisateur = pas d'erreur
  }
  const peutPartagerFichiers = () => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.xlsx', { type: MIME.xlsx })] })); } catch (e) { return false; } };
  async function copierTexte(t) {
    try { await navigator.clipboard.writeText(t); }
    catch (e) { const ta = CT.h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  }

  /* WhatsApp / Gmail / Outlook : partage direct en ligne (aucun téléchargement forcé).
     - WhatsApp : fichier via le partage natif si l'appareil le permet, sinon lien wa.me avec le résumé ;
     - Gmail / Outlook : fenêtre de rédaction pré-remplie (sujet + résumé). Un lien ne peut pas joindre de fichier :
       utilisez les boutons Excel / PDF si une pièce jointe est nécessaire. */
  async function partagerVers(canal) {
    if (!garde()) return;
    const ctx = contexte(), texte = message(ctx);
    if (canal === 'whatsapp') {
      if (peutPartagerFichiers()) {
        try { const f = await fichier(formatPJ(), ctx); if (await natif(ctx, f)) return; } catch (err) { /* repli sur le lien */ }
      }
      ouvrir('https://wa.me/?text=' + encodeURIComponent(texte));
      CT.toast('WhatsApp ouvert avec le résumé du rapport.', 'ok', 4000); return;
    }
    const url = canal === 'gmail'
      ? 'https://mail.google.com/mail/?view=cm&fs=1&su=' + encodeURIComponent(ctx.sujet) + '&body=' + encodeURIComponent(texte)
      : 'https://outlook.office.com/mail/deeplink/compose?subject=' + encodeURIComponent(ctx.sujet) + '&body=' + encodeURIComponent(texte);
    ouvrir(url);
    CT.toast('Message ' + (canal === 'gmail' ? 'Gmail' : 'Outlook') + ' ouvert avec le résumé. Pour joindre le fichier, utilisez Excel ou PDF.', 'ok', 6000);
  }

  CT.partage = {
    contexte,
    async telecharger(format) {
      if (!garde()) return;
      const ctx = contexte();
      try {
        if (format === 'csv') { const d = ctx.mod.feuilles()[0]; CT.telecharger(CT.export.blobCsv(d), ctx.nom + '.csv'); }
        else { CT.toast(format === 'pdf' ? 'Génération du PDF…' : 'Génération du fichier Excel…', 'info', 2500); const f = await fichier(format, ctx); CT.telecharger(f.blob, f.nom); }
        CT.toast('Téléchargement prêt.', 'ok', 3000);
      } catch (err) { CT.toast('Échec : ' + err.message, 'err'); }
    },
    exportGlobal() {
      if (!garde()) return;
      try { CT.telecharger(CT.export.blobXlsx(CT.export.feuillesGlobales()), 'Rapport_global_' + CT.etat.jourRef + '.xlsx'); CT.toast('Export global téléchargé.', 'ok'); }
      catch (err) { CT.toast('Échec de l\'export : ' + err.message, 'err'); }
    },
    whatsapp: () => partagerVers('whatsapp'), gmail: () => partagerVers('gmail'), outlook: () => partagerVers('outlook'),
    /* Bouton « Partager » : feuille de partage du système (fichier si possible, sinon texte), sinon copie du résumé */
    async partagerNatif() {
      if (!garde()) return;
      const ctx = contexte();
      try {
        if (peutPartagerFichiers()) { const f = await fichier(formatPJ(), ctx); if (await natif(ctx, f)) return; }
        if (navigator.share) { await navigator.share({ title: ctx.sujet, text: message(ctx) }); return; }
      } catch (err) { if (err && err.name === 'AbortError') return; }
      await copierTexte(message(ctx, 4000));
      CT.toast('Le partage système n\'est pas disponible ici : le résumé a été copié, collez-le dans votre application.', 'warn', 7000);
    },
    async copier(texte) {
      if (texte == null && !garde()) return;
      await copierTexte(texte != null ? texte : contexte().mod.resume());
      CT.toast('Résumé copié dans le presse-papiers.', 'ok', 3000);
    },
    imprimer() { if (garde()) window.print(); },
  };
})();
