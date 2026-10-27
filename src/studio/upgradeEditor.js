// Studio: car upgrade editor. Prices and effects of every part sold in the performance, paint, tuning and body-kit shops, and
// the price of each car in the dealership. The calculator at the top shows what a build does to a car.
import { put, h, field, numInput, textInput, selectInput, clone } from './common.js';
import { UPGRADE_DEFAULTS, mergeUpgrades } from '../customData.js';
import { CAR_STYLES } from '../carModels.js';
import { zeroTo100 } from '../classes.js';

const FX = [['speed', 'Top speed'], ['accel', 'Accel.'], ['grip', 'Grip'], ['handling', 'Handling'], ['brake', 'Braking'], ['weight', 'Weight (−)']];

export function createUpgradeEditor(ctx) {
  const root = h('div', { class: 'tab upg' });
  const U = () => { const c = ctx.custom(); if (!c.upgrades) c.upgrades = mergeUpgrades({}); return c.upgrades; };
  let calc = { car: 'sport', lv: {}, seats: false, limiter: false };
  const dirty = () => ctx.dirty('upgrades');
  const n = (get, set, step = 1, w = '66px') => numInput(get(), v => { set(v); dirty(); renderCalc(); }, step, w);
  const calcBox = h('div', { class: 'card' });

  function stats() {
    const u = U(), st = CAR_STYLES.find(c => c.key === calc.car), P = { ...calc.lv };
    const fx = k => Object.keys(u.stages).reduce((a, s) => a + ((u.stages[s].fx || {})[k] || 0) * (P[s] || 0), 0);
    const mass = Math.round(st.mass * (1 - fx('weight')) - (calc.seats ? u.seats.kg : 0));
    const maxSpeed = st.maxSpeed * (1 + fx('speed')) * (calc.limiter ? 1 + u.limiter.speed : 1), accel = st.accel * (1 + fx('accel'));
    let cost = 0; Object.keys(u.stages).forEach(s => { for (let i = 0; i < (P[s] || 0); i++) cost += u.stages[s].prices[i]; });
    if (calc.seats) cost += u.seats.price; if (calc.limiter) cost += u.limiter.price;
    return { mass, maxSpeed, accel, grip: fx('grip'), handling: (st.handling || 1) * (1 + fx('handling')), brake: (st.brake || 1) * (1 + fx('brake')), cost, base: st };
  }
  function renderCalc() {
    const u = U(), s = stats();
    put(calcBox, 
      h('h3', {}, 'Try a build'),
      h('div', { class: 'row' }, field('Car', selectInput(calc.car, CAR_STYLES.map(c => [c.key, c.name]), v => { calc.car = v; renderCalc(); })),
        ...Object.keys(u.stages).map(k => field(u.stages[k].name, selectInput(String(calc.lv[k] || 0), [0, 1, 2, 3].map(String), v => { calc.lv[k] = +v; renderCalc(); }))),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: calc.seats, onchange: e => { calc.seats = e.target.checked; renderCalc(); } }), 'No seats'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: calc.limiter, onchange: e => { calc.limiter = e.target.checked; renderCalc(); } }), 'No limiter')),
      h('p', {}, `${Math.round(s.maxSpeed * 6.2)} km/h (was ${Math.round(s.base.maxSpeed * 6.2)}) · 0-100 in ${zeroTo100(s.accel, s.maxSpeed, s.mass, s.base.mass).toFixed(1)} s (was ${zeroTo100(s.base.accel, s.base.maxSpeed, s.base.mass).toFixed(1)}) · ${s.mass} kg · handling ${s.handling.toFixed(2)} · braking ${s.brake.toFixed(2)} · grip +${(s.grip * 100).toFixed(0)}% · parts cost $${s.cost}`));
  }
  function render() {
    const u = U();
    const stageRows = Object.keys(u.stages).map(k => { const st = u.stages[k];
      return h('tr', {}, h('td', {}, textInput(st.name, v => { st.name = v; dirty(); }, '130px')), h('td', {}, textInput(st.desc, v => { st.desc = v; dirty(); }, '200px')),
        ...st.prices.map((_, i) => h('td', {}, n(() => st.prices[i], v => { st.prices[i] = v; }, 50))),
        ...FX.map(([f]) => h('td', {}, n(() => st.fx[f] || 0, v => { st.fx[f] = v; }, 0.01, '58px')))); });
    const kitRows = Object.keys(u.kit).map(k => h('tr', {}, h('td', {}, k), ...u.kit[k].names.map((nm, i) => h('td', {}, textInput(nm, v => { u.kit[k].names[i] = v; dirty(); }, '110px'), h('br'), n(() => u.kit[k].prices[i], v => { u.kit[k].prices[i] = v; }, 50, '70px')))));
    put(root, 
      h('div', { class: 'page' },
        h('h2', {}, 'Car upgrades'),
        h('p', { class: 'hint' }, 'Prices are in $. Effects are per stage: 0.06 = +6 %. Weight is a reduction (0.04 = −4 % mass per stage). The shops in the game read these numbers when you start it.'),
        calcBox,
        h('div', { class: 'card' }, h('h3', {}, 'Performance shop'),
          h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Part'), h('th', {}, 'Description'), h('th', {}, 'Stage 1 $'), h('th', {}, 'Stage 2 $'), h('th', {}, 'Stage 3 $'), FX.map(([, l]) => h('th', {}, l)))), h('tbody', {}, stageRows)),
          h('div', { class: 'row' },
            field('Remove seats $', n(() => u.seats.price, v => { u.seats.price = v; }, 50)), field('saves kg', n(() => u.seats.kg, v => { u.seats.kg = v; }, 5)),
            field('Remove limiter $', n(() => u.limiter.price, v => { u.limiter.price = v; }, 50)), field('top speed +', n(() => u.limiter.speed, v => { u.limiter.speed = v; }, 0.01)))),
        h('div', { class: 'card' }, h('h3', {}, 'Tuning shop'),
          h('div', { class: 'row' }, ...u.nitro.prices.map((_, i) => field('Nitro ' + (i + 1) + ' $ / seconds', h('span', {}, n(() => u.nitro.prices[i], v => { u.nitro.prices[i] = v; }, 50), n(() => u.nitro.secs[i], v => { u.nitro.secs[i] = v; }, 1, '48px'))))),
          h('div', { class: 'row' }, ...u.tank.prices.map((_, i) => field('Fuel tank ' + (i + 1) + ' $', n(() => u.tank.prices[i], v => { u.tank.prices[i] = v; }, 50))), ...u.hud.prices.map((_, i) => field('HUD ' + (i + 1) + ' $', n(() => u.hud.prices[i], v => { u.hud.prices[i] = v; }, 50)))),
          h('div', { class: 'row' }, field('Underglow neon $', n(() => u.neon, v => { u.neon = v; }, 50)), field('Xenon lights $', n(() => u.xenon, v => { u.xenon = v; }, 50)))),
        h('div', { class: 'card' }, h('h3', {}, 'Paint shop'),
          h('div', { class: 'row' }, field('Paint job $', n(() => u.paint, v => { u.paint = v; }, 25)), field('Decal $', n(() => u.decal, v => { u.decal = v; }, 25)))),
        h('div', { class: 'card' }, h('h3', {}, 'Body kits (name and price of each option)'), h('table', {}, h('tbody', {}, kitRows))),
        h('div', { class: 'card' }, h('h3', {}, 'Dealership prices'),
          h('div', { class: 'row' }, ...Object.keys(u.carPrice).map(k => field(k, n(() => (ctx.custom().cars && ctx.custom().cars[k] && ctx.custom().cars[k].price) ?? u.carPrice[k], v => { u.carPrice[k] = v; const cs = (ctx.custom().cars ||= {}); (cs[k] ||= {}).price = v; }, 100, '80px'))))),
        h('button', { class: 'btn danger', onclick: () => { delete ctx.custom().upgrades; ctx.custom().upgrades = mergeUpgrades({}); Object.keys(ctx.custom().cars || {}).forEach(k => { delete ctx.custom().cars[k].price; }); dirty(); render(); } }, 'Reset all upgrades to the original numbers'))
    );
    renderCalc();
  }
  render();
  return { el: root, show() { root.style.display = ''; render(); }, hide() { root.style.display = 'none'; }, refresh() { render(); } };
}
