/* =====================================================================
   app/read.js — reading the original text of a selection, so that nobody has to type it. Whichever comes first:
     on a PDF page    the file itself says what is written there (pdf/edit.js): exact, nothing is read
     inside Claude    the viewer's own Claude reads a cut-out of the picture (recognize)
     anywhere else    the reader built into the page does, on the device (readLocal → reader/)
   What was read goes into 原文字 only while the user has not typed there; ed.ocr remembers what came from reading.
   ===================================================================== */
/* what Claude is asked */
const OCR_PROMPT = 'The attached image is a crop from a larger picture, shown on a plain frame. It contains one short piece of text ' +
  '(Chinese, English, digits, or a mix; one or several lines). Transcribe exactly what is written, character by character: ' +
  'keep capitalisation, digits, symbols and punctuation as they appear (full-width punctuation stays full-width); ' +
  'do not translate, correct, complete or guess words that are not there. ' +
  'Put one space wherever two parts of a line are separated by a clearly visible gap, and none between adjacent Chinese characters. ' +
  'Separate lines with \\n. Reply with only JSON of the form {"text": "..."}; if nothing is readable reply {"text": ""}.';
/* the box with some margin, enlarged so a line of text is about 100px tall, on a frame that is never a thin strip */
function ocrCrop(ed) {
  const u = ed.userRect, an = ed.an;
  const src = clampRect({ x: u.x - u.h * 0.3 - 4, y: u.y - u.h * 0.2 - 4, w: u.w + u.h * 0.6 + 8, h: u.h + u.h * 0.4 + 8 });
  const hs = ed.bands.map(b => b.y1 - b.y0).sort((p, q) => p - q);
  const lineH = hs.length ? hs[hs.length >> 1] : src.h * 0.6;
  const k = Math.min(clamp(100 / lineH, 0.4, 6), 1400 / src.w, 1400 / src.h);
  const cw = Math.max(8, Math.round(src.w * k)), ch = Math.max(8, Math.round(src.h * k));
  const W = Math.max(cw + 64, 360), H = Math.max(ch + 64, 240, Math.round(W / 5));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = rgbHex(an.bgColor); x.fillRect(0, 0, W, H);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  restoreLive();
  x.drawImage(S.img, src.x, src.y, src.w, src.h, Math.round((W - cw) / 2), Math.round((H - ch) / 2), cw, ch);
  renderLive();
  return new Promise(res => c.toBlob(res, 'image/png'));
}
/* Read the original text of a fresh selection. Inside Claude the viewer's own Claude reads it; anywhere else
   (a shared link in a browser) the page's own reader does, entirely on the device. */
/* force: the user pressed 识别/重读 — retry a reader that failed to start, overwrite what is in the field,
   and when the reader is unsure, still put its best guess there for the user to correct */
async function readText(ed, force) {
  /* a PDF page knows its own text: no reading needed, and no guessing */
  const pr = S.pdf ? pdfReadEdit(ed) : null;
  if (pr && (force || !ed.origText)) {
    const mirror = !ed.newText || ed.newText === ed.origText;
    ed.ocr = { tier: 'pdf', text: pr.text, reread: true };
    ed.varDone = true; ed.pdfHint = pr.hint; ed.pdfFam = pr.fam; ed.pdfLines = pr.lines; ed.pdfAlt = false;
    if (mirror) { ed.newText = ''; $('inNew').value = ''; }
    setOrig(pr.text, true);
    return;
  }
  await Promise.race([S.sampleReady, new Promise(r => setTimeout(r, 1500))]);
  if (S.edit !== ed) return;
  if (S.sample) { recognize('quick'); return; }
  const fail = () => setStatus(t('ocrFailStart', { reason: OCR.err || t('ocrUnknown') }), true);
  if (OCR.failed) {
    if (!force) { if (!ed.origText) fail(); return; }
    OCR.p = null; OCR.failed = false; OCR.err = '';
  }
  $('btnOcr').disabled = true;
  try {
    const r = await readLocal(ed);
    if (S.edit !== ed) return;
    const untouched = force || !ed.origText || (ed.ocr && ed.origText === ed.ocr.text);
    const guess = force && r && !r.text && r.raw ? r.raw : '';
    if (guess) {
      const mirror = !ed.newText || ed.newText === ed.origText;
      ed.ocr = { tier: 'local', text: guess, reread: true, conf: r.conf, maybe: [], slots: [], doubt: true };
      ed.varDone = false;
      if (mirror) { ed.newText = ''; $('inNew').value = ''; }
      setOrig(guess, true);
      setStatus(t('ocrDoubtFilled'), true);
    } else if (r && r.text && untouched && (force || r.text !== ed.origText)) {
      const mirror = !ed.newText || ed.newText === ed.origText;
      ed.ocr = { tier: 'local', text: r.text, reread: false, conf: r.conf, maybe: r.maybe, slots: r.slots };
      ed.varDone = false;
      if (mirror) { ed.newText = ''; $('inNew').value = ''; }
      setOrig(r.text, true);
    } else if (!ed.origText) {
      if (OCR.failed) fail();
      else setStatus(r && r.raw ? t('ocrUnreadable') : t('ocrNoText'), true);
    } else setStatus('');
  } finally { $('btnOcr').disabled = false; refresh(); }
}

/* ask Claude to read the selection. tier: 'quick' for the first reading, 'default' (a stronger model) for a second look */
async function recognize(tier) {
  const ed = S.edit;
  if (!ed || !S.sample) return;
  tier = tier || 'quick';
  const blob = await ocrCrop(ed);
  if (!blob || S.edit !== ed) return;
  setStatus(tier === 'quick' ? t('ocrReadingBox') : t('ocrRereading'));
  $('btnOcr').disabled = true;
  try {
    const out = await S.sample.json(OCR_PROMPT, { images: [blob], modelTier: tier, cache: tier === 'quick' });
    if (S.edit !== ed) return;
    const text = out && typeof out.text === 'string' ? out.text.replace(/\r/g, '').split('\n').map(t => t.trim()).filter(Boolean).join('\n') : '';
    const untouched = !ed.origText || (ed.ocr && ed.origText === ed.ocr.text);   // empty, or still exactly what was read before
    if (!text) { if (!ed.origText) setStatus(t('ocrNotRecognised'), true); else setStatus(''); }
    else if (untouched && text !== ed.origText) {
      const mirror = !ed.newText || ed.newText === ed.origText;
      const again = !!ed.origText;
      ed.ocr = { tier, text, reread: tier !== 'quick' || !!(ed.ocr && ed.ocr.reread) };
      if (mirror) { ed.newText = ''; $('inNew').value = ''; }
      setOrig(text, true);
      if (again) toast(t('ocrRereadChanged'));
    } else {
      if (ed.ocr) ed.ocr.reread = ed.ocr.reread || tier !== 'quick';
      const auto = ed.ocr && ed.ocr.auto;
      if (ed.ocr) ed.ocr.auto = false;
      setStatus(tier === 'quick' || auto ? '' : t('ocrSameResult'));
    }
  } catch (e) {
    if (S.edit !== ed) return;
    const code = e && e.code;
    if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed' || code === 'images_unavailable') {
      S.sample = null;
      if (!ed.origText) { readText(ed); return; }
      setStatus('');
    } else if (code === 'rate_limited') setStatus(t('ocrRateLimited'), true);
    else if (!ed.origText) setStatus(t('ocrFailed2'), true);
    else setStatus('');
  } finally { $('btnOcr').disabled = false; }
}
/* read the selection on the device; null when the reader cannot run */
async function readLocal(ed) {
  const ok = await ocrLoad(msg => { if (S.edit === ed) setStatus(ocrProgressText(msg)); });
  if (!ok || S.edit !== ed) return null;
  setStatus(t('ocrReadingOut'));
  await tick(); await tick();
  if (S.edit !== ed) return null;
  return ocrReadLines(ed.an, ed.bands);
}
/* a picture is open and Claude is not there to read it: get the built-in reader ready in the background */
function warmReader() { if (!S.sample && !OCR.p) Promise.race([S.sampleReady, new Promise(r => setTimeout(r, 1500))]).then(() => { if (!S.sample) ocrLoad(); }); }
