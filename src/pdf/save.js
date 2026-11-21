/* =====================================================================
   pdf/save.js — saving a PDF: build the file, say in plain words what was done (pdfReportText), offer it for
   sharing or download. And pdfInit(): the page buttons and whatever else only the installable build has.
   ===================================================================== */
/* why an edit went into the file as a picture and not as text. The keys are set in edit.js, write.js and build.js. */
/* why an edit went into the file as a picture and not as text, in the language in use now.
   (The keys are set in edit.js, write.js and build.js; an unknown key is shown as itself.) */
function pdfWhy(k) {
  const key = { image: 'whyImage', nested: 'whyNested', hidden: 'whyHidden', strip: 'whyStrip', ops: 'whyOps', annot: 'whyAnnot', overlap: 'whyOverlap', sysfont: 'whySysfont', synth: 'whySynth', glyph: 'whyGlyph', file: 'whyFile', font: 'whyFont', script: 'whyScript', soft: 'whySoft', look: 'whyLook' }[k];
  return key ? t(key) : k;
}
/* the report of pdfBuild() in words, for the save sheet */
function pdfReportText(r) {
  const pl = a => t('pagesList', { pages: a.join(t('listSep')) });
  if (r.whole) return (r.why === 'protected' ? t('reportWholeProtected') : t('reportWholeUnusual')) + t('reportWholeSuffix');
  if (r.flat) return t('reportFlat', { pages: pl(r.pages) });
  let out = t('reportStart', { pages: pl(r.pages) });
  const whys = Object.keys(r.why).map(k => pdfWhy(k));
  if (r.text && !r.pics) out += t('reportTextOnly');
  else if (r.text) out += t('reportTextAndPics', { text: r.text, pics: r.pics, whys: whys.join(t('listSepSemi')) });
  else out += t('reportPicsOnly', { dpi: r.dpi, whys: whys.length ? t('reportWhys', { whys: whys.join(t('listSepSemi')) }) : '' });
  if (r.covered) out += t('reportCovered', { pages: pl(r.coveredPages), n: r.covered });
  else if (!r.checked) out += t('reportUnchecked');
  else out += t('reportChecked');
  if (r.annots) out += t('reportAnnots', { n: r.annots });
  return out;
}

/* the save button, with a PDF open: build the file and show the sheet */
async function pdfSave() {
  const P = S.pdf;
  if (!P || PDFS.saving) return;
  if (S.edit && S.edit.live) commit('text', true);
  pdfStash();
  if (![...P.pages.values()].some(pg => pg.edits.length)) { toast(t('pdfNoEdits')); return; }
  const flat = $('pdfFlat').checked;
  PDFS.saving = true;
  $('sheetTitle').textContent = t('savePdfTitle'); $('saveNote').textContent = t('saveNotePdf');
  $('sheetHow').textContent = t('pdfGenerating');
  $('pdfOpts').hidden = false; $('sheetImg').parentElement.hidden = true;
  $('sheetShare').hidden = true; $('sheetLink').hidden = true;
  $('sheet').hidden = false;
  try {
    const out = await pdfBuild(flat);
    const blob = new Blob([out.bytes], { type: 'application/pdf' }), filename = P.name + t('fileSuffix') + '.pdf';
    if (PDFS.out) URL.revokeObjectURL(PDFS.out.url);
    PDFS.out = { url: URL.createObjectURL(blob), report: out.report, size: blob.size };
    const fl = findLeft();
    $('sheetHow').textContent = pdfReportText(out.report) + t('reportSize', { size: mb(blob.size) }) + (fl > 0 ? t('saveLeft', { q: P.find.q, left: fl }) : '');
    if (out.report.whole) { $('pdfFlat').checked = true; $('pdfFlat').disabled = true; }
    const file = typeof File === 'function' ? new File([blob], filename, { type: 'application/pdf' }) : null;
    let share = false;
    try { share = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { share = false; }
    $('sheetShare').hidden = !share; $('sheetShare').textContent = t('sharePdf');
    $('sheetShare').onclick = () => { navigator.share({ files: [file], title: filename }).catch(() => {}); };
    $('sheetLink').hidden = window.self !== window.top; $('sheetLink').textContent = t('downloadPdf');
    $('sheetLink').href = PDFS.out.url; $('sheetLink').download = filename;
  } catch (e) {
    const m = String((e && e.message) || e);
    $('sheetHow').textContent = m === 'protected' ? t('pdfSaveProtected') : m === 'unreadable' ? t('pdfSaveUnreadable') : t('pdfSaveError', { msg: m.slice(0, 80) });
  } finally { PDFS.saving = false; }
}

/* what the installable build has and the artifact does not: PDFs can be opened, pages can be turned */
function pdfInit() {
  if (BUILD !== 'pages') return;
  $('fileInput').accept = 'image/*,application/pdf,.pdf';
  $('btnOpen').textContent = t('openImagePdf');
  $('dropHint').textContent = t('dropHintPdf');
  $('pgPrev').onclick = () => { if (S.pdf) pdfGo(S.pdf.cur - 1); };
  $('pgNext').onclick = () => { if (S.pdf) pdfGo(S.pdf.cur + 1); };
  $('pgNum').onclick = () => { const P = S.pdf; if (!P || P.n < 2) return; const v = window.prompt(t('goToPagePrompt', { n: P.n }), String(P.cur)); if (v != null && +v >= 1) pdfGo(+v); };
  $('pdfFlat').onchange = () => { PDFS.out = null; pdfSave(); };
  for (const el of [$('pgPrev'), $('pgNext'), $('pgNum')]) el.addEventListener('pointerdown', e => e.stopPropagation());
}
