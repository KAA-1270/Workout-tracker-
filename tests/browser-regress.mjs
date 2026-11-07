import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PORT = 8765;
const URL = `http://127.0.0.1:${PORT}/index.html`;
const ART = '/opt/cursor/artifacts';
fs.mkdirSync(ART, { recursive: true });

function eq(actual, expected, msg) {
  assert.equal(actual, expected, (msg ? msg + '\n' : '') + 'actual ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected));
}

function waitForServer() {
  const deadline = Date.now() + 8000;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = net.connect(PORT, '127.0.0.1');
      const fail = () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error('dev server did not start'));
        else setTimeout(tick, 100);
      };
      socket.once('connect', () => { socket.end(); resolve(); });
      socket.once('error', fail);
    };
    tick();
  });
}

async function replaceNumber(page, selector, text) {
  const loc = page.locator(selector);
  await loc.scrollIntoViewIfNeeded();
  await loc.click({ clickCount: 3 });
  if (text === '') await page.keyboard.press('Backspace');
  else await page.keyboard.type(text);
  const activeId = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return document.activeElement === el ? el.id : (document.activeElement && document.activeElement.id);
  }, selector);
  return activeId;
}

async function showDay(page, day) {
  await page.locator(`button[data-d="${day}"]`).click();
}

async function setDate(page, selector, value) {
  await page.locator(selector).fill(value);
  await page.locator(selector).evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
}

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore'
});

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  await waitForServer();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(URL);
  const fixture = await page.evaluate(() => {
    const base = JSON.parse(JSON.stringify(D));
    delete base.drafts;
    base.extraKeep = 'yes-preserve';
    base.v = 3;
    base.logs.push({
      id: 'old-hinge',
      ex: 'hipthrust',
      date: '2026-10-01',
      note: 'hinge-history',
      sets: [{ w: 40, r: 10 }, { w: 45, r: 8 }, { w: 45, r: 8 }],
      target: 12
    });
    base.food.push({ id: 'keepfood', date: '2026-10-02', label: 'Eggs', kcal: 200, p: 20, c: 1, f: 10 });
    base.cardio.push({ date: '2026-10-03', machine: 'Incline walk', min: 12, incline: 8, speed: 4.5 });
    base.body.weighins.push({ id: 'keepw', date: '2026-10-04', w: 100 });
    return JSON.stringify(base);
  });
  await page.evaluate((s) => localStorage.setItem('liftlogger.v1', s), fixture);
  await page.reload();
  eq(await page.evaluate(() => localStorage.getItem('liftlogger.v1')), fixture, 'existing storage rewritten on load');
  await page.reload();
  eq(await page.evaluate(() => localStorage.getItem('liftlogger.v1')), fixture, 'existing storage rewritten on reload without edits');
  eq(await page.locator('#savestatus').innerText(), 'Saved on this device');
  eq(errors.length, 0, errors.join('\n'));

  const sessionDate = await page.locator('#dt').inputValue();
  const preservedStart = await page.evaluate(() => ({
    extra: D.extraKeep,
    v: D.v,
    hinge: D.logs.find((l) => l.id === 'old-hinge'),
    food: D.food.find((f) => f.id === 'keepfood'),
    cardio: D.cardio.find((c) => c.date === '2026-10-03'),
    weigh: D.body.weighins.find((w) => w.id === 'keepw'),
    oldIncline: D.logs.find((l) => l.ex === 'incline' && l.date === '2026-11-02'),
    scanIds: D.body.scans.map((s) => s.id)
  }));
  eq(preservedStart.v, 3);
  eq(preservedStart.hinge.ex, 'hipthrust');
  eq(preservedStart.hinge.note, 'hinge-history');

  const logsBeforeNav = await page.evaluate(() => JSON.stringify(D.logs));
  await showDay(page, 'U1');
  await showDay(page, 'L1');
  await showDay(page, 'U2');
  await showDay(page, 'L2');
  eq(await page.evaluate(() => JSON.stringify(D.logs)), logsBeforeNav, 'switching days created logs');
  eq(await page.evaluate((d) => D.logs.filter((l) => l.ex === 'hacksquat' && l.date === d).length, sessionDate), 0);

  const ids = await page.evaluate(() => EX.filter((e) => e.day === 'L2').map((e) => e.id));
  assert.deepEqual(ids, ['hacksquat', 'legcurl', 'standcalf', 'outer', 'abs']);
  const names = await page.locator('#main .card h3').allTextContents();
  eq(names[0], 'Super Hack Squat');
  eq(names[1], 'Seated Leg Curl');
  assert.ok(names.includes('Outer Thighs (Abductor)'));
  assert.ok(names.includes('Standing Calf Raise'));
  assert.ok(names.includes('Abs Machine'));
  assert.ok(!names.some((n) => /Hip Thrust|Pull-Through|RDL/i.test(n)));
  eq(await page.getAttribute('#c-hacksquat a.vid', 'href'), 'https://www.panattasport.com/en/free-weight-special/super-hack-squat/');
  const cue = await page.evaluate(() => EX.find((e) => e.id === 'hacksquat').cue);
  assert.match(cue, /quad/i);
  assert.match(cue, /glute/i);
  assert.match(cue, /leg curl/i);
  assert.match(cue, /8 to 12/);
  assert.doesNotMatch(cue, /RDL|equivalent|pull-through|hip thrust/i);

  const attrs = await page.evaluate(() => {
    const w = document.querySelector('#w-hacksquat-0');
    const r = document.querySelector('#r-hacksquat-0');
    return {
      htmlLang: document.documentElement.lang,
      htmlDir: document.documentElement.dir,
      wLang: w.lang,
      wMode: w.getAttribute('inputmode'),
      wDir: w.getAttribute('dir'),
      wStep: w.getAttribute('step'),
      wType: w.type,
      wLabel: document.querySelector('label[for="w-hacksquat-0"]').textContent,
      rLang: r.lang,
      rMode: r.getAttribute('inputmode'),
      rDir: r.getAttribute('dir'),
      rLabel: document.querySelector('label[for="r-hacksquat-0"]').textContent
    };
  });
  eq(attrs.htmlLang, 'en');
  eq(attrs.htmlDir, 'ltr');
  eq(attrs.wLang, 'en');
  eq(attrs.wMode, 'decimal');
  eq(attrs.wDir, 'ltr');
  eq(attrs.wStep, '0.5');
  eq(attrs.wType, 'number');
  eq(attrs.wLabel, 'kg');
  eq(attrs.rLang, 'en');
  eq(attrs.rMode, 'numeric');
  eq(attrs.rDir, 'ltr');
  assert.match(attrs.rLabel, /reps/);

  for (const width of [320, 360, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('#w-hacksquat-0').scrollIntoViewIfNeeded();
    const metrics = await page.evaluate(() => {
      const w = document.querySelector('#w-hacksquat-0');
      const r = document.querySelector('#r-hacksquat-0');
      const wb = w.getBoundingClientRect();
      const rb = r.getBoundingClientRect();
      const done = document.querySelector('#c-hacksquat [data-a="exdone"]').getBoundingClientRect();
      const repsLabel = document.querySelector('label[for="r-hacksquat-0"]').getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wFont: parseFloat(getComputedStyle(w).fontSize),
        rFont: parseFloat(getComputedStyle(r).fontSize),
        wH: wb.height,
        wW: wb.width,
        rH: rb.height,
        rW: rb.width,
        repsLabelW: repsLabel.width,
        repsLabelH: repsLabel.height,
        doneH: done.height,
        doneW: done.width
      };
    });
    assert.ok(metrics.overflow <= 1, 'horizontal overflow at ' + width + ': ' + metrics.overflow);
    assert.ok(metrics.wFont >= 16, 'weight font ' + metrics.wFont);
    assert.ok(metrics.rFont >= 16, 'reps font ' + metrics.rFont);
    assert.ok(metrics.wH >= 44, 'weight height ' + metrics.wH);
    assert.ok(metrics.wW >= 80, 'weight width ' + metrics.wW + ' at ' + width);
    assert.ok(metrics.rH >= 44, 'reps height ' + metrics.rH);
    assert.ok(metrics.rW >= 44, 'reps width ' + metrics.rW + ' at ' + width);
    assert.ok(metrics.repsLabelW > 0 && metrics.repsLabelH > 0, 'reps label missing');
    assert.ok(metrics.doneH >= 44, 'Done height ' + metrics.doneH);
    assert.ok(metrics.doneW > width * 0.5, 'Done button not obvious at ' + width);
    if (width === 320 || width === 375) {
      await page.locator('#c-hacksquat').screenshot({ path: path.join(ART, `narrow_${width}_hacksquat_card.png`) });
    }
  }
  await page.setViewportSize({ width: 800, height: 900 });
  await page.locator('#w-hacksquat-0').scrollIntoViewIfNeeded();
  const wide = await page.evaluate(() => {
    const w = document.querySelector('#w-hacksquat-0').getBoundingClientRect();
    const r = document.querySelector('#r-hacksquat-0').getBoundingClientRect();
    return { w: w.width, r: r.width, sameRow: Math.abs(w.top - r.top) < 40 };
  });
  assert.ok(wide.sameRow, 'wide layout should keep kg and reps on one row');
  assert.ok(wide.w > wide.r, 'weight field should be slightly wider than reps, got ' + wide.w + ' vs ' + wide.r);

  await page.locator('#c-hacksquat [data-a="exdone"]').click();
  await page.locator('#c-hacksquat [data-warn]').waitFor();
  eq(await page.getAttribute('#c-hacksquat', 'data-state'), 'open');
  eq(await page.evaluate((d) => D.logs.filter((l) => l.ex === 'hacksquat' && l.date === d).length, sessionDate), 0, 'untouched Done created a session');
  assert.match(await page.locator('#c-hacksquat [data-warn]').innerText(), /not saved as finished/i);

  await page.evaluate(() => {
    const cases = [['١٢٫٥', 12.5], ['۱۲٫۵', 12.5], ['12,5', 12.5], ['٠', 0], ['', null], ['0', 0]];
    cases.forEach(([s, n]) => {
      const got = parseNum(s);
      if (got !== n) throw new Error('parseNum(' + JSON.stringify(s) + ') = ' + got);
    });
  });

  const typedFocus = await replaceNumber(page, '#w-hacksquat-0', '12.5');
  eq(typedFocus, 'w-hacksquat-0', 'weight field blurred before reload');
  const mid = await page.evaluate((d) => {
    const raw = JSON.parse(localStorage.getItem('liftlogger.v1'));
    const logs = raw.logs.filter((l) => l.ex === 'hacksquat' && l.date === d);
    const draft = raw.drafts.sets[d] && raw.drafts.sets[d].hacksquat;
    return {
      n: logs.length,
      w: logs[0] && logs[0].sets[0].w,
      r: logs[0] && logs[0].sets[0].r,
      r2: logs[0] && logs[0].sets[1].r,
      w2: logs[0] && logs[0].sets[1].w,
      complete: draft && draft.complete,
      rawW: draft && draft.sets[0].w
    };
  }, sessionDate);
  eq(mid.n, 1);
  eq(mid.w, 12.5);
  assert.equal(mid.r ?? null, null, 'placeholder reps were stored');
  assert.notEqual(mid.r, 12);
  assert.equal(mid.r2 ?? null, null);
  assert.equal(mid.w2 ?? null, null);
  eq(mid.complete, false, 'Done was implied by typing');
  eq(mid.rawW, '12.5');
  eq(await page.locator('#savestatus').innerText(), 'Autosaved');
  await page.reload();
  await showDay(page, 'L2');
  eq(await page.locator('#w-hacksquat-0').inputValue(), '12.5', 'fractional kg lost on reload without blur');

  await page.close();
  const reopened = await context.newPage();
  reopened.on('dialog', (d) => d.accept());
  reopened.on('pageerror', (err) => errors.push(String(err)));
  await reopened.goto(URL);
  await showDay(reopened, 'L2');
  eq(await reopened.locator('#w-hacksquat-0').inputValue(), '12.5', 'fractional kg lost after close and reopen');

  await reopened.locator('#w-hacksquat-2').click();
  await reopened.evaluate(() => {
    const el = document.querySelector('#w-hacksquat-2');
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let built = '';
  for (const ch of '12.5') {
    await reopened.keyboard.type(ch);
    built += ch;
    const info = await reopened.evaluate(() => ({
      id: document.activeElement && document.activeElement.id,
      v: document.querySelector('#w-hacksquat-2').value
    }));
    eq(info.id, 'w-hacksquat-2', 'focus lost at ' + built);
    if (ch === '.') assert.ok(info.v === '12.' || info.v === '12', 'unexpected value ' + info.v);
    else eq(info.v, built, 'caret/value reset while typing');
  }

  await reopened.evaluate(() => {
    const el = document.querySelector('#w-hacksquat-1');
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: '١٢٫٥'
    }));
  });
  eq(await reopened.locator('#w-hacksquat-1').inputValue(), '12.5', 'Arabic-Indic digits were dropped');
  await reopened.reload();
  await showDay(reopened, 'L2');
  eq(await reopened.locator('#w-hacksquat-1').inputValue(), '12.5');
  eq(await reopened.evaluate((d) => D.logs.find((l) => l.ex === 'hacksquat' && l.date === d).sets[1].w, sessionDate), 12.5);

  await showDay(reopened, 'U1');
  await replaceNumber(reopened, '#w-incline-0', '41');
  await replaceNumber(reopened, '#w-incline-0', '42.5');
  await replaceNumber(reopened, '#w-incline-0', '43');
  eq(await reopened.evaluate((d) => D.logs.filter((l) => l.ex === 'incline' && l.date === d).length, sessionDate), 1);
  eq(await reopened.evaluate((d) => D.logs.find((l) => l.ex === 'incline' && l.date === d).sets[0].w, sessionDate), 43);
  await setDate(reopened, '#dt', '2026-03-03');
  await replaceNumber(reopened, '#w-incline-0', '42');
  await setDate(reopened, '#dt', sessionDate);
  eq(await reopened.locator('#w-incline-0').inputValue(), '43');
  await setDate(reopened, '#dt', '2026-03-03');
  eq(await reopened.locator('#w-incline-0').inputValue(), '42');
  const inclineCounts = await reopened.evaluate(() => {
    const by = {};
    D.logs.filter((l) => l.ex === 'incline').forEach((l) => { by[l.date] = (by[l.date] || 0) + 1; });
    return by;
  });
  eq(inclineCounts[sessionDate], 1);
  eq(inclineCounts['2026-03-03'], 1);
  eq(inclineCounts['2026-11-02'], 1);
  await setDate(reopened, '#dt', sessionDate);

  await showDay(reopened, 'L1');
  await replaceNumber(reopened, '#w-legpress-0', '');
  const activeBlank = await reopened.evaluate(() => document.activeElement && document.activeElement.id);
  eq(activeBlank, 'w-legpress-0');
  await reopened.reload();
  await showDay(reopened, 'L1');
  eq(await reopened.locator('#w-legpress-0').inputValue(), '', 'blank weight coerced');
  assert.equal(await reopened.evaluate((d) => {
    const set = D.logs.find((l) => l.ex === 'legpress' && l.date === d).sets[0];
    return set.w ?? null;
  }, sessionDate), null);
  await reopened.locator('#w-legpress-0').click();
  await reopened.keyboard.type('0');
  await reopened.reload();
  await showDay(reopened, 'L1');
  eq(await reopened.locator('#w-legpress-0').inputValue(), '0');
  eq(await reopened.evaluate((d) => D.logs.find((l) => l.ex === 'legpress' && l.date === d).sets[0].w, sessionDate), 0);

  await showDay(reopened, 'L2');
  async function fillSet(ex, i, w, r) {
    await replaceNumber(reopened, `#w-${ex}-${i}`, w);
    await replaceNumber(reopened, `#r-${ex}-${i}`, r);
  }
  await fillSet('outer', 0, '50', '12');
  await reopened.locator('#c-outer [data-a="exdone"]').click();
  const partialWarn = await reopened.locator('#c-outer [data-warn]').innerText();
  assert.match(partialWarn, /set 2/);
  eq(await reopened.getAttribute('#c-outer', 'data-state'), 'open');
  const partial = await reopened.evaluate((d) => {
    const l = D.logs.find((x) => x.ex === 'outer' && x.date === d);
    return { r0: l.sets[0].r, w1: l.sets[1].w, r1: l.sets[1].r, complete: !!D.drafts.sets[d].outer.complete };
  }, sessionDate);
  eq(partial.r0, 12);
  assert.equal(partial.w1 ?? null, null);
  assert.equal(partial.r1 ?? null, null);
  assert.notEqual(partial.r1, 12);
  eq(partial.complete, false);

  await fillSet('abs', 0, '20', '10');
  await fillSet('abs', 1, '22.5', '8');
  await fillSet('abs', 2, '22.5', '8');
  const beforeDone = await reopened.evaluate((d) => {
    const l = D.logs.find((x) => x.ex === 'abs' && x.date === d);
    return { id: l.id, w: l.sets.map((s) => s.w), r: l.sets.map((s) => s.r), complete: !!D.drafts.sets[d].abs.complete };
  }, sessionDate);
  eq(beforeDone.complete, false, 'autosave waited for Done');
  assert.deepEqual(beforeDone.w, [20, 22.5, 22.5]);
  await reopened.locator('#c-abs [data-a="exdone"]').click();
  eq(await reopened.getAttribute('#c-abs', 'data-state'), 'done');
  eq(await reopened.locator('#c-abs input').count(), 0);
  const doneText = await reopened.locator('#c-abs').innerText();
  assert.match(doneText, /Done/);
  assert.match(doneText, /20 kg/);
  assert.match(doneText, /Edit/);
  const afterDone = await reopened.evaluate((d) => {
    const rows = D.logs.filter((x) => x.ex === 'abs' && x.date === d);
    return { n: rows.length, id: rows[0].id, w: rows[0].sets.map((s) => s.w), collapsed: D.drafts.sets[d].abs.collapsed };
  }, sessionDate);
  eq(afterDone.n, 1);
  eq(afterDone.id, beforeDone.id);
  assert.deepEqual(afterDone.w, beforeDone.w);
  eq(afterDone.collapsed, true);
  await reopened.setViewportSize({ width: 375, height: 800 });
  await reopened.locator('#c-abs').scrollIntoViewIfNeeded();
  await reopened.locator('#c-abs').screenshot({ path: path.join(ART, 'done_collapsed_375.png') });
  await reopened.reload();
  await showDay(reopened, 'L2');
  eq(await reopened.getAttribute('#c-abs', 'data-state'), 'done', 'Done state lost on reload');
  await setDate(reopened, '#dt', '2026-04-04');
  eq(await reopened.getAttribute('#c-abs', 'data-state'), 'open', 'Done leaked onto another date');
  eq(await reopened.evaluate(() => {
    const bucket = D.drafts.sets['2026-04-04'];
    return !!(bucket && bucket.abs && bucket.abs.complete);
  }), false);
  await setDate(reopened, '#dt', sessionDate);
  eq(await reopened.getAttribute('#c-abs', 'data-state'), 'done', 'Done state leaked away from its date');
  await reopened.locator('#c-abs [data-a="editex"]').click();
  eq(await reopened.getAttribute('#c-abs', 'data-state'), 'reopened');
  eq(await reopened.locator('#w-abs-0').inputValue(), '20');
  eq(await reopened.locator('#r-abs-1').inputValue(), '8');
  eq(await reopened.locator('#w-abs-2').inputValue(), '22.5');
  eq(await reopened.evaluate((d) => D.logs.find((x) => x.ex === 'abs' && x.date === d).sets[0].w, sessionDate), 20);

  const foodBefore = await reopened.evaluate(() => D.food.length);
  await reopened.locator('[data-tab="cal"]').click();
  await reopened.locator('#fl').click();
  await reopened.keyboard.type('Oats');
  await reopened.locator('#fk').click();
  await reopened.keyboard.type('180');
  eq(await reopened.evaluate(() => document.activeElement.id), 'fk');
  await reopened.reload();
  await reopened.locator('[data-tab="cal"]').click();
  eq(await reopened.locator('#fl').inputValue(), 'Oats');
  eq(await reopened.locator('#fk').inputValue(), '180');
  eq(await reopened.evaluate(() => D.food.length), foodBefore, 'unfinished food form was logged');
  await reopened.locator('[data-a="foodadd"]').click();
  eq(await reopened.evaluate(() => D.food.filter((f) => f.label === 'Oats' && f.kcal === 180).length), 1);

  await reopened.locator('details summary').click();
  await reopened.locator('#tp').click({ clickCount: 3 });
  await reopened.keyboard.type('140');
  eq(await reopened.evaluate(() => document.activeElement.id), 'tp');
  await reopened.reload();
  await reopened.locator('[data-tab="cal"]').click();
  await reopened.locator('details summary').click();
  eq(await reopened.locator('#tp').inputValue(), '140');
  eq(await reopened.evaluate(() => D.targets.p), 140);
  await reopened.locator('#tp').click({ clickCount: 3 });
  await reopened.keyboard.press('Backspace');
  await reopened.reload();
  await reopened.locator('[data-tab="cal"]').click();
  await reopened.locator('details summary').click();
  eq(await reopened.locator('#tp').inputValue(), '');
  eq(await reopened.evaluate(() => D.targets.p), null);
  eq(await reopened.evaluate(() => D.targets.kcal), 1800, 'other targets changed');

  const cardioBefore = await reopened.evaluate(() => D.cardio.length);
  await reopened.locator('[data-tab="cardio"]').click();
  await reopened.reload();
  await reopened.locator('[data-tab="cardio"]').click();
  eq(await reopened.evaluate(() => D.cardio.length), cardioBefore, 'opening cardio logged a session');
  await replaceNumber(reopened, '#cd-min', '25');
  eq(await reopened.evaluate(() => document.activeElement.id), 'cd-min');
  await reopened.reload();
  await reopened.locator('[data-tab="cardio"]').click();
  eq(await reopened.locator('#cd-min').inputValue(), '25');
  eq(await reopened.evaluate(() => D.cardio.length), cardioBefore + 1);
  await replaceNumber(reopened, '#cd-min', '30');
  eq(await reopened.evaluate((d) => D.cardio.filter((c) => c.date === d).length, sessionDate), 1);
  await setDate(reopened, '#cdt', '2026-06-01');
  eq(await reopened.evaluate(() => D.cardio.filter((c) => c.date === '2026-06-01').length), 0);
  eq(await reopened.evaluate(() => !D.drafts.cardio['2026-06-01']), true);
  await replaceNumber(reopened, '#cd-min', '10');
  eq(await reopened.evaluate(() => D.cardio.filter((c) => c.date === '2026-06-01').length), 1);
  eq(await reopened.evaluate((d) => D.cardio.find((c) => c.date === d).min, sessionDate), 30);

  const weighBefore = await reopened.evaluate(() => D.body.weighins.length);
  const scanBefore = await reopened.evaluate(() => D.body.scans.length);
  await reopened.locator('[data-tab="body"]').click();
  await reopened.locator('#wk').click();
  await reopened.keyboard.type('99.5');
  eq(await reopened.evaluate(() => document.activeElement.id), 'wk');
  await reopened.reload();
  await reopened.locator('[data-tab="body"]').click();
  eq(await reopened.locator('#wk').inputValue(), '99.5');
  eq(await reopened.evaluate(() => D.body.weighins.length), weighBefore, 'weigh-in form was logged before Add');
  await reopened.locator('[data-a="addw"]').click();
  eq(await reopened.evaluate(() => D.body.weighins.filter((w) => w.w === 99.5).length), 1);
  await reopened.locator('summary', { hasText: 'Add InBody scan' }).click();
  await reopened.locator('#bw').click();
  await reopened.keyboard.type('101.2');
  await reopened.reload();
  await reopened.locator('[data-tab="body"]').click();
  await reopened.locator('summary', { hasText: 'Add InBody scan' }).click();
  eq(await reopened.locator('#bw').inputValue(), '101.2');
  eq(await reopened.evaluate(() => D.body.scans.length), scanBefore);

  await reopened.locator('[data-tab="history"]').click();
  await reopened.locator('#hex').selectOption('hipthrust');
  const opt = await reopened.locator('#hex option:checked').innerText();
  assert.match(opt, /Hip Thrust/);
  assert.doesNotMatch(opt, /Hack Squat/);
  const hist = await reopened.locator('#main').innerText();
  assert.match(hist, /Hip Thrust or Cable Pull-Through/);
  assert.match(hist, /Not relabeled as Super Hack Squat/);
  assert.match(hist, /40×10/);
  eq(await reopened.evaluate(() => D.logs.find((l) => l.id === 'old-hinge').ex), 'hipthrust');

  await reopened.locator('[data-tab="share"]').click();
  const share = await reopened.locator('#main').innerText();
  const shareL2 = share.split('Lower 2')[1];
  assert.ok(shareL2.indexOf('Super Hack Squat') < shareL2.indexOf('Seated Leg Curl'));
  assert.doesNotMatch(share, /Hip Thrust|Pull-Through/);
  const summary = await reopened.evaluate(() => summaryText());
  const plan = summary.split('Current plan:')[1].split('Earlier exercises')[0];
  const line = plan.split('\n').find((l) => l.startsWith('Lower 2'));
  assert.ok(line.indexOf('Super Hack Squat') < line.indexOf('Seated Leg Curl'));
  assert.match(line, /Outer Thighs/);
  assert.doesNotMatch(line, /Hip Thrust|Pull-Through/);
  assert.match(summary, /Hip Thrust or Cable Pull-Through/);
  assert.match(summary, /Earlier exercises/);
  const snap = await reopened.evaluate(() => snapshotHtml());
  const snapL2 = snap.split('Lower 2')[1].split('Earlier exercises')[0];
  assert.ok(snapL2.indexOf('Super Hack Squat') < snapL2.indexOf('Seated Leg Curl'));
  assert.ok(!snapL2.includes('Hip Thrust'));
  assert.match(snap, /Hip Thrust or Cable Pull-Through/);

  const preservedEnd = await reopened.evaluate(() => ({
    extra: D.extraKeep,
    v: D.v,
    hinge: D.logs.find((l) => l.id === 'old-hinge'),
    food: D.food.find((f) => f.id === 'keepfood'),
    cardio: D.cardio.find((c) => c.date === '2026-10-03'),
    weigh: D.body.weighins.find((w) => w.id === 'keepw'),
    oldIncline: D.logs.find((l) => l.ex === 'incline' && l.date === '2026-11-02'),
    scanIds: D.body.scans.map((s) => s.id)
  }));
  assert.deepEqual(preservedEnd, preservedStart);

  const fail = await context.newPage();
  await fail.goto(URL);
  await fail.locator('[data-tab="today"]').click();
  await showDay(fail, 'U1');
  await fail.evaluate(() => {
    localStorage.setItem = function () { throw new DOMException('QuotaExceededError'); };
  });
  await fail.locator('#w-incline-0').click();
  await fail.keyboard.type('7');
  const failStatus = await fail.locator('#savestatus').innerText();
  assert.match(failStatus, /Not saved/);
  assert.doesNotMatch(failStatus, /Autosaved/);
  const failCmp = await fail.evaluate((d) => {
    const mem = D.logs.find((l) => l.ex === 'incline' && l.date === d);
    const stored = JSON.parse(localStorage.getItem('liftlogger.v1'));
    const st = stored.logs.find((l) => l.ex === 'incline' && l.date === d);
    return { mem: mem && mem.sets[0].wRaw, stored: st && st.sets[0].wRaw, input: document.querySelector('#w-incline-0').value };
  }, sessionDate);
  assert.match(failCmp.input, /7/);
  assert.notEqual(failCmp.mem, failCmp.stored);

  eq(errors.length, 0, errors.join('\n'));
  console.log('browser regression tests passed');
  console.log('session date', sessionDate);
} finally {
  try { await browser.close(); } catch (e) {}
  try { server.kill('SIGKILL'); } catch (e) {}
}
